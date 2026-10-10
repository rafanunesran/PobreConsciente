import { groupCardTransactionsByInvoice, todayDateString } from '../cards/invoiceUtils'
import type { CreditCard } from '../cards/types'
import type { Transaction } from '../transactions/types'

export interface UpcomingBill {
  key: string
  kind: 'expense' | 'invoice'
  title: string
  amount: number
  dueDate: string // 'YYYY-MM-DD'
  daysUntil: number // negativo = vencida
  to: string // rota pra resolver (editar a despesa / abrir a fatura)
}

export const DEFAULT_WINDOW_DAYS = 7

function daysBetween(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()
  return Math.round(ms / 86_400_000)
}

// Contas a pagar dos próximos `windowDays` dias + tudo que já venceu e
// continua em aberto. Despesa de conta entra uma a uma; cartão entra pela
// fatura (é ela que vence, não cada compra) — mesma visão do extrato.
export function upcomingBills(
  transactions: Transaction[],
  cards: CreditCard[],
  windowDays: number = DEFAULT_WINDOW_DAYS,
  today: string = todayDateString(),
): UpcomingBill[] {
  const bills: UpcomingBill[] = []

  for (const t of transactions) {
    if (t.type !== 'expense' || t.paid || t.accountId === undefined) continue
    const daysUntil = daysBetween(today, t.date)
    if (daysUntil > windowDays) continue
    bills.push({
      key: t.id,
      kind: 'expense',
      title: t.description,
      amount: t.amount,
      dueDate: t.date,
      daysUntil,
      to: `/registros/despesa/${t.id}/editar`,
    })
  }

  for (const group of groupCardTransactionsByInvoice(transactions, cards)) {
    if (group.unpaidAmount <= 0) continue
    const daysUntil = daysBetween(today, group.dueDate)
    if (daysUntil > windowDays) continue
    bills.push({
      key: `${group.cardId}-${group.period.end}`,
      kind: 'invoice',
      title: `Fatura ${group.cardName}`,
      amount: group.unpaidAmount,
      dueDate: group.dueDate,
      daysUntil,
      to: `/cartoes/${group.cardId}/fatura?offset=${group.periodOffset}`,
    })
  }

  return bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.amount - a.amount)
}

export function dueLabel(daysUntil: number): string {
  if (daysUntil < -1) return `Venceu há ${Math.abs(daysUntil)} dias`
  if (daysUntil === -1) return 'Venceu ontem'
  if (daysUntil === 0) return 'Vence hoje'
  if (daysUntil === 1) return 'Vence amanhã'
  return `Vence em ${daysUntil} dias`
}
