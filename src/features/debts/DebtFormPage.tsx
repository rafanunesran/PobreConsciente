import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { cn } from '../../lib/utils'
import { debtSchema, type DebtFormData } from './schemas'
import { createDebt, deleteDebt, getDebt, updateDebt } from './api'
import { DEBT_DIRECTION_LABELS, DEBT_DIRECTIONS, type Debt } from './types'

export function DebtFormPage() {
  const navigate = useNavigate()
  const { debtId } = useParams<{ debtId?: string }>()
  const isEditMode = Boolean(debtId)
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)

  const [debt, setDebt] = useState<Debt | null>(null)
  const [isLoading, setIsLoading] = useState(isEditMode)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const form = useForm<DebtFormData>({
    resolver: zodResolver(debtSchema),
    defaultValues: { direction: 'owed', person: '', description: '', amount: 0, dueDate: '' },
  })

  useEffect(() => {
    if (!workspaceId || !debtId) return
    let cancelled = false
    getDebt(workspaceId, debtId)
      .then((found) => {
        if (cancelled) return
        if (!found) {
          navigate('/dividas', { replace: true })
          return
        }
        setDebt(found)
        form.reset({
          direction: found.direction,
          person: found.person,
          description: found.description,
          amount: found.amount,
          dueDate: found.dueDate ?? '',
        })
        setIsLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setFormError('Não foi possível carregar. Tente novamente.')
          setIsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, debtId, form, navigate])

  if (!user || !workspaceId) return null

  async function onSubmit(data: DebtFormData) {
    if (!user || !workspaceId) return
    setFormError(null)
    try {
      if (debt) {
        await updateDebt(workspaceId, debt, data)
        navigate(`/dividas/${debt.id}`)
      } else {
        const id = await createDebt(workspaceId, data, user.uid)
        navigate(`/dividas/${id}`)
      }
    } catch {
      setFormError('Não foi possível salvar. Tente novamente.')
    }
  }

  async function handleDelete() {
    if (!workspaceId || !debtId) return
    setIsDeleting(true)
    try {
      await deleteDebt(workspaceId, debtId)
      navigate('/dividas')
    } catch {
      setFormError('Não foi possível excluir. Tente novamente.')
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return <div className="px-6 pt-4 text-sm text-light-secondary dark:text-dark-secondary">Carregando...</div>
  }

  const direction = form.watch('direction')

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">
        {isEditMode ? 'Editar dívida' : 'Nova dívida ou empréstimo'}
      </h1>

      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <div className="flex gap-2">
          {DEBT_DIRECTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => form.setValue('direction', d)}
              className={cn(
                'flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-200',
                direction === d
                  ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                  : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
              )}
            >
              {DEBT_DIRECTION_LABELS[d]}
            </button>
          ))}
        </div>
        <Input
          label={direction === 'owed' ? 'Quem te deve' : 'Para quem você deve'}
          placeholder="Ex: João"
          error={form.formState.errors.person?.message}
          {...form.register('person')}
        />
        <Input
          label="Descrição (opcional)"
          placeholder="Ex: Metade do aluguel da casa de praia"
          error={form.formState.errors.description?.message}
          {...form.register('description')}
        />
        <Input
          label="Valor total"
          type="number"
          step="0.01"
          error={form.formState.errors.amount?.message}
          {...form.register('amount', { valueAsNumber: true })}
        />
        <Input label="Vencimento (opcional)" type="date" {...form.register('dueDate')} />

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
                Apaga a dívida e o histórico de pagamentos. Lançamentos já criados nas contas continuam lá.
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
              Excluir
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}
