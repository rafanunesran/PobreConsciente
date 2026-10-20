import { Link } from 'react-router-dom'
import { ArrowLeftRight, PiggyBank } from 'lucide-react'
import { formatBRL } from '../../lib/utils'
import type { MoneyMovementRow } from '../categories/moneyMovements'

interface MoneyMovementRowCardProps {
  row: MoneyMovementRow
  linkedName: string | undefined
}

// Transferência ou reserva no extrato: mesma linha do TransactionCompactCard,
// mas em tom neutro e com o aviso de que não soma — é só conferência.
export function MoneyMovementRowCard({ row, linkedName }: MoneyMovementRowCardProps) {
  const Icon = row.kind === 'transfer' ? ArrowLeftRight : PiggyBank
  const subtitle = [row.kind === 'transfer' ? 'Transferência' : 'Reserva', linkedName, 'não entra no saldo do mês']
    .filter(Boolean)
    .join(' · ')

  const content = (
    <div className="flex items-center gap-3 px-3 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-border-light text-light-secondary dark:bg-border-dark dark:text-dark-secondary">
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-light-primary dark:text-dark-primary">{row.description}</p>
        <p className="truncate text-xs text-light-secondary dark:text-dark-secondary">{subtitle}</p>
      </div>
      <p className="tabular shrink-0 whitespace-nowrap text-sm font-semibold text-light-secondary dark:text-dark-secondary">
        {row.direction === 'out' ? '− ' : '+ '}
        {formatBRL(row.amount)}
      </p>
    </div>
  )

  if (row.kind === 'reserve' && row.accountId && row.caixinhaId) {
    return <Link to={`/contas/${row.accountId}/caixinhas/${row.caixinhaId}`}>{content}</Link>
  }
  return content
}
