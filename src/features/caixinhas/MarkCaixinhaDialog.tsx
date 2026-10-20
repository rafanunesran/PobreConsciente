import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { formatBRL } from '../../lib/utils'
import type { Transaction } from '../transactions/types'
import { createCaixinha } from './api'
import { markTransactionAsCaixinha } from './markTransaction'
import { useCaixinhas } from './useCaixinhas'

const NEW_CAIXINHA = '__nova__'

interface MarkCaixinhaDialogProps {
  workspaceId: string
  uid: string
  transaction: Transaction & { accountId: string }
  similarCount: number // outras movimentações iguais já lançadas
  onClose: () => void
  onDone: (converted: number, caixinhaName: string) => void
}

// "Esta movimentação é a caixinha X" — a pessoa escolhe uma vez e o app
// guarda a regra pras próximas iguais (ver markTransaction.ts).
export function MarkCaixinhaDialog({
  workspaceId,
  uid,
  transaction,
  similarCount,
  onClose,
  onDone,
}: MarkCaixinhaDialogProps) {
  const { caixinhas, loading } = useCaixinhas(workspaceId, transaction.accountId)
  const [selected, setSelected] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isGuardar = transaction.type === 'expense'

  // sem caixinha na conta, já abre criando uma
  useEffect(() => {
    if (loading || selected) return
    setSelected(caixinhas.length === 1 ? (caixinhas[0]?.id ?? '') : caixinhas.length === 0 ? NEW_CAIXINHA : '')
  }, [loading, caixinhas, selected])

  async function handleConfirm() {
    setError(null)
    const name = newName.trim()
    if (!selected) {
      setError('Escolha a caixinha.')
      return
    }
    if (selected === NEW_CAIXINHA && (name.length === 0 || name.length > 40)) {
      setError('Dê um nome de até 40 caracteres pra caixinha.')
      return
    }
    setBusy(true)
    try {
      const caixinhaId =
        selected === NEW_CAIXINHA
          ? await createCaixinha(workspaceId, transaction.accountId, { name }, uid)
          : selected
      const caixinhaName =
        selected === NEW_CAIXINHA ? name : (caixinhas.find((c) => c.id === selected)?.name ?? '')
      const converted = await markTransactionAsCaixinha(workspaceId, transaction, caixinhaId, uid)
      onDone(converted, caixinhaName)
    } catch {
      setError('Não foi possível mover pra caixinha. Tente novamente.')
      setBusy(false)
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
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Qual é a caixinha?"
        className="relative flex w-full max-w-md flex-col gap-4 rounded-t-2xl border border-border-light bg-surface-light p-6 sm:rounded-2xl dark:border-border-dark dark:bg-surface-dark-elevated"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-light-primary dark:text-dark-primary">
            Qual é a caixinha?
          </h2>
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            "{transaction.description}" ({formatBRL(transaction.amount)}) foi dinheiro{' '}
            {isGuardar ? 'guardado na' : 'resgatado da'} caixinha. Ela sai das{' '}
            {isGuardar ? 'despesas' : 'receitas'} e o valor {isGuardar ? 'entra na' : 'sai da'} caixinha.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-light-secondary dark:text-dark-secondary">Carregando caixinhas...</p>
        ) : (
          <>
            <Select label="Caixinha" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Selecione</option>
              {caixinhas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW_CAIXINHA}>+ Nova caixinha</option>
            </Select>
            {selected === NEW_CAIXINHA ? (
              <Input
                label="Nome da nova caixinha"
                value={newName}
                maxLength={40}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
              />
            ) : null}
          </>
        )}

        <p className="text-sm text-light-secondary dark:text-dark-secondary">
          As próximas movimentações com essa mesma descrição nesta conta vão direto pra essa caixinha.
          {similarCount > 0
            ? ` ${similarCount === 1 ? 'Outra igual já lançada também vai' : `Outras ${similarCount} iguais já lançadas também vão`}.`
            : ''}
        </p>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="button" className="flex-1" onClick={handleConfirm} disabled={busy || loading}>
            {busy ? 'Movendo...' : 'Confirmar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
