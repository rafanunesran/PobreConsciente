import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useCategories } from '../categories/useCategories'
import { categoryOptions } from '../categories/categoryTree'
import { useTransactions } from '../transactions/useTransactions'
import { collectTags } from '../transactions/tags'
import { TagInput } from '../transactions/TagInput'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { cn } from '../../lib/utils'
import { normalizeSearch } from '../transactions/filterTransactions'
import { categoryRuleSchema, type CategoryRuleFormData } from './schemas'
import { createCategoryRule, deleteCategoryRule, updateCategoryRule } from './api'
import { useCategoryRules } from './useCategoryRules'
import type { CategoryRule } from './types'

const EMPTY: CategoryRuleFormData = { pattern: '', type: 'expense', categoryId: '', tags: [] }

export function CategoryRulesPage() {
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { rules, loading, error } = useCategoryRules(workspaceId ?? '')
  const { categories } = useCategories(workspaceId ?? '')
  const { transactions } = useTransactions(workspaceId ?? '')
  const tagSuggestions = useMemo(() => collectTags(transactions), [transactions])
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  // null = formulário fechado; 'new' = criando; regra = editando
  const [editing, setEditing] = useState<CategoryRule | 'new' | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const form = useForm<CategoryRuleFormData>({ resolver: zodResolver(categoryRuleSchema), defaultValues: EMPTY })
  const type = form.watch('type')
  const pattern = form.watch('pattern')

  // Prévia: quantos lançamentos já existentes essa regra teria pego —
  // ajuda a calibrar um trecho genérico demais ("pa" casa com tudo).
  const matches = useMemo(() => {
    const p = normalizeSearch(pattern ?? '')
    if (p.length < 2) return null
    return transactions.filter((t) => t.type === type && normalizeSearch(t.description).includes(p)).length
  }, [transactions, pattern, type])

  if (!user || !workspaceId) return null

  function open(rule: CategoryRule | 'new') {
    setFormError(null)
    setEditing(rule)
    form.reset(
      rule === 'new'
        ? EMPTY
        : { pattern: rule.pattern, type: rule.type, categoryId: rule.categoryId, tags: rule.tags ?? [] },
    )
  }

  async function onSubmit(data: CategoryRuleFormData) {
    if (!user || !workspaceId || editing === null) return
    setFormError(null)
    const duplicate = rules.some(
      (r) =>
        r.type === data.type &&
        normalizeSearch(r.pattern) === normalizeSearch(data.pattern) &&
        (editing === 'new' || r.id !== editing.id),
    )
    if (duplicate) {
      setFormError('Já existe uma regra com esse trecho.')
      return
    }
    try {
      if (editing === 'new') await createCategoryRule(workspaceId, data, user.uid)
      else await updateCategoryRule(workspaceId, editing, data)
      setEditing(null)
    } catch {
      setFormError('Não foi possível salvar a regra. Tente novamente.')
    }
  }

  async function handleDelete(rule: CategoryRule) {
    if (!workspaceId) return
    setDeletingId(rule.id)
    try {
      await deleteCategoryRule(workspaceId, rule.id)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">Regras de categoria</h1>
        {editing === null ? (
          <Button type="button" className="gap-1.5" onClick={() => open('new')}>
            <Plus size={18} />
            Nova
          </Button>
        ) : null}
      </div>
      <p className="-mt-3 text-sm text-light-secondary dark:text-dark-secondary">
        Quando a descrição de um lançamento contém o trecho, a categoria e as tags da regra são sugeridas
        sozinhas — ao importar extratos e ao criar lançamentos.
      </p>

      {editing !== null ? (
        <Card>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <Input
              label="Se a descrição contém"
              placeholder="Ex: uber, ifood, netflix"
              error={form.formState.errors.pattern?.message}
              {...form.register('pattern')}
            />
            {matches !== null ? (
              <p className="-mt-2 text-xs text-light-secondary dark:text-dark-secondary">
                {matches === 0
                  ? 'Nenhum lançamento existente tem esse trecho.'
                  : `${matches} lançamento(s) existente(s) têm esse trecho.`}
              </p>
            ) : null}
            <div className="flex gap-2">
              {(['expense', 'income'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    form.setValue('type', t)
                    form.setValue('categoryId', '')
                  }}
                  className={cn(
                    'flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-200',
                    type === t
                      ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                      : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
                  )}
                >
                  {t === 'expense' ? 'Despesa' : 'Receita'}
                </button>
              ))}
            </div>
            <Select
              label="Use a categoria"
              error={form.formState.errors.categoryId?.message}
              {...form.register('categoryId')}
            >
              <option value="">Selecione</option>
              {categoryOptions(categories, type).map(({ category, label }) => (
                <option key={category.id} value={category.id}>
                  {label}
                </option>
              ))}
            </Select>
            <TagInput
              value={form.watch('tags') ?? []}
              onChange={(tags) => form.setValue('tags', tags)}
              suggestions={tagSuggestions}
            />
            {formError ? <p className="text-sm text-danger">{formError}</p> : null}
            <div className="flex gap-3">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {loading ? (
        <div className="h-24 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
      ) : error ? (
        <p className="text-sm text-danger">
          Não foi possível carregar as regras. Verifique se as regras do Firestore foram publicadas.
        </p>
      ) : rules.length === 0 && editing === null ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-light px-6 py-12 text-center dark:border-border-dark">
          <Wand2 size={32} className="text-light-secondary dark:text-dark-secondary" />
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Nenhuma regra ainda. Ex: tudo com "uber" vai para Transporte.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => {
            const category = categoriesById.get(rule.categoryId)
            return (
              <Card key={rule.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm text-light-primary dark:text-dark-primary">
                    <span className="truncate font-medium">"{rule.pattern}"</span>
                    <ArrowRight size={14} className="shrink-0 text-light-secondary dark:text-dark-secondary" />
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: category?.color ?? '#6B7280' }}
                    />
                    <span className="truncate">{category?.name ?? 'Categoria excluída'}</span>
                  </p>
                  <p className="truncate text-xs text-light-secondary dark:text-dark-secondary">
                    {rule.type === 'expense' ? 'Despesa' : 'Receita'}
                    {rule.tags && rule.tags.length > 0 ? ` · ${rule.tags.map((t) => `#${t}`).join(' ')}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Editar regra"
                  onClick={() => open(rule)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-light-secondary hover:text-light-primary dark:text-dark-secondary dark:hover:text-dark-primary"
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Excluir regra"
                  disabled={deletingId === rule.id}
                  onClick={() => void handleDelete(rule)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-light-secondary hover:text-danger disabled:opacity-50 dark:text-dark-secondary"
                >
                  <Trash2 size={16} />
                </button>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
