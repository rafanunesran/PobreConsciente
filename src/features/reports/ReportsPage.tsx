import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useTransactions } from '../transactions/useTransactions'
import { useCategories } from '../categories/useCategories'
import { useCards } from '../cards/useCards'
import { categoryTotals } from '../categories/categoryTotals'
import { currentYearMonth } from '../transactions/dateUtils'
import { MonthSelector } from '../../components/ui/MonthSelector'
import { Card } from '../../components/ui/Card'
import { cn, formatBRL } from '../../lib/utils'
import { lastMonths, monthlyFlow } from './monthlyFlow'
import { CashFlowChart } from './CashFlowChart'

const PERIOD_OPTIONS = [3, 6, 12] as const
type PeriodOption = (typeof PERIOD_OPTIONS)[number]

function monthName(month: string): string {
  return format(new Date(`${month}-01T00:00:00`), 'MMM yyyy', { locale: ptBR })
}

export function ReportsPage() {
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { transactions, loading } = useTransactions(workspaceId ?? '')
  const { categories } = useCategories(workspaceId ?? '')
  const { cards } = useCards(workspaceId ?? '')
  const [endMonth, setEndMonth] = useState(currentYearMonth())
  const [period, setPeriod] = useState<PeriodOption>(6)

  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const months = useMemo(() => lastMonths(endMonth, period), [endMonth, period])
  const flow = useMemo(() => monthlyFlow(transactions, cardsById, months), [transactions, cardsById, months])

  const previousMonth = lastMonths(endMonth, 2)[0] ?? endMonth
  const comparison = useMemo(() => {
    const current = categoryTotals(transactions, categories, cardsById, endMonth, 'expense')
    const previous = new Map(
      categoryTotals(transactions, categories, cardsById, previousMonth, 'expense').map((t) => [t.categoryId, t]),
    )
    const rows = current.map((t) => ({ ...t, previous: previous.get(t.categoryId)?.value ?? 0 }))
    // Categorias que tiveram gasto no mês anterior e zeraram neste também
    // contam — "parei de gastar com X" é informação útil.
    for (const [categoryId, t] of previous) {
      if (!rows.some((r) => r.categoryId === categoryId)) rows.push({ ...t, value: 0, previous: t.value })
    }
    return rows
  }, [transactions, categories, cardsById, endMonth, previousMonth])

  if (!user || !workspaceId) return null

  const totalIncome = flow.reduce((sum, f) => sum + f.income, 0)
  const totalExpense = flow.reduce((sum, f) => sum + f.expense, 0)
  const averageIncome = totalIncome / flow.length
  const averageExpense = totalExpense / flow.length
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : null

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">Relatórios</h1>

      <MonthSelector value={endMonth} onChange={setEndMonth} />

      <div className="flex gap-2">
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPeriod(option)}
            className={cn(
              'flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-200',
              period === option
                ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
            )}
          >
            {option} meses
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-48 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-4">
            <p className="text-sm font-medium text-light-primary dark:text-dark-primary">Fluxo de caixa</p>
            <CashFlowChart flow={flow} />
            <div className="grid grid-cols-2 gap-3 border-t border-border-light pt-3 text-sm dark:border-border-dark">
              <div className="min-w-0">
                <p className="text-light-secondary dark:text-dark-secondary">Média de receitas</p>
                <p className="truncate font-semibold text-brand-500">{formatBRL(averageIncome)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-light-secondary dark:text-dark-secondary">Média de despesas</p>
                <p className="truncate font-semibold text-danger">{formatBRL(averageExpense)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-light-secondary dark:text-dark-secondary">Resultado no período</p>
                <p
                  className={cn(
                    'truncate font-semibold',
                    totalIncome - totalExpense >= 0 ? 'text-brand-500' : 'text-danger',
                  )}
                >
                  {formatBRL(totalIncome - totalExpense)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-light-secondary dark:text-dark-secondary">Taxa de economia</p>
                <p
                  className={cn(
                    'truncate font-semibold',
                    savingsRate === null
                      ? 'text-light-primary dark:text-dark-primary'
                      : savingsRate >= 0
                        ? 'text-brand-500'
                        : 'text-danger',
                  )}
                >
                  {savingsRate === null ? '—' : `${savingsRate.toFixed(0)}%`}
                </p>
              </div>
            </div>
          </Card>

          <Card className="flex flex-col gap-3">
            <p className="text-sm font-medium text-light-primary dark:text-dark-primary">Mês a mês</p>
            <div className="flex flex-col">
              <div className="grid grid-cols-4 gap-2 border-b border-border-light pb-2 text-xs text-light-secondary dark:border-border-dark dark:text-dark-secondary">
                <span>Mês</span>
                <span className="text-right">Receitas</span>
                <span className="text-right">Despesas</span>
                <span className="text-right">Resultado</span>
              </div>
              {[...flow].reverse().map((f) => (
                <div
                  key={f.month}
                  className="grid grid-cols-4 gap-2 border-b border-border-light py-2 text-xs last:border-b-0 dark:border-border-dark"
                >
                  <span className="capitalize text-light-primary dark:text-dark-primary">{monthName(f.month)}</span>
                  <span className="truncate text-right text-brand-500">{formatBRL(f.income)}</span>
                  <span className="truncate text-right text-danger">{formatBRL(f.expense)}</span>
                  <span
                    className={cn(
                      'truncate text-right font-semibold',
                      f.result >= 0 ? 'text-brand-500' : 'text-danger',
                    )}
                  >
                    {formatBRL(f.result)}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="flex flex-col gap-3 lg:col-span-2">
            <div>
              <p className="text-sm font-medium text-light-primary dark:text-dark-primary">
                Despesas por categoria
              </p>
              <p className="text-xs capitalize text-light-secondary dark:text-dark-secondary">
                {monthName(endMonth)} x {monthName(previousMonth)}
              </p>
            </div>
            {comparison.length === 0 ? (
              <p className="py-6 text-center text-sm text-light-secondary dark:text-dark-secondary">
                Nenhuma despesa nesses meses
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {comparison.map((row) => {
                  const delta = row.value - row.previous
                  const deltaPercent = row.previous > 0 ? (delta / row.previous) * 100 : null
                  return (
                    <div key={row.categoryId} className="flex items-center justify-between gap-2 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                        <span className="truncate text-light-primary dark:text-dark-primary">{row.name}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="hidden text-xs text-light-secondary sm:inline dark:text-dark-secondary">
                          antes {formatBRL(row.previous)}
                        </span>
                        <span className="font-semibold text-light-primary dark:text-dark-primary">
                          {formatBRL(row.value)}
                        </span>
                        <span
                          className={cn(
                            'flex w-16 items-center justify-end gap-0.5 text-xs',
                            delta > 0 ? 'text-danger' : delta < 0 ? 'text-brand-500' : 'text-light-secondary dark:text-dark-secondary',
                          )}
                        >
                          {delta > 0 ? <ArrowUpRight size={12} /> : delta < 0 ? <ArrowDownRight size={12} /> : null}
                          {deltaPercent === null ? 'novo' : `${Math.abs(deltaPercent).toFixed(0)}%`}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
