import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, SquareCheck, Clock, Hash, Shapes, Square, Trash2, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { cn, formatBRL } from '../../lib/utils'
import { useToastStore } from '../../stores/toastStore'
import type { Category } from '../categories/types'
import { CategoryPickerSheet } from './CategoryPickerSheet'
import {
  addTagToTransactions,
  deleteManyTransactions,
  setTransactionsPaid,
  updateTransactionsCategory,
} from './api'
import { MAX_TAGS, MAX_TAG_LENGTH, normalizeTag } from './tags'
import type { TransactionSelection } from './useTransactionSelection'

interface SelectionActionsBarProps {
  workspaceId: string
  selection: TransactionSelection
  categories: Category[]
  // tags já usadas, pra sugerir na ação "Tag"
  knownTags?: string[]
  // Pago/Pendente só faz sentido em lançamento de conta — no cartão quem
  // paga é a fatura.
  allowPayment?: boolean
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

// Barra das ações em massa do extrato — aparece no modo seleção, grudada
// no topo ao rolar (mesmo lugar da barra "Pagar selecionados").
export function SelectionActionsBar({
  workspaceId,
  selection,
  categories,
  knownTags = [],
  allowPayment = true,
}: SelectionActionsBarProps) {
  const showToast = useToastStore((state) => state.show)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'category' | 'tag' | null>(null)

  if (!selection.active) return null

  const selected = selection.selected
  const count = selected.length
  const total = selected.reduce((sum, t) => sum + (t.type === 'expense' ? -t.amount : t.amount), 0)
  const types = new Set(selected.map((t) => t.type))
  const singleType = types.size === 1 ? selected[0]?.type : undefined
  const canPay = allowPayment && selected.some((t) => t.accountId !== undefined && !t.paid)
  const canUnpay = allowPayment && selected.some((t) => t.accountId !== undefined && t.paid)

  async function run(action: () => Promise<string>) {
    setError(null)
    setBusy(true)
    try {
      const message = await action()
      selection.exit()
      showToast(message)
    } catch {
      setError('Não foi possível concluir para todos. Confira os lançamentos e tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  function handleCategoryClick() {
    if (!singleType) {
      setError('Categoria: selecione só despesas ou só receitas (as categorias são separadas).')
      return
    }
    setError(null)
    setSheet('category')
  }

  function handleDelete() {
    if (!window.confirm(`Excluir ${plural(count, 'lançamento', 'lançamentos')}? Não dá para desfazer.`)) return
    void run(async () => {
      await deleteManyTransactions(
        workspaceId,
        selected.map((t) => t.id),
      )
      return `${plural(count, 'lançamento excluído', 'lançamentos excluídos')}.`
    })
  }

  return (
    <>
      <div className="sticky top-2 z-20 flex flex-col gap-2 rounded-2xl border border-brand-500 bg-surface-light p-3 shadow-lg dark:bg-surface-dark-elevated">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="px-2 py-1.5"
            aria-label="Sair da seleção"
            onClick={selection.exit}
            disabled={busy}
          >
            <X size={16} />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-light-secondary dark:text-dark-secondary">
              {count === 0
                ? 'Toque nos lançamentos'
                : `${count} selecionado${count > 1 ? 's' : ''}`}
            </p>
            {count > 0 ? (
              <p className={cn('truncate text-sm font-semibold', total < 0 ? 'text-danger' : 'text-brand-500')}>
                {formatBRL(total)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={selection.toggleAll}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-light-secondary hover:text-light-primary dark:text-dark-secondary dark:hover:text-dark-primary"
          >
            {selection.allSelected ? <SquareCheck size={14} /> : <Square size={14} />}
            {selection.allSelected ? 'Desmarcar todos' : 'Todos'}
          </button>
        </div>

        {count > 0 ? (
          <div className="flex flex-wrap gap-2">
            <ActionChip icon={<Shapes size={14} />} disabled={busy} onClick={handleCategoryClick}>
              Categoria
            </ActionChip>
            {canPay ? (
              <ActionChip
                icon={<CheckCircle2 size={14} />}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const n = await setTransactionsPaid(workspaceId, selected, true)
                    return `${plural(n, 'lançamento marcado', 'lançamentos marcados')} como pago.`
                  })
                }
              >
                Pago
              </ActionChip>
            ) : null}
            {canUnpay ? (
              <ActionChip
                icon={<Clock size={14} />}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const n = await setTransactionsPaid(workspaceId, selected, false)
                    return `${plural(n, 'lançamento voltou', 'lançamentos voltaram')} para pendente.`
                  })
                }
              >
                Pendente
              </ActionChip>
            ) : null}
            <ActionChip icon={<Hash size={14} />} disabled={busy} onClick={() => setSheet('tag')}>
              Tag
            </ActionChip>
            <ActionChip icon={<Trash2 size={14} />} disabled={busy} onClick={handleDelete} danger>
              Excluir
            </ActionChip>
          </div>
        ) : null}

        {busy ? <p className="text-xs text-light-secondary dark:text-dark-secondary">Salvando...</p> : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>

      {sheet === 'category' && singleType ? (
        <CategoryPickerSheet
          title="Categoria dos selecionados"
          subtitle={plural(count, 'lançamento', 'lançamentos')}
          type={singleType}
          categories={categories}
          onClose={() => setSheet(null)}
          onPick={async (picked) => {
            await updateTransactionsCategory(
              workspaceId,
              selected.map((t) => t.id),
              picked.id,
            )
            setSheet(null)
            selection.exit()
            showToast(`${plural(count, 'lançamento', 'lançamentos')} em ${picked.name}.`)
          }}
        />
      ) : null}

      {sheet === 'tag' ? (
        <TagSheet
          knownTags={knownTags}
          count={count}
          onClose={() => setSheet(null)}
          onSave={async (tag) => {
            const n = await addTagToTransactions(workspaceId, selected, tag, MAX_TAGS)
            setSheet(null)
            selection.exit()
            showToast(
              n === count
                ? `Tag #${tag} em ${plural(n, 'lançamento', 'lançamentos')}.`
                : `Tag #${tag} em ${n} de ${count} (os outros já tinham a tag ou ${MAX_TAGS} tags).`,
            )
          }}
        />
      ) : null}
    </>
  )
}

function ActionChip({
  icon,
  children,
  onClick,
  disabled,
  danger = false,
}: {
  icon: ReactNode
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-200 disabled:opacity-50',
        danger
          ? 'border-danger/40 text-danger hover:bg-danger/10'
          : 'border-border-light text-light-primary hover:border-brand-500 hover:text-brand-500 dark:border-border-dark dark:text-dark-primary',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function TagSheet({
  knownTags,
  count,
  onClose,
  onSave,
}: {
  knownTags: string[]
  count: number
  onClose: () => void
  onSave: (tag: string) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(raw: string) {
    const tag = normalizeTag(raw)
    if (!tag) {
      setError('Digite a tag.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(tag)
    } catch {
      setError('Não foi possível adicionar a tag. Tente novamente.')
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <button
        type="button"
        aria-label="Cancelar"
        className="absolute inset-0 cursor-default"
        onClick={saving ? undefined : onClose}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Adicionar tag"
        onSubmit={(e) => {
          e.preventDefault()
          void save(value)
        }}
        className="relative flex w-full max-w-md flex-col gap-4 rounded-t-2xl border border-border-light bg-surface-light p-6 sm:rounded-2xl dark:border-border-dark dark:bg-surface-dark-elevated"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-light-primary dark:text-dark-primary">Adicionar tag</h2>
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Vai em {plural(count, 'lançamento', 'lançamentos')}. As tags que já estão lá continuam.
          </p>
        </div>
        <Input
          label="Tag"
          value={value}
          maxLength={MAX_TAG_LENGTH + 1}
          autoFocus
          placeholder="ex.: viagem"
          onChange={(e) => setValue(e.target.value)}
        />
        {knownTags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {knownTags.slice(0, 12).map((tag) => (
              <button
                key={tag}
                type="button"
                disabled={saving}
                onClick={() => void save(tag)}
                className="rounded-full border border-border-light px-3 py-1 text-xs text-brand-500 hover:border-brand-500 dark:border-border-dark"
              >
                #{tag}
              </button>
            ))}
          </div>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" disabled={saving}>
            {saving ? 'Salvando...' : 'Adicionar'}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
