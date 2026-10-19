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
import type { PluggyAccountLink, PluggyConfig } from './types'

// Quanto pra trás o diagnóstico olha — além da data inicial, pra mostrar
// também o que ficou de fora por ser anterior a ela.
const DIAGNOSTIC_DAYS_BACK = 60

export type DiagnosticVerdict =
  | 'imported' // está no app
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
  const [pluggyTransactions, transactionsSnap] = await Promise.all([
    listTransactions(apiKey, pluggyAccountId, dateFrom, dateTo),
    getDocs(transactionsCollection(workspaceId)),
  ])
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
    if (!entry) {
      row.verdict =
        targetKind === 'card' && isCardBillPayment(tx) ? 'billPayment' : tx.amount === 0 ? 'zero' : 'pending'
    } else if (existingIds.has(entry.docId)) {
      row.verdict = 'imported'
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
