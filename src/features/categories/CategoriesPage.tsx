import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CornerDownRight, Plus, Wand2 } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useCategories } from './useCategories'
import { createCategory } from './api'
import { CATEGORY_ICON_COMPONENTS, CATEGORY_TYPE_LABELS, SUGGESTED_CATEGORIES, type Category, type CategoryType } from './types'
import { Button } from '../../components/ui/Button'
import { useUserProfiles } from '../family/useUserProfiles'
import { effectiveParentId } from './categoryTree'

function CategoryChip({ category, isChild }: { category: Category; isChild?: boolean }) {
  const Icon = CATEGORY_ICON_COMPONENTS[category.icon]
  const family = useWorkspaceStore((state) => state.family)
  const profiles = useUserProfiles(family ? [category.createdBy] : [])
  const authorName = family ? profiles.get(category.createdBy)?.displayName : undefined
  return (
    <Link
      to={`/categorias/${category.id}/editar`}
      className="flex items-center gap-2 rounded-xl border border-border-light bg-surface-light py-2 pl-2 pr-3 transition-colors duration-200 hover:border-brand-500 dark:border-border-dark dark:bg-surface-dark-elevated"
    >
      {isChild ? <CornerDownRight size={14} className="text-light-secondary dark:text-dark-secondary" /> : null}
      <span
        className="flex h-8 w-8 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: category.color }}
      >
        <Icon size={16} />
      </span>
      <span className="flex flex-col">
        <span className="text-sm text-light-primary dark:text-dark-primary">{category.name}</span>
        {authorName ? (
          <span className="text-[11px] text-light-secondary dark:text-dark-secondary">
            {authorName}
          </span>
        ) : null}
      </span>
    </Link>
  )
}

function SuggestionSection({
  type,
  categories,
}: {
  type: CategoryType
  categories: Category[]
}) {
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const [creating, setCreating] = useState<string | null>(null)

  const existingNames = new Set(categories.filter((c) => c.type === type).map((c) => c.name.toLowerCase()))
  const suggestions = SUGGESTED_CATEGORIES.filter(
    (s) => s.type === type && !existingNames.has(s.name.toLowerCase()),
  )

  if (!user || !workspaceId || suggestions.length === 0) return null

  async function handleCreate(suggestion: (typeof SUGGESTED_CATEGORIES)[number]) {
    if (!user || !workspaceId) return
    setCreating(suggestion.name)
    try {
      // NOTE: sem refresh manual — useCategories usa onSnapshot (tempo
      // real), a lista atualiza sozinha assim que o Firestore confirma.
      await createCategory(workspaceId, suggestion, user.uid)
    } finally {
      setCreating(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((suggestion) => {
        const Icon = CATEGORY_ICON_COMPONENTS[suggestion.icon]
        return (
          <button
            key={suggestion.name}
            type="button"
            disabled={creating === suggestion.name}
            onClick={() => handleCreate(suggestion)}
            className="flex items-center gap-2 rounded-xl border border-dashed border-border-light py-2 pl-2 pr-3 text-light-secondary transition-colors duration-200 hover:border-brand-500 hover:text-brand-500 disabled:opacity-50 dark:border-border-dark dark:text-dark-secondary"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-border-light dark:bg-border-dark">
              <Icon size={16} />
            </span>
            <span className="text-sm">{suggestion.name}</span>
            <Plus size={14} />
          </button>
        )
      })}
    </div>
  )
}

export function CategoriesPage() {
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { categories, loading, error } = useCategories(workspaceId ?? '')

  if (!user || !workspaceId) return null

  const categoriesById = new Map(categories.map((c) => [c.id, c]))

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">
          Categorias
        </h1>
        <div className="flex gap-2">
          <Link to="/categorias/regras">
            <Button type="button" variant="secondary" className="gap-1.5">
              <Wand2 size={18} />
              Regras
            </Button>
          </Link>
          <Link to="/categorias/nova">
            <Button type="button" className="gap-1.5">
              <Plus size={18} />
              Nova
            </Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="h-24 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
      ) : error ? (
        <p className="text-sm text-danger">
          Não foi possível carregar suas categorias. Verifique sua conexão ou tente novamente
          mais tarde.
        </p>
      ) : (
        <>
          {(['expense', 'income'] as const).map((type) => (
            <div key={type} className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-light-secondary dark:text-dark-secondary">
                {CATEGORY_TYPE_LABELS[type]}
              </h2>
              <div className="flex flex-wrap gap-2">
                {categories
                  .filter((category) => category.type === type && effectiveParentId(category, categoriesById) === undefined)
                  .map((category) => {
                    const children = categories.filter(
                      (c) => effectiveParentId(c, categoriesById) === category.id,
                    )
                    return children.length === 0 ? (
                      <CategoryChip key={category.id} category={category} />
                    ) : (
                      // Mãe + filhas num bloco só, ocupando a linha inteira
                      // pra deixar claro o agrupamento.
                      <div key={category.id} className="flex w-full flex-wrap gap-2">
                        <CategoryChip category={category} />
                        {children.map((child) => (
                          <CategoryChip key={child.id} category={child} isChild />
                        ))}
                      </div>
                    )
                  })}
              </div>
              <SuggestionSection type={type} categories={categories} />
            </div>
          ))}
        </>
      )}
    </div>
  )
}
