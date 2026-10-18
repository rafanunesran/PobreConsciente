import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CheckCircle2, Receipt } from 'lucide-react'
import { CATEGORY_ICON_COMPONENTS } from '../categories/types'
import type { Category } from '../categories/types'
import { Card } from '../../components/ui/Card'
import { PaymentStatusBadge } from './PaymentStatusBadge'
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
  // Controles de pagamento (extrato/pendentes) — quando presente e o
  // lançamento ainda está pendente, mostra checkbox de seleção múltipla e
  // o botão "Pago"/"Recebido".
  onConfirm?: () => void
  confirming?: boolean
  // Dentro de uma lista já agrupada por dia, a data no subtítulo é redundante.
  showDate?: boolean
  // Destaque temporário (ex.: o lançamento que acabou de ser salvo).
  highlighted?: boolean
}

export function TransactionCompactCard({
  transaction,
  category,
  linkedName,
  selectMode,
  selected,
  onToggleSelect,
  onConfirm,
  confirming,
  showDate = true,
  highlighted = false,
}: TransactionCompactCardProps) {
  const Icon = category ? CATEGORY_ICON_COMPONENTS[category.icon] : Receipt
  const kind = transaction.type === 'expense' ? 'despesa' : 'receita'
  const family = useWorkspaceStore((state) => state.family)
  const profiles = useUserProfiles(family ? [transaction.createdBy] : [])
  const authorName = family ? profiles.get(transaction.createdBy)?.displayName : undefined

  const payable = !selectMode && onConfirm !== undefined && !transaction.paid

  const subtitle = [
    showDate ? format(new Date(`${transaction.date}T00:00:00`), "d 'de' MMM", { locale: ptBR }) : null,
    category?.name,
    linkedName,
    authorName,
  ]
    .filter(Boolean)
    .join(' · ')

  // Linha única (ícone · descrição · valor à direita), no padrão dos apps
  // de banco — legível no celular mesmo com descrição longa.
  const content = (
    <Card
      className={cn(
        'flex items-center gap-3 p-3 transition-shadow duration-500',
        selected && (payable || selectMode) && 'border-brand-500',
        highlighted && 'border-brand-500 ring-2 ring-brand-500/60',
      )}
    >
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
      {payable ? (
        <input
          type="checkbox"
          aria-label={`Selecionar ${transaction.description}`}
          checked={selected ?? false}
          onChange={onToggleSelect}
          className="relative z-10 h-4 w-4 shrink-0 accent-brand-500"
        />
      ) : null}
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: category?.color ?? '#6B7280' }}
      >
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-light-primary dark:text-dark-primary">
          {transaction.description}
        </p>
        {subtitle ? (
          <p className="truncate text-xs text-light-secondary dark:text-dark-secondary">{subtitle}</p>
        ) : null}
        {transaction.tags && transaction.tags.length > 0 ? (
          <p className="truncate text-xs text-brand-500">
            {transaction.tags.map((tag) => `#${tag}`).join(' ')}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <p
          className={cn(
            'whitespace-nowrap text-sm font-semibold',
            transaction.type === 'expense' ? 'text-danger' : 'text-brand-500',
          )}
        >
          {transaction.type === 'expense' ? '-' : '+'}
          {formatBRL(transaction.amount)}
        </p>
        {payable ? (
          <button
            type="button"
            disabled={confirming}
            onClick={onConfirm}
            className="relative z-10 inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning transition-colors duration-200 hover:border-brand-500 hover:bg-brand-500/10 hover:text-brand-500 disabled:opacity-50"
          >
            <CheckCircle2 size={12} />
            {confirming ? 'Salvando' : transaction.type === 'expense' ? 'Marcar pago' : 'Marcar recebido'}
          </button>
        ) : selectMode ? null : (
          <PaymentStatusBadge paid={transaction.paid} type={transaction.type} />
        )}
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

  const editPath = `/registros/${kind}/${transaction.id}/editar`

  // Com checkbox/botão dentro do card, o link vira uma camada por trás
  // (inputs não podem ficar dentro de <a>); os controles ficam em z-10.
  if (payable) {
    return (
      <div className="relative">
        <Link to={editPath} aria-label={`Editar ${transaction.description}`} className="absolute inset-0 z-0 rounded-2xl" />
        {content}
      </div>
    )
  }

  return <Link to={editPath}>{content}</Link>
}
