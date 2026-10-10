import { effectiveMonth } from '../cards/invoiceUtils'
import { countsInMonthTotals } from '../categories/categoryTotals'
import type { CreditCard } from '../cards/types'
import type { Transaction } from '../transactions/types'

export interface MonthFlow {
  month: string // 'YYYY-MM'
  income: number
  expense: number
  result: number
}

// `count` meses terminando em `endMonth` (inclusive), em ordem crescente.
export function lastMonths(endMonth: string, count: number): string[] {
  const [yearStr, monthStr] = endMonth.split('-')
  const endIndex = Number(yearStr) * 12 + Number(monthStr) - 1
  const months: string[] = []
  for (let index = endIndex - count + 1; index <= endIndex; index++) {
    const year = Math.floor(index / 12)
    const month1based = (index % 12) + 1
    months.push(`${year}-${String(month1based).padStart(2, '0')}`)
  }
  return months
}

// Receita x despesa por mês — mesma regra de mês e de exclusão do gráfico
// de gastos por categoria (categoryTotals), então o total de um mês aqui
// é sempre a soma das fatias de lá.
export function monthlyFlow(
  transactions: Transaction[],
  cardsById: Map<string, CreditCard>,
  months: string[],
): MonthFlow[] {
  const byMonth = new Map(months.map((m) => [m, { income: 0, expense: 0 }]))
  for (const t of transactions) {
    if (!countsInMonthTotals(t)) continue
    const entry = byMonth.get(effectiveMonth(t, cardsById))
    if (!entry) continue
    if (t.type === 'income') entry.income += t.amount
    else entry.expense += t.amount
  }
  return months.map((month) => {
    const { income, expense } = byMonth.get(month) ?? { income: 0, expense: 0 }
    return { month, income, expense, result: income - expense }
  })
}
