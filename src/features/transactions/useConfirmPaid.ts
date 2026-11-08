import { useState } from 'react'
import { updateTransaction } from './api'
import type { Transaction } from './types'

// Botão "Marcar pago"/"Marcar recebido" de cada pendente. Pagar vários de
// uma vez é pela seleção (segurar a linha → "Pago").
export function useConfirmPaid(workspaceId: string) {
  const [confirmingIds, setConfirmingIds] = useState<Set<string>>(new Set())

  async function confirmOne(transaction: Transaction) {
    setConfirmingIds((prev) => new Set(prev).add(transaction.id))
    try {
      const { id, ...data } = transaction
      await updateTransaction(workspaceId, id, { ...data, paid: true })
    } catch {
      // silencioso — a linha continua pendente e dá pra tentar de novo
    } finally {
      setConfirmingIds((prev) => {
        const next = new Set(prev)
        next.delete(transaction.id)
        return next
      })
    }
  }

  return { confirmingIds, confirmOne }
}
