import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import type { Category } from '../categories/types'
import type { CreditCard } from '../cards/types'
import type { Transaction } from '../transactions/types'
import type { Budget } from './types'
import { computeBudgetProgress } from './budgetProgress'
import { BudgetProgressRow } from './BudgetProgressRow'

interface BudgetsSummaryCardProps {
  budgets: Budget[]
  transactions: Transaction[]
  categories: Category[]
  cardsById: Map<string, CreditCard>
  selectedMonth: string
}

// Os mais apertados primeiro (computeBudgetProgress já ordena por % usado).
const MAX_ROWS = 4

export function BudgetsSummaryCard({
  budgets,
  transactions,
  categories,
  cardsById,
  selectedMonth,
}: BudgetsSummaryCardProps) {
  const progress = useMemo(
    () => computeBudgetProgress(budgets, transactions, categories, cardsById, selectedMonth),
    [budgets, transactions, categories, cardsById, selectedMonth],
  )

  return (
    <Link to="/orcamentos" className="block">
      <Card className="flex flex-col gap-4 transition-all duration-200 hover:border-brand-500">
        <p className="text-sm font-medium text-light-primary dark:text-dark-primary">Orçamentos do mês</p>
        {progress.length === 0 ? (
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Nenhum orçamento definido. Toque para criar um limite por categoria.
          </p>
        ) : (
          progress.slice(0, MAX_ROWS).map((p) => <BudgetProgressRow key={p.budget.id} progress={p} compact />)
        )}
      </Card>
    </Link>
  )
}
