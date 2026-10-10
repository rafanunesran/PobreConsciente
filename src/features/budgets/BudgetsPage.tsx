import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PiggyBank, Plus } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useTransactions } from '../transactions/useTransactions'
import { useCategories } from '../categories/useCategories'
import { useCards } from '../cards/useCards'
import { currentYearMonth } from '../transactions/dateUtils'
import { MonthSelector } from '../../components/ui/MonthSelector'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { cn, formatBRL } from '../../lib/utils'
import { useBudgets } from './useBudgets'
import { computeBudgetProgress } from './budgetProgress'
import { BudgetProgressRow } from './BudgetProgressRow'

export function BudgetsPage() {
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { budgets, loading, error } = useBudgets(workspaceId ?? '')
  const { transactions } = useTransactions(workspaceId ?? '')
  const { categories } = useCategories(workspaceId ?? '')
  const { cards } = useCards(workspaceId ?? '')
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth())

  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const progress = useMemo(
    () => computeBudgetProgress(budgets, transactions, categories, cardsById, selectedMonth),
    [budgets, transactions, categories, cardsById, selectedMonth],
  )

  if (!user || !workspaceId) return null

  const totalBudget = progress.reduce((sum, p) => sum + p.budget.amount, 0)
  const totalSpent = progress.reduce((sum, p) => sum + p.spent, 0)
  const totalRemaining = totalBudget - totalSpent

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">Orçamentos</h1>
        <Link to="/orcamentos/novo">
          <Button type="button" className="gap-1.5">
            <Plus size={18} />
            Novo
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="h-24 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
      ) : error ? (
        <p className="text-sm text-danger">
          Não foi possível carregar seus orçamentos. Verifique sua conexão ou tente novamente mais
          tarde.
        </p>
      ) : budgets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-light px-6 py-16 text-center dark:border-border-dark">
          <PiggyBank size={32} className="text-light-secondary dark:text-dark-secondary" />
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Defina um limite mensal por categoria e acompanhe quanto ainda pode gastar.
          </p>
          <Link to="/orcamentos/novo">
            <Button type="button" variant="secondary">
              Criar o primeiro orçamento
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <MonthSelector value={selectedMonth} onChange={setSelectedMonth} />

          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-border-light bg-surface-light p-4 dark:border-border-dark dark:bg-surface-dark-elevated">
            <div className="min-w-0">
              <p className="text-xs text-light-secondary dark:text-dark-secondary">Orçado</p>
              <p className="truncate text-sm font-semibold text-light-primary dark:text-dark-primary">
                {formatBRL(totalBudget)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-light-secondary dark:text-dark-secondary">Gasto</p>
              <p className="truncate text-sm font-semibold text-danger">{formatBRL(totalSpent)}</p>
            </div>
            <div className="min-w-0 border-l border-border-light pl-2 dark:border-border-dark">
              <p className="text-xs text-light-secondary dark:text-dark-secondary">
                {totalRemaining >= 0 ? 'Disponível' : 'Estourado'}
              </p>
              <p
                className={cn(
                  'truncate text-sm font-semibold',
                  totalRemaining >= 0 ? 'text-brand-500' : 'text-danger',
                )}
              >
                {formatBRL(Math.abs(totalRemaining))}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {progress.map((p) => (
              <Link key={p.budget.id} to={`/orcamentos/${p.budget.id}/editar`}>
                <Card className="transition-colors duration-200 hover:border-brand-500">
                  <BudgetProgressRow progress={p} />
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
