import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Receipt } from 'lucide-react'
import { CATEGORY_ICON_COMPONENTS } from '../categories/types'
import type { Category } from '../categories/types'
import { Card } from '../../components/ui/Card'
import { cn, formatBRL } from '../../lib/utils'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUserProfiles } from '../family/useUserProfiles'
import type { Transaction } from './types'

interface TransactionCompactCardProps {
  transaction: Transaction
  category: Category | undefined
  linkedName: string | undefined
  // Modo seleção (bulk delete etc.) — quando presente, o card vira um
  // botão de toggle em vez de navegar pro form de edição.
  selectMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}

export function TransactionCompactCard({
  transaction,
  category,
  linkedName,
  selectMode,
  selected,
  onToggleSelect,
}: TransactionCompactCardProps) {
  const Icon = category ? CATEGORY_ICON_COMPONENTS[category.icon] : Receipt
  const kind = transaction.type === 'expense' ? 'despesa' : 'receita'
  const family = useWorkspaceStore((state) => state.family)
  const profiles = useUserProfiles(family ? [transaction.createdBy] : [])
  const authorName = family ? profiles.get(transaction.createdBy)?.displayName : undefined

  const content = (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        {selectMode ? (
          <input
            type="checkbox"
            aria-label="Selecionar"
            checked={selected ?? false}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 shrink-0 accent-brand-500"
          />
        ) : null}
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: category?.color ?? '#6B7280' }}
        >
          <Icon size={14} />
        </span>
        <p className="truncate text-sm font-medium text-light-primary dark:text-dark-primary">
          {transaction.description}
        </p>
      </div>
      <div>
        <p className="truncate text-xs text-light-secondary dark:text-dark-secondary">
          {format(new Date(`${transaction.date}T00:00:00`), "d 'de' MMM", { locale: ptBR })}
          {linkedName ? ` · ${linkedName}` : ''}
          {authorName ? ` · ${authorName}` : ''}
        </p>
        {transaction.tags && transaction.tags.length > 0 ? (
          <p className="truncate text-xs text-brand-500">
            {transaction.tags.map((tag) => `#${tag}`).join(' ')}
          </p>
        ) : null}
        <p
          className={cn(
            'text-sm font-semibold',
            transaction.type === 'expense' ? 'text-danger' : 'text-brand-500',
          )}
        >
          {transaction.type === 'expense' ? '-' : '+'}
          {formatBRL(transaction.amount)}
        </p>
      </div>
    </Card>
  )

  if (selectMode) {
    return (
      <button type="button" onClick={onToggleSelect} className="block w-full text-left">
        {content}
      </button>
    )
  }

  return <Link to={`/registros/${kind}/${transaction.id}/editar`}>{content}</Link>
}
