import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { cn } from '../../lib/utils'
import { categorySchema, type CategoryFormData } from './schemas'
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  CATEGORY_ICON_COMPONENTS,
  CATEGORY_TYPE_LABELS,
  CATEGORY_TYPES,
} from './types'
import { createCategory, deleteCategory, getCategory, updateCategory } from './api'
import { useCategories } from './useCategories'

export function CategoryFormPage() {
  const navigate = useNavigate()
  const { categoryId } = useParams<{ categoryId?: string }>()
  const isEditMode = Boolean(categoryId)
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { categories } = useCategories(workspaceId ?? '')

  const [formError, setFormError] = useState<string | null>(null)
  const [isLoadingCategory, setIsLoadingCategory] = useState(isEditMode)
  const [loadError, setLoadError] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const form = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '', type: 'expense', icon: 'more', color: '#10B981', parentId: '' },
  })

  useEffect(() => {
    if (!workspaceId || !categoryId) return
    let cancelled = false
    getCategory(workspaceId, categoryId)
      .then((category) => {
        if (cancelled) return
        if (!category) {
          navigate('/categorias', { replace: true })
          return
        }
        form.reset({
          name: category.name,
          type: category.type,
          icon: category.icon,
          color: category.color,
          parentId: category.parentId ?? '',
        })
        setIsLoadingCategory(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoadError(true)
        setIsLoadingCategory(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, categoryId, form, navigate])

  if (!user || !workspaceId) return null

  async function onSubmit(data: CategoryFormData) {
    if (!user || !workspaceId) return
    setFormError(null)
    try {
      if (categoryId) {
        await updateCategory(workspaceId, categoryId, data)
      } else {
        await createCategory(workspaceId, data, user.uid)
      }
      navigate('/categorias')
    } catch {
      setFormError('Não foi possível salvar a categoria. Tente novamente.')
    }
  }

  async function handleDelete() {
    if (!workspaceId || !categoryId) return
    setIsDeleting(true)
    try {
      await deleteCategory(workspaceId, categoryId)
      navigate('/categorias')
    } catch {
      setFormError('Não foi possível excluir a categoria. Tente novamente.')
      setIsDeleting(false)
    }
  }

  if (isEditMode && isLoadingCategory) {
    return (
      <div className="px-6 pt-4 text-sm text-light-secondary dark:text-dark-secondary">
        Carregando...
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-3 px-6 pt-4">
        <p className="text-sm text-danger">
          Não foi possível carregar essa categoria. Verifique sua conexão ou tente novamente mais
          tarde.
        </p>
        <Button type="button" variant="secondary" onClick={() => navigate('/categorias')}>
          Voltar
        </Button>
      </div>
    )
  }

  const selectedIcon = form.watch('icon')
  const selectedColor = form.watch('color')
  const selectedType = form.watch('type')
  // Só um nível: quem já tem filhas não pode virar filha, e só categorias
  // principais do mesmo tipo podem ser mãe.
  const hasChildren = categories.some((c) => c.parentId === categoryId)
  const parentCandidates = categories.filter(
    (c) => c.type === selectedType && c.parentId === undefined && c.id !== categoryId,
  )

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">
        {isEditMode ? 'Editar categoria' : 'Nova categoria'}
      </h1>

      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <Input
          label="Nome"
          placeholder="Ex: Alimentação"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-light-secondary dark:text-dark-secondary">Tipo</span>
          <div className="flex gap-2">
            {CATEGORY_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  form.setValue('type', type, { shouldValidate: true })
                  // a mãe precisa ser do mesmo tipo — trocar o tipo solta o vínculo
                  form.setValue('parentId', '')
                }}
                className={cn(
                  'flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-200',
                  selectedType === type
                    ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                    : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
                )}
              >
                {CATEGORY_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        {hasChildren ? (
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Esta categoria tem subcategorias, então não pode virar subcategoria.
          </p>
        ) : (
          <Select label="Subcategoria de (opcional)" {...form.register('parentId')}>
            <option value="">Nenhuma — categoria principal</option>
            {parentCandidates.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-light-secondary dark:text-dark-secondary">Ícone</span>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_ICONS.map((icon) => {
              const Icon = CATEGORY_ICON_COMPONENTS[icon]
              return (
                <button
                  key={icon}
                  type="button"
                  onClick={() => form.setValue('icon', icon, { shouldValidate: true })}
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-full border transition-all duration-200',
                    selectedIcon === icon
                      ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                      : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
                  )}
                >
                  <Icon size={18} />
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-light-secondary dark:text-dark-secondary">Cor</span>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                onClick={() => form.setValue('color', color, { shouldValidate: true })}
                className="flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-200"
                style={{ backgroundColor: color }}
              >
                {selectedColor === color ? <Check size={16} className="text-white" /> : null}
              </button>
            ))}
          </div>
        </div>

        {formError ? <p className="text-sm text-danger">{formError}</p> : null}

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Salvando...' : 'Salvar'}
        </Button>
      </form>

      {isEditMode ? (
        <div className="border-t border-border-light pt-4 dark:border-border-dark">
          {confirmingDelete ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-light-secondary dark:text-dark-secondary">
                Tem certeza? Essa ação não pode ser desfeita.
                {hasChildren ? ' As subcategorias dela viram categorias principais.' : ''}
              </p>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={isDeleting}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  className="flex-1 bg-danger hover:bg-danger hover:shadow-none"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Excluindo...' : 'Confirmar exclusão'}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(true)}>
              Excluir categoria
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}
