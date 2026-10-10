import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlarmClock, CreditCard as CreditCardIcon, Receipt } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { cn, formatBRL } from '../../lib/utils'
import type { CreditCard } from '../cards/types'
import type { Transaction } from '../transactions/types'
import { dueLabel, upcomingBills, DEFAULT_WINDOW_DAYS } from './upcomingBills'

interface UpcomingBillsCardProps {
  transactions: Transaction[]
  cards: CreditCard[]
}

const MAX_ROWS = 5

export function UpcomingBillsCard({ transactions, cards }: UpcomingBillsCardProps) {
  const bills = useMemo(() => upcomingBills(transactions, cards), [transactions, cards])
  const overdue = bills.filter((b) => b.daysUntil < 0)
  const total = bills.reduce((sum, b) => sum + b.amount, 0)

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlarmClock size={18} className={overdue.length > 0 ? 'text-danger' : 'text-brand-500'} />
          <p className="text-sm font-medium text-light-primary dark:text-dark-primary">Contas a pagar</p>
        </div>
        {bills.length > 0 ? (
          <p className="text-sm font-semibold text-light-primary dark:text-dark-primary">{formatBRL(total)}</p>
        ) : null}
      </div>

      {bills.length === 0 ? (
        <p className="text-sm text-light-secondary dark:text-dark-secondary">
          Nada vencendo nos próximos {DEFAULT_WINDOW_DAYS} dias.
        </p>
      ) : (
        <>
          {overdue.length > 0 ? (
            <p className="text-xs text-danger">
              {overdue.length === 1 ? '1 conta vencida' : `${overdue.length} contas vencidas`}
            </p>
          ) : null}
          <div className="flex flex-col gap-1">
            {bills.slice(0, MAX_ROWS).map((bill) => {
              const Icon = bill.kind === 'invoice' ? CreditCardIcon : Receipt
              return (
                <Link
                  key={bill.key}
                  to={bill.to}
                  className="-mx-2 flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 transition-colors duration-200 hover:bg-border-light dark:hover:bg-border-dark"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon size={16} className="shrink-0 text-light-secondary dark:text-dark-secondary" />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-light-primary dark:text-dark-primary">{bill.title}</p>
                      <p
                        className={cn(
                          'text-xs',
                          bill.daysUntil < 0
                            ? 'text-danger'
                            : bill.daysUntil <= 1
                              ? 'text-warning'
                              : 'text-light-secondary dark:text-dark-secondary',
                        )}
                      >
                        {dueLabel(bill.daysUntil)}
                      </p>
                    </div>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-danger">{formatBRL(bill.amount)}</p>
                </Link>
              )
            })}
          </div>
          {bills.length > MAX_ROWS ? (
            <Link to="/registros/pendentes" className="text-sm text-brand-500">
              Ver todas ({bills.length})
            </Link>
          ) : null}
        </>
      )}
    </Card>
  )
}
