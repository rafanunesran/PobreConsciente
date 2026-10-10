import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CreditCard as CreditCardIcon } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { cn, formatBRL } from '../../lib/utils'
import { PaymentStatusBadge } from '../transactions/PaymentStatusBadge'
import type { CardInvoiceGroup } from './invoiceUtils'

function formatDisplayDate(date: string): string {
  return format(new Date(`${date}T00:00:00`), "d 'de' MMM", { locale: ptBR })
}

interface CardInvoiceRowCardProps {
  group: CardInvoiceGroup
  // Seleção múltipla (extrato/pendentes) — só pra fatura com valor devido.
  selected?: boolean
  onToggleSelect?: () => void
}

// Representa TODA a fatura de um cartão (cartão + período de fechamento)
// como um único registro, em vez de uma linha por compra — ver
// groupCardTransactionsByInvoice em invoiceUtils.ts. Clica e vai direto pra
// fatura correspondente (periodOffset já calculado no grupo). Só faturas
// com algo em aberto chegam aqui, então o status é sempre "Pendente".
export function CardInvoiceRowCard({ group, selected, onToggleSelect }: CardInvoiceRowCardProps) {
  const payable = onToggleSelect !== undefined && group.unpaidAmount > 0

  return (
    <div className="relative">
      <Link
        to={`/cartoes/${group.cardId}/fatura?offset=${group.periodOffset}`}
        aria-label={`Ver fatura ${group.cardName}`}
        className="absolute inset-0 z-0 rounded-2xl"
      />
      <Card className={cn('flex flex-col gap-2 p-3', selected && payable && 'border-brand-500')}>
        <div className="flex items-center gap-2">
          {payable ? (
            <input
              type="checkbox"
              aria-label="Selecionar"
              checked={selected ?? false}
              onChange={onToggleSelect}
              className="relative z-10 h-4 w-4 shrink-0 accent-brand-500"
            />
          ) : null}
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
            <CreditCardIcon size={14} />
          </span>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-light-primary dark:text-dark-primary">
            Fatura {group.cardName}
          </p>
          <PaymentStatusBadge paid={false} type={group.unpaidAmount >= 0 ? 'expense' : 'income'} />
        </div>
        <div>
          <p className="truncate text-xs text-light-secondary dark:text-dark-secondary">
            Vence {formatDisplayDate(group.dueDate)}
          </p>
          <p
            className={cn(
              'text-sm font-semibold',
              group.unpaidAmount >= 0 ? 'text-danger' : 'text-brand-500',
            )}
          >
            {group.unpaidAmount >= 0 ? '-' : '+'}
            {formatBRL(Math.abs(group.unpaidAmount))}
          </p>
        </div>
        {payable ? (
          <Link
            to={`/cartoes/${group.cardId}/fatura/pagar?offset=${group.periodOffset}`}
            className="relative z-10"
          >
            <Button type="button" variant="secondary" className="w-full px-2 py-1.5 text-xs">
              Pagar
            </Button>
          </Link>
        ) : null}
      </Card>
    </div>
  )
}
