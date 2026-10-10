import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { updateTransaction } from './api'
import { getOrCreateCategoryByName } from '../categories/api'
import { payCardInvoice } from '../cards/invoicePayment'
import {
  nextInvoicePeriod,
  sumUnpaid,
  todayDateString,
  transactionsInPeriod,
  type CardInvoiceGroup,
} from '../cards/invoiceUtils'
import type { CreditCard } from '../cards/types'
import type { Category } from '../categories/types'
import type { Transaction } from './types'

export function invoiceKey(group: CardInvoiceGroup): string {
  return `${group.cardId}-${group.period.end}`
}

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

interface UseBulkPayParams {
  workspaceId: string
  // todas as transações (precisa das de cartão pra fechar a fatura)
  transactions: Transaction[]
  cards: CreditCard[]
  categories: Category[]
  // o que está na tela agora — seleção fora disso é ignorada, então trocar
  // de mês nunca paga algo que a pessoa não está vendo.
  visibleTransactions: Transaction[]
  visibleInvoices: CardInvoiceGroup[]
  resetKey: string
}

// Seleção múltipla + "Pagar selecionados": lançamentos de conta viram
// paid:true (mesmo caminho do botão "Pago" individual) e faturas de cartão
// são pagas pelo valor total em aberto, da conta escolhida na barra.
export function useBulkPay({
  workspaceId,
  transactions,
  cards,
  categories,
  visibleTransactions,
  visibleInvoices,
  resetKey,
}: UseBulkPayParams) {
  const user = useAuthStore((state) => state.user)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedInvoiceKeys, setSelectedInvoiceKeys] = useState<Set<string>>(new Set())
  const [confirmingIds, setConfirmingIds] = useState<Set<string>>(new Set())
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSelectedIds(new Set())
    setSelectedInvoiceKeys(new Set())
    setError(null)
  }, [resetKey])

  const selectedTransactions = useMemo(
    () => visibleTransactions.filter((t) => !t.paid && t.accountId !== undefined && selectedIds.has(t.id)),
    [visibleTransactions, selectedIds],
  )
  const selectedInvoices = useMemo(
    () => visibleInvoices.filter((g) => g.unpaidAmount > 0 && selectedInvoiceKeys.has(invoiceKey(g))),
    [visibleInvoices, selectedInvoiceKeys],
  )

  const selectedCount = selectedTransactions.length + selectedInvoices.length
  const selectedTotal =
    selectedTransactions.reduce((sum, t) => sum + (t.type === 'expense' ? -t.amount : t.amount), 0) -
    selectedInvoices.reduce((sum, g) => sum + g.unpaidAmount, 0)

  function clear() {
    setSelectedIds(new Set())
    setSelectedInvoiceKeys(new Set())
    setError(null)
  }

  async function markPaid(transaction: Transaction) {
    const { id, ...data } = transaction
    await updateTransaction(workspaceId, id, { ...data, paid: true })
  }

  async function confirmOne(transaction: Transaction) {
    setConfirmingIds(new Set([transaction.id]))
    try {
      await markPaid(transaction)
    } catch {
      // silencioso — a linha continua pendente e dá pra tentar de novo
    } finally {
      setConfirmingIds(new Set())
    }
  }

  async function paySelected(invoiceAccountId: string | null) {
    if (!user) return
    if (selectedInvoices.length > 0 && !invoiceAccountId) {
      setError('Escolha a conta para pagar as faturas.')
      return
    }
    setError(null)
    setPaying(true)
    setConfirmingIds(new Set(selectedTransactions.map((t) => t.id)))
    try {
      // sequencial, não Promise.all — evita várias runTransaction
      // concorrentes na mesma conta, que forçariam retries do Firestore.
      for (const transaction of selectedTransactions) {
        await markPaid(transaction)
      }
      if (selectedInvoices.length > 0 && invoiceAccountId) {
        const categoryId = await getOrCreateCategoryByName(
          workspaceId,
          categories,
          'Outro',
          'expense',
          'more',
          '#3B82F6',
          user.uid,
        )
        const cardsById = new Map(cards.map((c) => [c.id, c]))
        for (const group of selectedInvoices) {
          const card = cardsById.get(group.cardId)
          if (!card) continue
          const unpaid = transactionsInPeriod(transactions, card.id, group.period).filter((t) => !t.paid)
          const owed = sumUnpaid(unpaid)
          if (owed <= 0) continue
          await payCardInvoice(workspaceId, {
            cardId: card.id,
            cardName: card.name,
            accountId: invoiceAccountId,
            categoryId,
            amountPaid: owed,
            paymentDate: todayDateString(),
            unpaidTransactionIds: unpaid.map((t) => t.id),
            nextPeriodStart: nextInvoicePeriod(card.closingDay, group.period).start,
            createdBy: user.uid,
          })
        }
      }
      clear()
    } catch {
      // o que já foi pago fica pago; o resto continua selecionado.
      setError('Não foi possível pagar tudo. Confira os itens que ficaram pendentes.')
    } finally {
      setPaying(false)
      setConfirmingIds(new Set())
    }
  }

  return {
    selectedIds,
    selectedInvoiceKeys,
    toggle: (id: string) => setSelectedIds((prev) => toggleInSet(prev, id)),
    toggleInvoice: (key: string) => setSelectedInvoiceKeys((prev) => toggleInSet(prev, key)),
    confirmingIds,
    confirmOne,
    paying,
    error,
    selectedCount,
    selectedTotal,
    hasInvoicesSelected: selectedInvoices.length > 0,
    paySelected,
    clear,
  }
}

export type BulkPay = ReturnType<typeof useBulkPay>
