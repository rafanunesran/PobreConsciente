import { getDocs } from 'firebase/firestore'
import { listTransferLogIds, saveTransferLogs, type AccountTransferLog } from '../accounts/transferLog'
import { movementBaseId } from '../caixinhas/merge'
import { caixinhaMovementsCollection } from '../caixinhas/movements'
import { findCaixinhaRule, listCaixinhaRules } from '../caixinhas/rules'
import { todayDateString } from '../cards/invoiceUtils'
import { transactionsCollection } from '../transactions/api'
import { listPluggyConfigs } from './api'
import { applyBankReserves, type ReserveItem } from './caixinhaSync'
import {
  ACCOUNT_WINDOW_DAYS,
  buildFamilyIdentity,
  isCreditCardTopUp,
  isFamilyCounterpart,
  isManualCandidate,
  pairBankWithManual,
  TRANSFER_DESCRIPTION,
} from './matching'
import { authenticate, listAccounts, listTransactions } from './pluggyClient'
import { parseReserveMovement, type ReserveMovement } from './reserveParsing'
import { daysBefore, newBankEntries, toBankEntry, type BankEntry } from './sync'
import type { PluggyTransaction } from './types'

// Até onde volta: o que a Pluggy costuma guardar de histórico.
export const RECOVER_DAYS_BACK = 365

export interface RecoverResult {
  transfers: number
  reserves: number
}

function sameDocument(tx: PluggyTransaction): boolean {
  const payer = tx.paymentData?.payer?.documentNumber?.value?.replace(/\D/g, '')
  const receiver = tx.paymentData?.receiver?.documentNumber?.value?.replace(/\D/g, '')
  return Boolean(payer && receiver && payer === receiver)
}

// "Quero ver as movimentações, o saldo já está certo": relê do banco o
// último ano da conta e põe no extrato, só pra conferência, o que a
// sincronização tirou dele e não deixou rastro — transferências (entre
// contas de vocês, pra você mesmo, Pix no crédito) e guardar/resgatar
// caixinha, inclusive de antes desses registros existirem no app.
//
// Nada aqui mexe em saldo nem em receitas/despesas: transferência vai pro
// log de transferências (accounts/transferLog.ts) e caixinha pro histórico
// dela (historyOnly). O que já aparece de algum jeito no app — lançamento,
// conciliado com um lançamento à mão, transferência, movimento da caixinha
// — fica como está. Receita/despesa comum que falta continua no
// Diagnóstico ("lançar como receita/despesa").
export async function recoverAccountMovements(
  workspaceId: string,
  accountId: string,
  createdBy: string,
): Promise<RecoverResult> {
  const configs = (await listPluggyConfigs(workspaceId)).filter((c) =>
    Object.values(c.links).some((link) => 'accountId' in link && link.accountId === accountId),
  )
  if (configs.length === 0) throw new Error('Esta conta não está ligada a uma conexão bancária.')

  const [transactionsSnap, transferIds, movementsSnap, rules] = await Promise.all([
    getDocs(transactionsCollection(workspaceId)),
    listTransferLogIds(workspaceId).catch(() => new Set<string>()),
    getDocs(caixinhaMovementsCollection(workspaceId)),
    listCaixinhaRules(workspaceId).catch(() => []),
  ])
  const scoped = transactionsSnap.docs.map((d) => d.data()).filter((t) => t.accountId === accountId)
  const represented = new Set(scoped.flatMap((t) => (t.bankRef !== undefined ? [t.id, t.bankRef] : [t.id])))
  const appliedMovements = new Set(movementsSnap.docs.map((d) => movementBaseId(d.id)))

  const today = todayDateString()
  const dateFrom = daysBefore(today, RECOVER_DAYS_BACK)
  const reserves: ReserveItem[] = []
  const transferCandidates: BankEntry[] = []
  const seen = new Set<string>()

  for (const config of configs) {
    const apiKey = await authenticate(config.clientId, config.clientSecret)
    const owners = (await Promise.all(config.itemIds.map((itemId) => listAccounts(apiKey, itemId)))).flat()
    const family = buildFamilyIdentity(
      owners.flatMap((a) => (a.owner ? [a.owner] : [])),
      owners.flatMap((a) => (a.taxNumber ? [a.taxNumber] : [])),
    )
    for (const [pluggyAccountId, link] of Object.entries(config.links)) {
      if (!('accountId' in link) || link.accountId !== accountId) continue
      for (const tx of await listTransactions(apiKey, pluggyAccountId, dateFrom, today)) {
        const entry = toBankEntry(tx, 'account')
        if (!entry || seen.has(entry.docId)) continue
        seen.add(entry.docId)
        if (
          represented.has(entry.docId) ||
          transferIds.has(entry.docId) ||
          appliedMovements.has(`bank_${entry.docId}`)
        )
          continue

        const rule = findCaixinhaRule(rules, accountId, entry)
        const reserve: ReserveMovement | null = rule
          ? { kind: rule.type === 'expense' ? 'guardar' : 'resgatar', caixinhaId: rule.caixinhaId }
          : parseReserveMovement(entry)
        if (reserve) {
          reserves.push({
            key: entry.docId,
            accountId,
            date: entry.date,
            amount: entry.amount,
            movement: reserve,
            historyOnly: true,
          })
          continue
        }

        const other = entry.type === 'expense' ? tx.paymentData?.receiver : tx.paymentData?.payer
        const counterpart = other ? { name: other.name, document: other.documentNumber?.value } : undefined
        const thirdParty =
          Boolean(counterpart?.name || counterpart?.document) &&
          !isFamilyCounterpart(counterpart, entry.description, family)
        if (
          sameDocument(tx) ||
          isCreditCardTopUp(entry) ||
          isFamilyCounterpart(counterpart, entry.description, family) ||
          (!thirdParty && TRANSFER_DESCRIPTION.test(entry.description))
        )
          transferCandidates.push(entry)
      }
    }
  }

  // o que já está no app com outro id (mesma data/valor, ou um lançamento
  // à mão conciliável) não entra de novo
  const fresh = newBankEntries(
    transferCandidates,
    scoped.filter((t) => t.id.startsWith('pluggy_') || t.bankRef !== undefined),
  ).map((entry) => ({ ...entry, key: entry.docId }))
  const unmatched = pairBankWithManual(fresh, scoped.filter(isManualCandidate), ACCOUNT_WINDOW_DAYS).unmatched
  const logs: AccountTransferLog[] = unmatched.map((entry) => ({
    id: entry.docId,
    accountId,
    type: entry.type,
    amount: entry.amount,
    date: entry.date,
    description: entry.description,
    createdBy,
  }))

  await saveTransferLogs(workspaceId, logs)
  await applyBankReserves(workspaceId, reserves, createdBy)
  return { transfers: logs.length, reserves: reserves.length }
}
