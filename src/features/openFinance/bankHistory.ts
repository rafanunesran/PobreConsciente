import { getDocs } from 'firebase/firestore'
import { accountsCollection } from '../accounts/api'
import { listTransferLogIds } from '../accounts/transferLog'
import { movementBaseId } from '../caixinhas/merge'
import { caixinhaMovementsCollection } from '../caixinhas/movements'
import { type CaixinhaRule, findCaixinhaRule, listCaixinhaRules } from '../caixinhas/rules'
import { todayDateString } from '../cards/invoiceUtils'
import { buildCategorySuggester } from '../imports/categorize'
import { transactionsCollection } from '../transactions/api'
import type { Transaction, TransactionType } from '../transactions/types'
import { listPluggyConfigs } from './api'
import {
  ACCOUNT_WINDOW_DAYS,
  dayDistance,
  isCreditCardTopUp,
  isManualCandidate,
  looksLikeBillPayment,
  pairBankWithManual,
  TRANSFER_DESCRIPTION,
  TRANSFER_WINDOW_DAYS,
} from './matching'
import { authenticate, listAccounts, listTransactions } from './pluggyClient'
import { parseReserveMovement, type ReserveMovement } from './reserveParsing'
import { daysBefore, forcedTransactionId, toBankEntry } from './sync'
import type { PluggyTransaction } from './types'

// Histórico do banco: as movimentações das contas correntes conectadas,
// lidas na hora da Pluggy (nada é gravado só por abrir). A conta não é
// mais importada sozinha — o Open Finance chega com ~1 dia de atraso e
// a pessoa lança na hora pelo app; daqui ela escolhe o que ainda falta
// virar lançamento, transferência ou caixinha (ver bankHistoryActions.ts).

export const HISTORY_DAYS_BACK = 60

// Onde a movimentação já está no controle.
export type HistoryStatus =
  | { kind: 'transaction'; transaction: Transaction } // virou (ou foi vinculada a) um lançamento
  | { kind: 'transfer' } // está no log de transferências
  | { kind: 'caixinha' } // está no histórico de uma caixinha
  | { kind: 'similar'; transaction: Transaction } // parece um lançamento do app ainda não vinculado
  | { kind: 'ignored' }
  | { kind: 'new' }

// Palpite do que a movimentação é, pela descrição — só sugestão na tela.
export type HistoryHint = 'caixinha' | 'transfer' | 'billPayment' | 'creditTopUp'

export interface BankHistoryRow {
  docId: string // id que o lançamento do banco tem/teria no app
  accountId: string // conta do app
  date: string
  description: string
  amount: number // sempre positivo
  type: TransactionType
  pending: boolean // ainda agendado/bloqueado no banco
  counterpart?: string // quem recebeu (saída) ou pagou (entrada), quando o banco informa
  hint?: HistoryHint
  reserve?: ReserveMovement // guardar/resgatar reconhecido (marcação da pessoa ou descrição)
  // o outro lado provável de uma transferência entre contas conectadas
  transferPairDocId?: string
  suggestedCategoryId: string | undefined
  status: HistoryStatus
}

export interface BankHistoryAccount {
  accountId: string
  bankName: string
  bankBalance?: number
}

export interface BankHistory {
  rows: BankHistoryRow[]
  accounts: BankHistoryAccount[]
  errors: string[]
}

// "Ignorar" fica só neste aparelho — não muda nada no controle.
function ignoredKey(workspaceId: string): string {
  return `pc.bankHistory.ignored.${workspaceId}`
}

export function loadIgnored(workspaceId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(ignoredKey(workspaceId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveIgnored(workspaceId: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(ignoredKey(workspaceId), JSON.stringify([...ids]))
  } catch {
    // sem armazenamento: só não lembra
  }
}

function sameDocument(tx: PluggyTransaction): boolean {
  const payer = tx.paymentData?.payer?.documentNumber?.value?.replace(/\D/g, '')
  const receiver = tx.paymentData?.receiver?.documentNumber?.value?.replace(/\D/g, '')
  return Boolean(payer && receiver && payer === receiver)
}

function reserveOf(rules: CaixinhaRule[], accountId: string, entry: { description: string; type: TransactionType }) {
  const rule = findCaixinhaRule(rules, accountId, entry)
  if (rule) return { kind: rule.type === 'expense' ? 'guardar' : 'resgatar', caixinhaId: rule.caixinhaId } as const
  return parseReserveMovement(entry)
}

export async function loadBankHistory(workspaceId: string): Promise<BankHistory> {
  const [configs, accountsSnap, transactionsSnap, movementsSnap, transferIds, rules] = await Promise.all([
    listPluggyConfigs(workspaceId),
    getDocs(accountsCollection(workspaceId)),
    getDocs(transactionsCollection(workspaceId)),
    getDocs(caixinhaMovementsCollection(workspaceId)),
    listTransferLogIds(workspaceId).catch(() => new Set<string>()),
    listCaixinhaRules(workspaceId).catch(() => [] as CaixinhaRule[]),
  ])
  const accountIds = new Set(accountsSnap.docs.map((d) => d.id))
  const transactions = transactionsSnap.docs.map((d) => d.data())
  const movementIds = new Set(movementsSnap.docs.map((d) => movementBaseId(d.id)))
  const suggest = buildCategorySuggester(transactions)
  const ignored = loadIgnored(workspaceId)
  const today = todayDateString()
  const dateFrom = daysBefore(today, HISTORY_DAYS_BACK)

  // lançamento do app que já representa um do banco, pelo id dele
  const byBankKey = new Map<string, Transaction>()
  for (const t of transactions) {
    if (t.bankRef !== undefined) byBankKey.set(t.bankRef, t)
    if (t.id.startsWith('pluggy_')) byBankKey.set(t.id, t)
  }

  const rows: BankHistoryRow[] = []
  const accounts: BankHistoryAccount[] = []
  const errors: string[] = []
  const seen = new Set<string>()

  for (const config of configs) {
    const links = Object.entries(config.links).flatMap(([pid, link]) =>
      'accountId' in link && accountIds.has(link.accountId) ? [[pid, link.accountId] as const] : [],
    )
    if (links.length === 0) continue
    try {
      const apiKey = await authenticate(config.clientId, config.clientSecret)
      const pluggyAccounts = new Map<string, { name: string; balance?: number }>()
      for (const itemId of config.itemIds) {
        for (const a of await listAccounts(apiKey, itemId))
          pluggyAccounts.set(a.id, { name: a.marketingName || a.name, balance: a.balance })
      }
      for (const [pluggyAccountId, accountId] of links) {
        const info = pluggyAccounts.get(pluggyAccountId)
        if (!accounts.some((a) => a.accountId === accountId))
          accounts.push({ accountId, bankName: info?.name ?? 'Banco', bankBalance: info?.balance })
        for (const tx of await listTransactions(apiKey, pluggyAccountId, dateFrom, today)) {
          const pending = tx.status === 'PENDING'
          // mesma leitura da sincronização antiga (mesmo id), mas o
          // pendente também aparece — marcado
          const entry = toBankEntry({ ...tx, status: 'POSTED' }, 'account')
          if (!entry || seen.has(entry.docId)) continue
          seen.add(entry.docId)
          const reserve = reserveOf(rules, accountId, entry)
          const hint: HistoryHint | undefined = reserve
            ? 'caixinha'
            : isCreditCardTopUp(entry)
              ? 'creditTopUp'
              : looksLikeBillPayment(entry.description) && entry.type === 'expense'
                ? 'billPayment'
                : sameDocument(tx) || TRANSFER_DESCRIPTION.test(entry.description)
                  ? 'transfer'
                  : undefined
          const other = entry.type === 'expense' ? tx.paymentData?.receiver : tx.paymentData?.payer
          rows.push({
            docId: entry.docId,
            accountId,
            date: entry.date,
            description: entry.description,
            amount: entry.amount,
            type: entry.type,
            pending,
            ...(other?.name ? { counterpart: other.name } : {}),
            ...(hint ? { hint } : {}),
            ...(reserve ? { reserve } : {}),
            suggestedCategoryId: suggest(entry.description, entry.type),
            status: { kind: 'new' },
          })
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Não foi possível ler o banco.')
    }
  }

  // Onde cada uma já está no controle.
  const open: BankHistoryRow[] = []
  for (const row of rows) {
    const linked = byBankKey.get(row.docId) ?? transactions.find((t) => t.id === forcedTransactionId(row.docId))
    if (linked) row.status = { kind: 'transaction', transaction: linked }
    else if (transferIds.has(row.docId)) row.status = { kind: 'transfer' }
    else if (movementIds.has(`bank_${row.docId}`)) row.status = { kind: 'caixinha' }
    else if (ignored.has(row.docId)) row.status = { kind: 'ignored' }
    else open.push(row)
  }

  // O que ainda está aberto e se parece com algo lançado à mão (inclusive
  // previsto/pendente com valor um pouco diferente) — mesma regra da
  // conciliação: vincular em vez de lançar de novo.
  for (const accountId of new Set(open.map((r) => r.accountId))) {
    const bank = open.filter((r) => r.accountId === accountId).map((r) => ({ ...r, key: r.docId }))
    const manual = transactions.filter((t) => t.accountId === accountId && isManualCandidate(t))
    for (const { bank: b, manual: m } of pairBankWithManual(bank, manual, ACCOUNT_WINDOW_DAYS).pairs) {
      const row = open.find((r) => r.docId === b.key)
      if (row) row.status = { kind: 'similar', transaction: m }
    }
  }

  // Transferência entre duas contas conectadas: o outro lado (sentido
  // oposto, mesmo valor, em poucos dias, em outra conta).
  const isOpen = (r: BankHistoryRow) => r.status.kind === 'new' || r.status.kind === 'similar'
  for (const row of rows) {
    if (!isOpen(row) || (row.hint !== undefined && row.hint !== 'transfer')) continue
    const pair = rows.find(
      (o) =>
        isOpen(o) &&
        (row.hint === 'transfer' || o.hint === 'transfer') &&
        o.accountId !== row.accountId &&
        o.type !== row.type &&
        Math.abs(o.amount - row.amount) < 0.005 &&
        dayDistance(o.date, row.date) <= TRANSFER_WINDOW_DAYS,
    )
    if (pair) {
      row.transferPairDocId = pair.docId
      if (!row.hint) row.hint = 'transfer'
    }
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description))
  return { rows, accounts, errors }
}
