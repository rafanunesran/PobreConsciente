import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn, formatBRL } from '../../lib/utils'
import type { Caixinha } from './types'
import { caixinhaGoalProgress } from './goal'

interface CaixinhaGoalBarProps {
  caixinha: Caixinha
  detailed?: boolean
}

export function CaixinhaGoalBar({ caixinha, detailed }: CaixinhaGoalBarProps) {
  const goal = caixinhaGoalProgress(caixinha)
  if (!goal) return null

  const deadline = caixinha.goalDate
    ? format(new Date(`${caixinha.goalDate}T00:00:00`), "MMM 'de' yyyy", { locale: ptBR })
    : null

  let hint: string
  if (goal.reached) hint = 'Meta atingida!'
  else if (goal.overdue) hint = `Prazo vencido — faltam ${formatBRL(goal.remaining)}`
  else if (goal.monthlyNeeded !== null) hint = `Guarde ${formatBRL(goal.monthlyNeeded)}/mês até ${deadline}`
  else hint = `Faltam ${formatBRL(goal.remaining)}`

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-light-secondary dark:text-dark-secondary">
        <span>Meta {formatBRL(goal.goalAmount)}</span>
        <span>{goal.percent.toFixed(0)}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-border-light dark:bg-border-dark"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(goal.percent)}
      >
        <div
          className={cn('h-full rounded-full transition-all duration-300', goal.overdue ? 'bg-warning' : 'bg-brand-500')}
          style={{ width: `${goal.percent}%` }}
        />
      </div>
      <p
        className={cn(
          'text-xs',
          goal.reached ? 'text-brand-500' : goal.overdue ? 'text-warning' : 'text-light-secondary dark:text-dark-secondary',
        )}
      >
        {hint}
        {detailed && !goal.reached && goal.monthlyNeeded !== null ? ` · faltam ${formatBRL(goal.remaining)}` : ''}
      </p>
    </div>
  )
}
