import { getDocs } from 'firebase/firestore'
import { todayDateString } from '../cards/invoiceUtils'
import { transactionsCollection } from '../transactions/api'
import { authenticate, listBills, listTransactions, type PluggyBill } from './pluggyClient'
import {
  CARD_LOOKAHEAD_DAYS,
  daysBefore,
  isCardBillPayment,
  newBankEntries,
  toBankEntry,
  type BankEntry,
} from './sync'
import { ACCOUNT_WINDOW_DAYS, CARD_WINDOW_DAYS, isManualCandidate, pairBankWithManual } from './matching'
import { parseReserveMovement, type ReserveMovement } from './reserveParsing'
import { listTransferLogIds } from '../accounts/transferLog'
import { movementBaseId } from '../caixinhas/merge'
import { caixinhaMovementsCollection } from '../caixinhas/movements'
import { type CaixinhaRule, findCaixinhaRule, listCaixinhaRules } from '../caixinhas/rules'
import { isCreditCardTopUp } from './matching'
import type { PluggyAccountLink, PluggyConfig } from './types'

// Mesma leitura da sincronização (reserveMovementOf em sync.ts): primeiro
// a marcação da pessoa, senão a descrição.
function reserveOf(
  rules: CaixinhaRule[],
  accountId: string,
  entry: BankEntry,
): ReserveMovement | null {
  const rule = findCaixinhaRule(rules, accountId, entry)
  if (rule) return { kind: rule.type === 'expense' ? 'guardar' : 'resgatar', caixinhaId: rule.caixinhaId }
  return parseReserveMovement(entry)
}

// Quanto pra trás o diagnóstico olha — além da data inicial, pra mostrar
// também o que ficou de fora por ser anterior a ela.
const DIAGNOSTIC_DAYS_BACK = 60

export type DiagnosticVerdict =
  | 'imported' // está no app
  | 'caixinha' // guardar/resgatar — vai direto pra caixinha, não vira lançamento
  | 'caixinhaMissing' // é guardar/resgatar mas não está no histórico da caixinha
  | 'transfer' // transferência entre contas da família / Pix entre vocês
  | 'creditTopUp' // "valor adicionado por cartão de crédito" (Pix no crédito)
  | 'duplicate' // igual (data + tipo + valor) a algo já lançado no destino
  | 'beforeStart' // anterior a "importar a partir de"
  | 'billPayment' // pagamento de fatura do lado do cartão
  | 'pending' // pendente em conta corrente
  | 'zero'
  | 'missing' // deveria ter entrado e não está — sincronizar de novo

export interface DiagnosticRow {
  date: string
  description: string
  amount: number // como a Pluggy mandou (sinal da fonte)
  status: string
  verdict: DiagnosticVerdict
  // o lançamento como a sincronização o leria — pra lançar pelo diagnóstico
  entry?: BankEntry
  // guardar/resgatar que ainda não está na caixinha — pra lançar nela
  reserve?: ReserveMovement
}

export interface DiagnosticResult {
  rows: DiagnosticRow[]
  bills: PluggyBill[]
  billsError?: string
}

// Lê da Pluggy o mesmo que a sincronização leria (e um pouco antes) e diz,
// lançamento a lançamento, o que aconteceu com ele no app — sem gravar nada.
export async function diagnoseLink(
  workspaceId: string,
  config: Pick<PluggyConfig, 'clientId' | 'clientSecret' | 'syncFrom' | 'linkSince'>,
  pluggyAccountId: string,
  link: PluggyAccountLink,
): Promise<DiagnosticResult> {
  const targetKind = 'cardId' in link ? 'card' : 'account'
  const today = todayDateString()
  const dateFrom = daysBefore(today, DIAGNOSTIC_DAYS_BACK)
  const dateTo = targetKind === 'card' ? daysBefore(today, -CARD_LOOKAHEAD_DAYS) : today

  const start = config.linkSince?.[pluggyAccountId] ?? config.syncFrom
  const apiKey = await authenticate(config.clientId, config.clientSecret)
  const [pluggyTransactions, transactionsSnap, transferIds, movementsSnap, rules] = await Promise.all([
    listTransactions(apiKey, pluggyAccountId, dateFrom, dateTo),
    getDocs(transactionsCollection(workspaceId)),
    listTransferLogIds(workspaceId).catch(() => new Set<string>()),
    getDocs(caixinhaMovementsCollection(workspaceId)),
    listCaixinhaRules(workspaceId).catch(() => []),
  ])
  const movementIds = new Set(movementsSnap.docs.map((d) => movementBaseId(d.id)))
  let bills: PluggyBill[] = []
  let billsError: string | undefined
  if (targetKind === 'card') {
    try {
      bills = await listBills(apiKey, pluggyAccountId)
    } catch (err) {
      billsError = err instanceof Error ? err.message : 'Não foi possível ler as faturas.'
    }
  }

  const scoped = transactionsSnap.docs
    .map((d) => d.data())
    .filter((t) => ('cardId' in link ? t.cardId === link.cardId : t.accountId === link.accountId))
  // conciliado com um lançamento do app (bankRef) também conta como "no app"
  const existingIds = new Set(scoped.flatMap((t) => (t.bankRef !== undefined ? [t.id, t.bankRef] : [t.id])))

  const rows: DiagnosticRow[] = []
  const candidates: { row: DiagnosticRow; entry: BankEntry }[] = []
  for (const tx of pluggyTransactions) {
    const row: DiagnosticRow = {
      date: tx.date.slice(0, 10),
      description: tx.description,
      amount: tx.amount,
      status: tx.status ?? '',
      verdict: 'missing',
    }
    rows.push(row)
    const entry = toBankEntry(tx, targetKind)
    if (entry) row.entry = entry
    const reserve = entry && 'accountId' in link ? reserveOf(rules, link.accountId, entry) : null
    if (!entry) {
      row.verdict =
        targetKind === 'card' && isCardBillPayment(tx) ? 'billPayment' : tx.amount === 0 ? 'zero' : 'pending'
    } else if (existingIds.has(entry.docId)) {
      row.verdict = 'imported'
    } else if (targetKind === 'account' && transferIds.has(entry.docId)) {
      row.verdict = 'transfer'
    } else if ('accountId' in link && movementIds.has(`bank_${entry.docId}`)) {
      row.verdict = 'caixinha'
    } else if (reserve) {
      // a sincronização reconhece como caixinha, mas o movimento não foi
      // gravado (ex.: o banco mandou com o mesmo CPF dos dois lados e ele
      // caía como transferência sem ir pra lugar nenhum)
      row.verdict = start && entry.date < start ? 'beforeStart' : 'caixinhaMissing'
      row.reserve = reserve
    } else if (targetKind === 'account' && isCreditCardTopUp(entry)) {
      row.verdict = 'creditTopUp'
    } else if (start && entry.date < start) {
      row.verdict = 'beforeStart'
    } else {
      candidates.push({ row, entry })
    }
  }

  // Mesmas regras da sincronização pro que sobrou: igual a algo já vindo
  // do banco, ou conciliável com um lançamento do app, vira "duplicate"
  // (não seria importado); o resto é o que realmente falta.
  const fresh = newBankEntries(
    candidates.map((c) => c.entry),
    scoped.filter((t) => t.id.startsWith('pluggy_') || t.bankRef !== undefined),
  ).map((entry) => ({ ...entry, key: entry.docId }))
  const windowDays = targetKind === 'account' ? ACCOUNT_WINDOW_DAYS : CARD_WINDOW_DAYS
  const missing = new Set(
    pairBankWithManual(fresh, scoped.filter(isManualCandidate), windowDays).unmatched.map((e) => e.docId),
  )
  for (const { row, entry } of candidates) row.verdict = missing.has(entry.docId) ? 'missing' : 'duplicate'

  rows.sort((a, b) => b.date.localeCompare(a.date))
  return { rows, bills, ...(billsError ? { billsError } : {}) }
}
