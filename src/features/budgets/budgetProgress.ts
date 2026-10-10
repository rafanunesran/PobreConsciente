import { categoryTotals } from '../categories/categoryTotals'
import type { Category } from '../categories/types'
import type { CreditCard } from '../cards/types'
import type { Transaction } from '../transactions/types'
import type { Budget } from './types'

export type BudgetStatus = 'ok' | 'warning' | 'over'

export interface BudgetProgress {
  budget: Budget
  category: Category | undefined
  spent: number
  remaining: number // negativo quando estourou
  percent: number // 0-100+ (passa de 100 quando estoura)
  status: BudgetStatus
}

// A partir de 80% do teto já vale avisar — dá tempo de segurar o resto do mês.
const WARNING_THRESHOLD = 80

export function budgetStatus(percent: number): BudgetStatus {
  if (percent > 100) return 'over'
  if (percent >= WARNING_THRESHOLD) return 'warning'
  return 'ok'
}

// Gasto do mês por orçamento — usa exatamente a mesma soma do gráfico de
// gastos por categoria (categoryTotals), então os dois números sempre batem.
export function computeBudgetProgress(
  budgets: Budget[],
  transactions: Transaction[],
  categories: Category[],
  cardsById: Map<string, CreditCard>,
  selectedMonth: string,
): BudgetProgress[] {
  const categoriesById = new Map(categories.map((c) => [c.id, c]))
  const spentByCategory = new Map(
    categoryTotals(transactions, categories, cardsById, selectedMonth, 'expense').map((t) => [
      t.categoryId,
      t.value,
    ]),
  )

  return budgets
    .map((budget) => {
      const spent = spentByCategory.get(budget.categoryId) ?? 0
      const percent = budget.amount > 0 ? (spent / budget.amount) * 100 : 0
      return {
        budget,
        category: categoriesById.get(budget.categoryId),
        spent,
        remaining: budget.amount - spent,
        percent,
        status: budgetStatus(percent),
      }
    })
    .sort((a, b) => b.percent - a.percent)
}
