import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CreditCard as CreditCardIcon, Receipt } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { cn, formatBRL } from '../../lib/utils'
import { todayDateString } from '../cards/invoiceUtils'
import type { CashFlowEvent } from './cashFlowEvents'

interface FinancialCalendarProps {
  events: CashFlowEvent[]
  month: string // 'YYYY-MM'
}

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

// Valor compacto pra caber na célula: 1.250 -> "1,3k".
function compact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1000) return `${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1).replace('.', ',')}k`
  return abs.toFixed(0)
}

export function FinancialCalendar({ events, month }: FinancialCalendarProps) {
  const today = todayDateString()
  const [selected, setSelected] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const map = new Map<string, CashFlowEvent[]>()
    for (const e of events) {
      if (!e.date.startsWith(month)) continue
      const list = map.get(e.date) ?? []
      list.push(e)
      map.set(e.date, list)
    }
    return map
  }, [events, month])

  const [year, month1based] = month.split('-').map(Number) as [number, number]
  const firstWeekday = new Date(year, month1based - 1, 1).getDay()
  const daysInMonth = new Date(year, month1based, 0).getDate()
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ]

  const selectedDay = selected && selected.startsWith(month) ? selected : null
  const selectedEvents = selectedDay ? (byDay.get(selectedDay) ?? []) : []

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-3">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-light-secondary dark:text-dark-secondary">
          {WEEKDAYS.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((date, i) => {
            if (!date) return <span key={`empty-${i}`} />
            const dayEvents = byDay.get(date) ?? []
            const income = dayEvents.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0)
            const expense = dayEvents.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0)
            const hasPending = dayEvents.some((e) => !e.paid)
            const overdue = hasPending && date < today
            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelected(date === selectedDay ? null : date)}
                aria-label={format(new Date(`${date}T00:00:00`), "d 'de' MMMM", { locale: ptBR })}
                aria-pressed={date === selectedDay}
                className={cn(
                  'flex min-h-14 flex-col items-center gap-0.5 rounded-lg border p-1 text-[10px] leading-tight transition-colors duration-200',
                  date === selectedDay
                    ? 'border-brand-500 bg-brand-500/10'
                    : 'border-transparent hover:border-border-light dark:hover:border-border-dark',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-xs',
                    date === today
                      ? 'bg-brand-500 font-semibold text-white'
                      : 'text-light-primary dark:text-dark-primary',
                  )}
                >
                  {Number(date.slice(-2))}
                </span>
                {income > 0 ? <span className="text-brand-500">+{compact(income)}</span> : null}
                {expense < 0 ? <span className="text-danger">-{compact(expense)}</span> : null}
                {hasPending ? (
                  <span className={cn('h-1 w-1 rounded-full', overdue ? 'bg-danger' : 'bg-warning')} />
                ) : null}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-3 text-[11px] text-light-secondary dark:text-dark-secondary">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" /> pendente
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-danger" /> atrasado
          </span>
        </div>
      </Card>

      {selectedDay ? (
        <Card className="flex flex-col gap-2">
          <p className="text-sm font-medium text-light-primary first-letter:uppercase dark:text-dark-primary">
            {format(new Date(`${selectedDay}T00:00:00`), "EEEE, d 'de' MMMM", { locale: ptBR })}
          </p>
          {selectedEvents.length === 0 ? (
            <p className="text-sm text-light-secondary dark:text-dark-secondary">Nenhuma movimentação.</p>
          ) : (
            selectedEvents.map((e) => {
              const Icon = e.kind === 'invoice' ? CreditCardIcon : Receipt
              return (
                <Link
                  key={e.key}
                  to={e.to}
                  className="-mx-2 flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 transition-colors duration-200 hover:bg-border-light dark:hover:bg-border-dark"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon size={16} className="shrink-0 text-light-secondary dark:text-dark-secondary" />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-light-primary dark:text-dark-primary">{e.title}</p>
                      <p className="text-xs text-light-secondary dark:text-dark-secondary">
                        {e.paid ? (e.amount > 0 ? 'Recebido' : 'Pago') : 'Pendente'}
                      </p>
                    </div>
                  </div>
                  <span className={cn('shrink-0 text-sm font-semibold', e.amount > 0 ? 'text-brand-500' : 'text-danger')}>
                    {e.amount > 0 ? '+' : '-'}
                    {formatBRL(Math.abs(e.amount))}
                  </span>
                </Link>
              )
            })
          )}
        </Card>
      ) : (
        <p className="text-center text-xs text-light-secondary dark:text-dark-secondary">
          Toque num dia para ver as movimentações.
        </p>
      )}
    </div>
  )
}
