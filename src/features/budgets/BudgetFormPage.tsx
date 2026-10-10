import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useCategories } from '../categories/useCategories'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { categoryOptions } from '../categories/categoryTree'
import { budgetSchema, type BudgetFormData } from './schemas'
import { createBudget, deleteBudget, getBudget, updateBudget } from './api'
import { useBudgets } from './useBudgets'

export function BudgetFormPage() {
  const navigate = useNavigate()
  const { budgetId } = useParams<{ budgetId?: string }>()
  const isEditMode = Boolean(budgetId)
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { categories } = useCategories(workspaceId ?? '')
  const { budgets } = useBudgets(workspaceId ?? '')

  const [formError, setFormError] = useState<string | null>(null)
  const [isLoadingBudget, setIsLoadingBudget] = useState(isEditMode)
  const [loadError, setLoadError] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const form = useForm<BudgetFormData>({
    resolver: zodResolver(budgetSchema),
    defaultValues: { categoryId: '', amount: 0 },
  })

  useEffect(() => {
    if (!workspaceId || !budgetId) return
    let cancelled = false
    getBudget(workspaceId, budgetId)
      .then((budget) => {
        if (cancelled) return
        if (!budget) {
          navigate('/orcamentos', { replace: true })
          return
        }
        form.reset({ categoryId: budget.categoryId, amount: budget.amount })
        setIsLoadingBudget(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoadError(true)
        setIsLoadingBudget(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, budgetId, form, navigate])

  if (!user || !workspaceId) return null

  // Uma categoria só pode ter um orçamento — as que já têm somem da lista
  // (exceto a do próprio orçamento sendo editado).
  const takenCategoryIds = new Set(budgets.filter((b) => b.id !== budgetId).map((b) => b.categoryId))
  const availableCategories = categoryOptions(categories, 'expense').filter(
    ({ category }) => !takenCategoryIds.has(category.id),
  )

  async function onSubmit(data: BudgetFormData) {
    if (!user || !workspaceId) return
    setFormError(null)
    if (takenCategoryIds.has(data.categoryId)) {
      setFormError('Essa categoria já tem um orçamento.')
      return
    }
    try {
      if (budgetId) {
        await updateBudget(workspaceId, budgetId, data)
      } else {
        await createBudget(workspaceId, data, user.uid)
      }
      navigate('/orcamentos')
    } catch {
      setFormError('Não foi possível salvar o orçamento. Tente novamente.')
    }
  }

  async function handleDelete() {
    if (!workspaceId || !budgetId) return
    setIsDeleting(true)
    try {
      await deleteBudget(workspaceId, budgetId)
      navigate('/orcamentos')
    } catch {
      setFormError('Não foi possível excluir o orçamento. Tente novamente.')
      setIsDeleting(false)
    }
  }

  if (isEditMode && isLoadingBudget) {
    return (
      <div className="px-6 pt-4 text-sm text-light-secondary dark:text-dark-secondary">Carregando...</div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-3 px-6 pt-4">
        <p className="text-sm text-danger">
          Não foi possível carregar esse orçamento. Verifique sua conexão ou tente novamente mais tarde.
        </p>
        <Button type="button" variant="secondary" onClick={() => navigate('/orcamentos')}>
          Voltar
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">
          {isEditMode ? 'Editar orçamento' : 'Novo orçamento'}
        </h1>
        <p className="text-sm text-light-secondary dark:text-dark-secondary">
          Limite de gastos que vale para todo mês nesta categoria.
        </p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <Select
          label="Categoria"
          error={form.formState.errors.categoryId?.message}
          {...form.register('categoryId')}
        >
          <option value="">Selecione</option>
          {availableCategories.map(({ category, label }) => (
            <option key={category.id} value={category.id}>
              {label}
            </option>
          ))}
        </Select>
        <Input
          label="Limite mensal"
          type="number"
          step="0.01"
          error={form.formState.errors.amount?.message}
          {...form.register('amount', { valueAsNumber: true })}
        />

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
                O orçamento some, mas nenhum lançamento é apagado.
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
              Excluir orçamento
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}
