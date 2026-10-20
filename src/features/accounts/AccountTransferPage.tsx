import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from './useAccounts'
import { transferBetweenAccounts } from './accountTransfers'
import { accountTransferSchema, type AccountTransferFormData } from './schemas'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { formatBRL } from '../../lib/utils'

export function AccountTransferPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromParam = searchParams.get('from') ?? ''
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)

  const { accounts, loading } = useAccounts(workspaceId ?? '')
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<AccountTransferFormData>({
    resolver: zodResolver(accountTransferSchema),
    defaultValues: { fromAccountId: fromParam, toAccountId: '', amount: 0 },
  })

  useEffect(() => {
    if (fromParam) form.setValue('fromAccountId', fromParam)
  }, [fromParam, form])

  const fromAccountId = form.watch('fromAccountId')
  const fromAccount = accounts.find((a) => a.id === fromAccountId)

  if (!user || !workspaceId) return null

  async function onSubmit(data: AccountTransferFormData) {
    if (!workspaceId || !user) return
    setFormError(null)
    const source = accounts.find((a) => a.id === data.fromAccountId)
    if (source && data.amount > source.balance) {
      setFormError('O valor não pode ser maior que o saldo da conta de origem.')
      return
    }
    try {
      await transferBetweenAccounts(workspaceId, data.fromAccountId, data.toAccountId, data.amount, user.uid)
      navigate(fromParam ? `/contas/${fromParam}` : '/contas')
    } catch {
      setFormError('Não foi possível concluir a transferência. Tente novamente.')
    }
  }

  if (loading) {
    return (
      <div className="px-6 pt-4 text-sm text-light-secondary dark:text-dark-secondary">
        Carregando...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">
        Transferência entre contas
      </h1>

      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <Select
          label="De"
          error={form.formState.errors.fromAccountId?.message}
          {...form.register('fromAccountId')}
        >
          <option value="">Selecione</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
        {fromAccount ? (
          <p className="-mt-2 text-sm text-light-secondary dark:text-dark-secondary">
            Saldo disponível: {formatBRL(fromAccount.balance)}
          </p>
        ) : null}

        <Select
          label="Para"
          error={form.formState.errors.toAccountId?.message}
          {...form.register('toAccountId')}
        >
          <option value="">Selecione</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>

        <Input
          label="Valor"
          type="number"
          step="0.01"
          error={form.formState.errors.amount?.message}
          {...form.register('amount', { valueAsNumber: true })}
        />

        {formError ? <p className="text-sm text-danger">{formError}</p> : null}

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Transferindo...' : 'Transferir'}
        </Button>
      </form>
    </div>
  )
}
