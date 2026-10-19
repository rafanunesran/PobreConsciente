import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CreditCard as CreditCardIcon } from 'lucide-react'
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
  highlighted?: boolean
}

// Representa TODA a fatura de um cartão (cartão + período de fechamento)
// como um único registro, em vez de uma linha por compra — ver
// groupCardTransactionsByInvoice em invoiceUtils.ts. Clica e vai direto pra
// fatura correspondente (periodOffset já calculado no grupo). Só faturas
// com algo em aberto chegam aqui, então o status é sempre "Pendente".
export function CardInvoiceRowCard({ group, selected, onToggleSelect, highlighted = false }: CardInvoiceRowCardProps) {
  const payable = onToggleSelect !== undefined && group.unpaidAmount > 0

  return (
    <div className="relative">
      <Link
        to={`/cartoes/${group.cardId}/fatura?offset=${group.periodOffset}`}
        aria-label={`Ver fatura ${group.cardName}`}
        className="absolute inset-0 z-0"
      />
      <div
        className={cn(
          'flex items-center gap-3 px-3 py-3 transition-colors duration-700',
          selected && payable && 'bg-brand-500/10',
          highlighted && 'bg-brand-500/20',
        )}
      >
        {payable ? (
          <input
            type="checkbox"
            aria-label={`Selecionar fatura ${group.cardName}`}
            checked={selected ?? false}
            onChange={onToggleSelect}
            className="relative z-10 h-4 w-4 shrink-0 accent-brand-500"
          />
        ) : null}
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
          <CreditCardIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-light-primary dark:text-dark-primary">
            Fatura {group.cardName}
          </p>
          <p className="truncate text-xs text-light-secondary dark:text-dark-secondary">
            Vence {formatDisplayDate(group.dueDate)} · toque para ver as compras
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p
            className={cn(
              'tabular whitespace-nowrap text-sm font-semibold',
              group.unpaidAmount >= 0 ? 'text-light-primary dark:text-dark-primary' : 'text-brand-500',
            )}
          >
            {group.unpaidAmount >= 0 ? '− ' : '+ '}
            {formatBRL(Math.abs(group.unpaidAmount))}
          </p>
          {payable ? (
            <Link
              to={`/cartoes/${group.cardId}/fatura/pagar?offset=${group.periodOffset}`}
              className="relative z-10 inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning transition-colors duration-200 hover:border-brand-500 hover:bg-brand-500/10 hover:text-brand-500"
            >
              Pagar fatura
            </Link>
          ) : (
            <PaymentStatusBadge paid={false} type={group.unpaidAmount >= 0 ? 'expense' : 'income'} />
          )}
        </div>
      </div>
    </div>
  )
}
