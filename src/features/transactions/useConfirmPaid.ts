import { useState } from 'react'
import { postponeTransactions, updateTransaction } from './api'
import { nextMonthSameDay, parseDate } from './dateUtils'
import { useToastStore } from '../../stores/toastStore'
import type { Transaction } from './types'

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function shortDateLabel(date: string): string {
  const { day, month1based } = parseDate(date)
  return `${day}/${MONTHS[month1based - 1] ?? month1based}`
}

// Botões "Marcar pago"/"Marcar recebido" e "Adiar" de cada pendente. Pagar
// ou adiar vários de uma vez é pela seleção (segurar a linha).
export function useConfirmPaid(workspaceId: string) {
  const [confirmingIds, setConfirmingIds] = useState<Set<string>>(new Set())
  const showToast = useToastStore((state) => state.show)

  async function withBusy(id: string, action: () => Promise<void>) {
    setConfirmingIds((prev) => new Set(prev).add(id))
    try {
      await action()
    } catch {
      // silencioso — a linha continua como estava e dá pra tentar de novo
    } finally {
      setConfirmingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  function confirmOne(transaction: Transaction) {
    return withBusy(transaction.id, async () => {
      const { id, ...data } = transaction
      await updateTransaction(workspaceId, id, { ...data, paid: true })
    })
  }

  function postponeOne(transaction: Transaction) {
    return withBusy(transaction.id, async () => {
      const n = await postponeTransactions(workspaceId, [transaction])
      if (n > 0) showToast(`Adiado para ${shortDateLabel(nextMonthSameDay(transaction.date))}.`)
    })
  }

  return { confirmingIds, confirmOne, postponeOne }
}
