import { Receipt } from 'lucide-react'
import { CATEGORY_ICON_COMPONENTS } from '../categories/types'
import { cn, formatBRL } from '../../lib/utils'
import type { BudgetProgress, BudgetStatus } from './budgetProgress'

const BAR_COLORS: Record<BudgetStatus, string> = {
  ok: 'bg-brand-500',
  warning: 'bg-warning',
  over: 'bg-danger',
}

const TEXT_COLORS: Record<BudgetStatus, string> = {
  ok: 'text-light-secondary dark:text-dark-secondary',
  warning: 'text-warning',
  over: 'text-danger',
}

interface BudgetProgressRowProps {
  progress: BudgetProgress
  compact?: boolean
}

export function BudgetProgressRow({ progress, compact }: BudgetProgressRowProps) {
  const { category, spent, budget, remaining, percent, status } = progress
  const Icon = category ? CATEGORY_ICON_COMPONENTS[category.icon] : Receipt

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: category?.color ?? '#6B7280' }}
          >
            <Icon size={13} />
          </span>
          <span className="truncate text-sm font-medium text-light-primary dark:text-dark-primary">
            {category?.name ?? 'Categoria excluída'}
          </span>
        </div>
        <span className="shrink-0 text-sm text-light-secondary dark:text-dark-secondary">
          <span className="font-semibold text-light-primary dark:text-dark-primary">{formatBRL(spent)}</span>
          {' de '}
          {formatBRL(budget.amount)}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-border-light dark:bg-border-dark"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(percent, 100))}
      >
        <div
          className={cn('h-full rounded-full transition-all duration-300', BAR_COLORS[status])}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {compact ? null : (
        <p className={cn('text-xs', TEXT_COLORS[status])}>
          {remaining >= 0
            ? `Restam ${formatBRL(remaining)} (${percent.toFixed(0)}% usado)`
            : `Estourou ${formatBRL(Math.abs(remaining))} (${percent.toFixed(0)}% usado)`}
        </p>
      )}
    </div>
  )
}
