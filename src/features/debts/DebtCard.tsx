import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Card } from '../../components/ui/Card'
import { cn, formatBRL } from '../../lib/utils'
import { todayDateString } from '../cards/invoiceUtils'
import { debtPaid, debtRemaining, type Debt } from './types'

export function DebtCard({ debt }: { debt: Debt }) {
  const remaining = debtRemaining(debt)
  const percent = debt.amount > 0 ? Math.min((debtPaid(debt) / debt.amount) * 100, 100) : 0
  const settled = remaining === 0
  const overdue = !settled && debt.dueDate !== undefined && debt.dueDate < todayDateString()

  return (
    <Link to={`/dividas/${debt.id}`}>
      <Card className="flex flex-col gap-2 p-3 transition-colors duration-200 hover:border-brand-500">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-light-primary dark:text-dark-primary">{debt.person}</p>
            {debt.description ? (
              <p className="truncate text-xs text-light-secondary dark:text-dark-secondary">{debt.description}</p>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <p
              className={cn(
                'text-sm font-semibold',
                settled ? 'text-light-secondary dark:text-dark-secondary' : debt.direction === 'owed' ? 'text-brand-500' : 'text-danger',
              )}
            >
              {settled ? 'Quitada' : formatBRL(remaining)}
            </p>
            <p className="text-xs text-light-secondary dark:text-dark-secondary">de {formatBRL(debt.amount)}</p>
          </div>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-light dark:bg-border-dark">
          <div
            className={cn('h-full rounded-full', debt.direction === 'owed' ? 'bg-brand-500' : 'bg-danger')}
            style={{ width: `${percent}%` }}
          />
        </div>
        {debt.dueDate && !settled ? (
          <p className={cn('text-xs', overdue ? 'text-danger' : 'text-light-secondary dark:text-dark-secondary')}>
            {overdue ? 'Venceu em ' : 'Vence em '}
            {format(new Date(`${debt.dueDate}T00:00:00`), "d 'de' MMM 'de' yyyy", { locale: ptBR })}
          </p>
        ) : null}
      </Card>
    </Link>
  )
}
