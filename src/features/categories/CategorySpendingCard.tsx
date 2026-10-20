import { useMemo, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { cn, formatBRL } from '../../lib/utils'
import { categoryTotals, type CategoryTotal } from './categoryTotals'
import type { Category } from './types'
import type { CreditCard } from '../cards/types'
import type { Transaction, TransactionType } from '../transactions/types'

interface CategorySpendingCardProps {
  transactions: Transaction[]
  categories: Category[]
  cardsById: Map<string, CreditCard>
  selectedMonth: string // 'YYYY-MM'
}

// Além de ~6 fatias individuais, o resto vira "Outros" — mais que isso e o
// gráfico/legenda ficam ilegíveis (ver dataviz skill: teto de 7-8 fatias).
const MAX_SLICES = 7
const OTHER_COLOR = '#898781'

function foldTotals(totals: CategoryTotal[]): CategoryTotal[] {
  if (totals.length <= MAX_SLICES) return totals
  const visible = totals.slice(0, MAX_SLICES - 1)
  const rest = totals.slice(MAX_SLICES - 1)
  const otherValue = rest.reduce((sum, t) => sum + t.value, 0)
  return [...visible, { categoryId: '__other__', name: 'Outros', color: OTHER_COLOR, value: otherValue }]
}

const CENTER = 80
const RADIUS = 60
const STROKE = 28
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const GAP = 3 // espaço (na unidade da circunferência) entre fatias vizinhas

export function CategorySpendingCard({
  transactions,
  categories,
  cardsById,
  selectedMonth,
}: CategorySpendingCardProps) {
  const [type, setType] = useState<TransactionType>('expense')

  const slices = useMemo(
    () => foldTotals(categoryTotals(transactions, categories, cardsById, selectedMonth, type)),
    [transactions, categories, cardsById, selectedMonth, type],
  )

  const total = slices.reduce((sum, s) => sum + s.value, 0)

  let cumulativeFraction = 0
  const arcs = slices.map((slice) => {
    const fraction = total > 0 ? slice.value / total : 0
    const length = Math.max(fraction * CIRCUMFERENCE - GAP, 0)
    const offset = -cumulativeFraction * CIRCUMFERENCE
    cumulativeFraction += fraction
    return { ...slice, length, offset, percent: fraction * 100 }
  })

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-light-primary dark:text-dark-primary">
          Gastos por categoria
        </p>
        <div className="flex rounded-full border border-border-light p-0.5 dark:border-border-dark">
          <button
            type="button"
            onClick={() => setType('expense')}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors duration-200',
              type === 'expense' ? 'bg-danger/10 text-danger' : 'text-light-secondary dark:text-dark-secondary',
            )}
          >
            Despesas
          </button>
          <button
            type="button"
            onClick={() => setType('income')}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors duration-200',
              type === 'income'
                ? 'bg-brand-500/10 text-brand-500'
                : 'text-light-secondary dark:text-dark-secondary',
            )}
          >
            Receitas
          </button>
        </div>
      </div>

      {slices.length === 0 ? (
        <p className="py-8 text-center text-sm text-light-secondary dark:text-dark-secondary">
          {type === 'expense' ? 'Nenhuma despesa neste mês' : 'Nenhuma receita neste mês'}
        </p>
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
          <svg
            viewBox="0 0 160 160"
            className="h-40 w-40 shrink-0"
            role="img"
            aria-label={`Gastos por categoria — ${type === 'expense' ? 'despesas' : 'receitas'}`}
          >
            <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
              {arcs.map((arc) => (
                <circle
                  key={arc.categoryId}
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
                  strokeDashoffset={arc.offset}
                />
              ))}
            </g>
            <text
              x={CENTER}
              y={CENTER - 4}
              textAnchor="middle"
              className="fill-light-primary text-[13px] font-semibold dark:fill-dark-primary"
            >
              {formatBRL(total)}
            </text>
            <text
              x={CENTER}
              y={CENTER + 14}
              textAnchor="middle"
              className="fill-light-secondary text-[10px] dark:fill-dark-secondary"
            >
              {type === 'expense' ? 'Despesas' : 'Receitas'}
            </text>
          </svg>

          <div className="flex w-full min-w-0 flex-col gap-2">
            {arcs.map((arc) => (
              <div key={arc.categoryId} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: arc.color }}
                  />
                  <span className="truncate text-light-primary dark:text-dark-primary">{arc.name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-light-secondary dark:text-dark-secondary">
                    {arc.percent.toFixed(0)}%
                  </span>
                  <span className="font-semibold text-light-primary dark:text-dark-primary">
                    {formatBRL(arc.value)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
