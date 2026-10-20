import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { transferBetweenAccounts } from './accountTransfers'
import { useAuthStore } from '../../stores/authStore'
import { accountTransferSchema, type AccountTransferFormData } from './schemas'
import type { Account } from './types'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { formatBRL } from '../../lib/utils'

interface QuickTransferDialogProps {
  workspaceId: string
  from: Account
  accounts: Account[]
  onClose: () => void
}

// Transferência rápida a partir do tile da conta — a origem já vem fixa,
// então só pergunta quanto e pra onde. Mesma regra da AccountTransferPage.
export function QuickTransferDialog({ workspaceId, from, accounts, onClose }: QuickTransferDialogProps) {
  const user = useAuthStore((state) => state.user)
  const [formError, setFormError] = useState<string | null>(null)
  const destinations = accounts.filter((a) => a.id !== from.id)

  const form = useForm<AccountTransferFormData>({
    resolver: zodResolver(accountTransferSchema),
    defaultValues: {
      fromAccountId: from.id,
      toAccountId: destinations.length === 1 ? (destinations[0]?.id ?? '') : '',
      amount: undefined,
    },
  })
  const busy = form.formState.isSubmitting

  async function onSubmit(data: AccountTransferFormData) {
    setFormError(null)
    if (!user) return
    if (data.amount > from.balance) {
      setFormError('O valor não pode ser maior que o saldo da conta de origem.')
      return
    }
    try {
      await transferBetweenAccounts(workspaceId, from.id, data.toAccountId, data.amount, user.uid)
      onClose()
    } catch {
      setFormError('Não foi possível concluir a transferência. Tente novamente.')
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
      <button
        type="button"
        aria-label="Cancelar"
        className="absolute inset-0 cursor-default"
        onClick={busy ? undefined : onClose}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-label={`Transferir de ${from.name}`}
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="relative flex w-full max-w-md flex-col gap-4 rounded-t-2xl border border-border-light bg-surface-light p-6 sm:rounded-2xl dark:border-border-dark dark:bg-surface-dark-elevated"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-light-primary dark:text-dark-primary">
            Transferir de {from.name}
          </h2>
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Saldo disponível: {formatBRL(from.balance)}
          </p>
        </div>

        {destinations.length === 0 ? (
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Você precisa de outra conta para transferir.
          </p>
        ) : (
          <>
            <Input
              label="Quanto?"
              type="number"
              step="0.01"
              inputMode="decimal"
              autoFocus
              error={form.formState.errors.amount?.message}
              {...form.register('amount', { valueAsNumber: true })}
            />

            <Select
              label="Para qual conta?"
              error={form.formState.errors.toAccountId?.message}
              {...form.register('toAccountId')}
            >
              <option value="">Selecione</option>
              {destinations.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </>
        )}

        {formError ? <p className="text-sm text-danger">{formError}</p> : null}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" disabled={busy || destinations.length === 0}>
            {busy ? 'Transferindo...' : 'Transferir'}
          </Button>
        </div>
      </form>
    </div>
  )
}
