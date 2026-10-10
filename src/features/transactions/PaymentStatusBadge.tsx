import { CheckCircle2, Clock } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { TransactionType } from './types'

interface PaymentStatusBadgeProps {
  paid: boolean
  type: TransactionType
  className?: string
}

// Selo de status usado nos cards do extrato e dos pendentes — verde quando
// já pago/recebido, âmbar quando ainda pendente.
export function PaymentStatusBadge({ paid, type, className }: PaymentStatusBadgeProps) {
  const Icon = paid ? CheckCircle2 : Clock
  const label = paid ? (type === 'expense' ? 'Pago' : 'Recebido') : 'Pendente'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
        paid ? 'bg-brand-500/10 text-brand-500' : 'bg-warning/10 text-warning',
        className,
      )}
    >
      <Icon size={11} />
      {label}
    </span>
  )
}
