import { getDocs } from 'firebase/firestore'
import { todayDateString } from '../cards/invoiceUtils'
import { transactionsCollection } from '../transactions/api'
import { authenticate, listBills, listTransactions, type PluggyBill } from './pluggyClient'
import { CARD_LOOKAHEAD_DAYS, daysBefore, isCardBillPayment, newBankEntries, toBankEntry, type BankEntry } from './sync'
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
  config: Pick<PluggyConfig, 'clientId' | 'clientSecret' | 'syncFrom'>,
  pluggyAccountId: string,
  link: PluggyAccountLink,
): Promise<DiagnosticResult> {
  const targetKind = 'cardId' in link ? 'card' : 'account'
  const today = todayDateString()
  const dateFrom = daysBefore(today, DIAGNOSTIC_DAYS_BACK)
  const dateTo = targetKind === 'card' ? daysBefore(today, -CARD_LOOKAHEAD_DAYS) : today

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
  const existingIds = new Set(scoped.map((t) => t.id))

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
    } else if (config.syncFrom && entry.date < config.syncFrom) {
      row.verdict = 'beforeStart'
    } else {
      candidates.push({ row, entry })
    }
  }

  // Mesma regra da sincronização pro que sobrou: igual a algo já lançado
  // vira "duplicado", o resto é o que realmente falta.
  const fresh = new Set(newBankEntries(candidates.map((c) => c.entry), scoped).map((e) => e.docId))
  for (const { row, entry } of candidates) row.verdict = fresh.has(entry.docId) ? 'missing' : 'duplicate'

  rows.sort((a, b) => b.date.localeCompare(a.date))
  return { rows, bills, ...(billsError ? { billsError } : {}) }
}
