import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { CATEGORY_ICON_COMPONENTS, type Category, type CategoryType } from '../categories/types'
import { categoryOptions } from '../categories/categoryTree'
import { cn } from '../../lib/utils'

interface CategoryPickerSheetProps {
  title: string
  subtitle?: string
  type: CategoryType
  categories: Category[]
  currentId?: string
  onPick: (category: Category) => Promise<void>
  onClose: () => void
}

// Lista de categorias de um toque (sem <select> nem form): escolheu, já
// salva e fecha. Usada pelo botão de categoria de cada lançamento e pela
// ação em massa do extrato. Portal pro body porque as listas do extrato
// têm overflow-hidden.
export function CategoryPickerSheet({
  title,
  subtitle,
  type,
  categories,
  currentId,
  onPick,
  onClose,
}: CategoryPickerSheetProps) {
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const options = categoryOptions(categories, type)

  async function handlePick(category: Category) {
    if (savingId) return
    if (category.id === currentId) {
      onClose()
      return
    }
    setError(null)
    setSavingId(category.id)
    try {
      await onPick(category)
    } catch {
      setError('Não foi possível trocar a categoria. Tente novamente.')
      setSavingId(null)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <button
        type="button"
        aria-label="Cancelar"
        className="absolute inset-0 cursor-default"
        onClick={savingId ? undefined : onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[80vh] w-full max-w-md flex-col gap-3 rounded-t-2xl border border-border-light bg-surface-light p-4 sm:rounded-2xl dark:border-border-dark dark:bg-surface-dark-elevated"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-light-primary dark:text-dark-primary">{title}</h2>
            {subtitle ? (
              <p className="truncate text-sm text-light-secondary dark:text-dark-secondary">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            disabled={savingId !== null}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-light-secondary hover:text-light-primary dark:text-dark-secondary dark:hover:text-dark-primary"
          >
            <X size={18} />
          </button>
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {options.length === 0 ? (
          <p className="py-6 text-center text-sm text-light-secondary dark:text-dark-secondary">
            Nenhuma categoria de {type === 'expense' ? 'despesa' : 'receita'} cadastrada.
          </p>
        ) : (
          <ul className="-mx-1 flex flex-col overflow-y-auto">
            {options.map(({ category, isChild }) => {
              const Icon = CATEGORY_ICON_COMPONENTS[category.icon]
              const current = category.id === currentId
              return (
                <li key={category.id}>
                  <button
                    type="button"
                    disabled={savingId !== null}
                    onClick={() => void handlePick(category)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-200 hover:bg-border-light disabled:opacity-60 dark:hover:bg-border-dark',
                      isChild && 'pl-8',
                      current && 'bg-brand-500/10',
                    )}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${category.color}26`, color: category.color }}
                    >
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-light-primary dark:text-dark-primary">
                      {category.name}
                    </span>
                    {savingId === category.id ? (
                      <span className="text-xs text-light-secondary dark:text-dark-secondary">Salvando...</span>
                    ) : current ? (
                      <Check size={16} className="shrink-0 text-brand-500" />
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  )
}
