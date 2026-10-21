import { useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CheckCircle2, Pencil, Receipt } from 'lucide-react'
import { CATEGORY_ICON_COMPONENTS } from '../categories/types'
import type { Category } from '../categories/types'
import { PaymentStatusBadge } from './PaymentStatusBadge'
import { CategoryPickerSheet } from './CategoryPickerSheet'
import { updateTransactionCategory } from './api'
import { useToastStore } from '../../stores/toastStore'
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
  // Com a lista de categorias, o ícone vira botão de trocar só a categoria
  // ali mesmo, sem abrir o form.
  categories?: Category[]
  // Segurar o dedo na linha — o extrato usa pra entrar na seleção múltipla.
  onLongPress?: () => void
}

const LONG_PRESS_MS = 450
const LONG_PRESS_MOVE_TOLERANCE = 10

// Segurar sem arrastar (arrastar é rolar a lista). O clique que vem depois
// de soltar é engolido, senão abriria o form ou desmarcaria a linha que
// acabou de entrar na seleção.
function useLongPress(onLongPress: (() => void) | undefined) {
  const timer = useRef<number | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  function cancel() {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }

  function fire() {
    if (fired.current || !onLongPress) return
    fired.current = true
    navigator.vibrate?.(30)
    onLongPress()
  }

  if (!onLongPress) return {}

  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false
      if (e.button !== 0) return
      origin.current = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(fire, LONG_PRESS_MS)
    },
    onPointerMove: (e: PointerEvent) => {
      if (!origin.current) return
      const dx = e.clientX - origin.current.x
      const dy = e.clientY - origin.current.y
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // Android dispara o menu de contexto no toque longo; no computador é o
    // botão direito — nos dois casos vira "selecionar".
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault()
      cancel()
      fire()
    },
    onClickCapture: (e: MouseEvent) => {
      if (!fired.current) return
      fired.current = false
      e.preventDefault()
      e.stopPropagation()
    },
  }
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
  categories,
  onLongPress,
}: TransactionCompactCardProps) {
  const Icon = category ? CATEGORY_ICON_COMPONENTS[category.icon] : Receipt
  const kind = transaction.type === 'expense' ? 'despesa' : 'receita'
  const family = useWorkspaceStore((state) => state.family)
  const profiles = useUserProfiles(family ? [transaction.createdBy] : [])
  const authorName = family ? profiles.get(transaction.createdBy)?.displayName : undefined

  const payable = !selectMode && onConfirm !== undefined && !transaction.paid
  const quickCategory = !selectMode && categories !== undefined
  const [pickingCategory, setPickingCategory] = useState(false)
  const showToast = useToastStore((state) => state.show)
  const longPress = useLongPress(selectMode ? undefined : onLongPress)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)

  const subtitle = [
    showDate ? format(new Date(`${transaction.date}T00:00:00`), "d 'de' MMM", { locale: ptBR }) : null,
    category?.name,
    linkedName,
    authorName,
  ]
    .filter(Boolean)
    .join(' · ')

  // Linha única (ícone · descrição · valor à direita), no padrão dos apps
  // de banco — legível no celular mesmo com descrição longa. Sem caixa
  // própria: quem lista agrupa as linhas num bloco com divisórias.
  const content = (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-3 transition-colors duration-700',
        selected && (payable || selectMode) && 'bg-brand-500/10',
        highlighted && 'bg-brand-500/20',
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
      {quickCategory ? (
        <button
          type="button"
          aria-label={`Trocar categoria de ${transaction.description}`}
          title="Trocar categoria"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setPickingCategory(true)
          }}
          className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 hover:scale-105 active:scale-95"
          style={{ backgroundColor: `${category?.color ?? '#6B7280'}26`, color: category?.color ?? '#9CA3AF' }}
        >
          <Icon size={18} />
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-border-light bg-surface-light text-light-secondary dark:border-border-dark dark:bg-surface-dark-elevated dark:text-dark-secondary">
            <Pencil size={9} />
          </span>
        </button>
      ) : (
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${category?.color ?? '#6B7280'}26`, color: category?.color ?? '#9CA3AF' }}
        >
          <Icon size={18} />
        </span>
      )}
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
            'tabular whitespace-nowrap text-sm font-semibold',
            transaction.type === 'expense' ? 'text-light-primary dark:text-dark-primary' : 'text-brand-500',
            !transaction.paid && 'opacity-70',
          )}
        >
          {transaction.type === 'expense' ? '− ' : '+ '}
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
    </div>
  )

  const editPath = `/registros/${kind}/${transaction.id}/editar`

  let row
  if (selectMode) {
    row = (
      <button type="button" onClick={onToggleSelect} className="block w-full text-left">
        {content}
      </button>
    )
  } else if (payable || quickCategory) {
    // Com checkbox/botão dentro do card, o link vira uma camada por trás
    // (inputs não podem ficar dentro de <a>); os controles ficam em z-10.
    row = (
      <div className="relative">
        <Link to={editPath} aria-label={`Editar ${transaction.description}`} className="absolute inset-0 z-0" />
        {content}
      </div>
    )
  } else {
    row = <Link to={editPath}>{content}</Link>
  }

  // A janela de categoria fica fora da div do toque longo: evento de portal
  // sobe pela árvore do React, e segurar uma categoria não pode virar seleção.
  return (
    <>
      <div
        {...longPress}
        className={onLongPress && !selectMode ? 'select-none [-webkit-touch-callout:none]' : undefined}
      >
        {row}
      </div>
      {pickingCategory && categories && workspaceId ? (
        <CategoryPickerSheet
          title="Trocar categoria"
          subtitle={transaction.description}
          type={transaction.type}
          categories={categories}
          currentId={transaction.categoryId}
          onClose={() => setPickingCategory(false)}
          onPick={async (picked) => {
            await updateTransactionCategory(workspaceId, transaction.id, picked.id)
            setPickingCategory(false)
            showToast(`Categoria trocada para ${picked.name}.`)
          }}
        />
      ) : null}
    </>
  )
}
