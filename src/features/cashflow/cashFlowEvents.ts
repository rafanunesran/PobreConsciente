import { groupCardTransactionsByInvoice, todayDateString } from '../cards/invoiceUtils'
import type { Account } from '../accounts/types'
import type { CreditCard } from '../cards/types'
import type { Transaction } from '../transactions/types'

// Um movimento de dinheiro numa data: lançamento de conta (pago ou não) ou
// fatura de cartão em aberto, que sai da conta no dia do vencimento.
export interface CashFlowEvent {
  key: string
  date: string // 'YYYY-MM-DD'
  title: string
  amount: number // assinado: + entra, - sai
  paid: boolean
  kind: 'transaction' | 'invoice'
  to: string // rota pra abrir o item
}

const KIND_SLUG = { expense: 'despesa', income: 'receita' } as const

// Mesma visão do extrato: conta lançamento a lançamento; cartão pela
// fatura (só o que está em aberto — fatura paga já virou a transação
// "Pagamento fatura X" da conta, que entra pelo primeiro laço).
export function cashFlowEvents(
  transactions: Transaction[],
  cards: CreditCard[],
  accountsById: Map<string, Account>,
): CashFlowEvent[] {
  const events: CashFlowEvent[] = []
  for (const t of transactions) {
    if (t.accountId === undefined) continue
    // Conta fora do total do Home (ex: investimento) também fica fora do
    // fluxo — senão o saldo projetado não bateria com o saldo atual.
    const account = accountsById.get(t.accountId)
    if (account && !account.includeInTotal) continue
    events.push({
      key: t.id,
      date: t.date,
      title: t.description,
      amount: t.type === 'income' ? t.amount : -t.amount,
      paid: t.paid,
      kind: 'transaction',
      to: `/registros/${KIND_SLUG[t.type]}/${t.id}/editar`,
    })
  }
  for (const group of groupCardTransactionsByInvoice(transactions, cards)) {
    if (group.unpaidAmount === 0) continue
    events.push({
      key: `${group.cardId}-${group.period.end}`,
      date: group.dueDate,
      title: `Fatura ${group.cardName}`,
      amount: -group.unpaidAmount,
      paid: false,
      kind: 'invoice',
      to: `/cartoes/${group.cardId}/fatura?offset=${group.periodOffset}`,
    })
  }
  return events.sort((a, b) => a.date.localeCompare(b.date))
}

export interface ProjectionPoint {
  date: string
  balance: number
}

export interface CashFlowProjection {
  points: ProjectionPoint[] // um por dia, de hoje até o horizonte
  startBalance: number
  endBalance: number
  lowest: ProjectionPoint
  firstNegative: ProjectionPoint | null
  overdueTotal: number // pendências com data passada, assumidas como hoje
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Saldo de hoje (contas que entram no total) + tudo que ainda vai
// acontecer. Pendência atrasada entra no dia de hoje: ainda vai sair (ou
// entrar), só não se sabe quando — melhor assumir já.
export function projectCashFlow(
  accounts: Account[],
  events: CashFlowEvent[],
  horizonDays: number,
  today: string = todayDateString(),
): CashFlowProjection {
  const startBalance = accounts.filter((a) => a.includeInTotal).reduce((sum, a) => sum + a.balance, 0)
  const end = addDays(today, horizonDays)
  const byDate = new Map<string, number>()
  let overdueTotal = 0
  for (const e of events) {
    if (e.paid || e.date > end) continue
    const date = e.date < today ? today : e.date
    if (e.date < today) overdueTotal += e.amount
    byDate.set(date, (byDate.get(date) ?? 0) + e.amount)
  }

  const points: ProjectionPoint[] = []
  let balance = startBalance
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDays(today, i)
    balance += byDate.get(date) ?? 0
    points.push({ date, balance })
  }
  const lowest = points.reduce((min, p) => (p.balance < min.balance ? p : min), points[0]!)
  const firstNegative = points.find((p) => p.balance < 0) ?? null
  return { points, startBalance, endBalance: balance, lowest, firstNegative, overdueTotal }
}
