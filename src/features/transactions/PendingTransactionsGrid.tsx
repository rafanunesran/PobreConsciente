import { useMemo } from 'react'
import { useAccounts } from '../accounts/useAccounts'
import { useCards } from '../cards/useCards'
import { useCategories } from '../categories/useCategories'
import { TransactionsGrid } from './TransactionsGrid'
import type { Transaction } from './types'

interface PendingTransactionsGridProps {
  uid: string
  transactions: Transaction[]
  selectedMonth: string // 'YYYY-MM'
}

// Mesmo grid do extrato, filtrado pro que ainda falta pagar/receber —
// assim os cards, o selo de status e o "Pagar selecionados" são idênticos
// nas duas telas.
export function PendingTransactionsGrid({ uid, transactions, selectedMonth }: PendingTransactionsGridProps) {
  const { categories } = useCategories(uid)
  const { cards } = useCards(uid)
  const { accounts } = useAccounts(uid)

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

  return (
    <TransactionsGrid
      workspaceId={uid}
      transactions={transactions}
      categoriesById={categoriesById}
      accountsById={accountsById}
      cardsById={cardsById}
      selectedMonth={selectedMonth}
      pendingOnly
    />
  )
}
