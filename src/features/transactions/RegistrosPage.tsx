import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Receipt } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useTransactions } from './useTransactions'
import { useAccounts } from '../accounts/useAccounts'
import { useCards } from '../cards/useCards'
import { useCategories } from '../categories/useCategories'
import { TransactionsGrid } from './TransactionsGrid'
import { MonthSelector } from '../../components/ui/MonthSelector'
import { currentYearMonth } from './dateUtils'
import { Button } from '../../components/ui/Button'
import { TransactionFiltersBar } from './TransactionFiltersBar'
import { TransactionSearchResults } from './TransactionSearchResults'
import { EMPTY_FILTERS, filterTransactions, hasActiveFilters, type TransactionFilters } from './filterTransactions'

export function RegistrosPage() {
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { transactions, loading, error } = useTransactions(workspaceId ?? '')
  const { accounts } = useAccounts(workspaceId ?? '')
  const { cards } = useCards(workspaceId ?? '')
  const { categories } = useCategories(workspaceId ?? '')
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth())
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY_FILTERS)

  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const filtering = hasActiveFilters(filters)
  const results = useMemo(
    () =>
      filtering ? filterTransactions(transactions, filters, selectedMonth, cardsById, categoriesById) : [],
    [filtering, transactions, filters, selectedMonth, cardsById, categoriesById],
  )

  if (!user || !workspaceId) return null

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">
          Registros
        </h1>
        <Link to="/registros/novo">
          <Button type="button" className="gap-1.5">
            <Plus size={18} />
            Novo
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated"
            />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-danger">
          Não foi possível carregar seus registros. Verifique sua conexão ou tente novamente mais
          tarde.
        </p>
      ) : transactions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-light py-16 text-center dark:border-border-dark">
          <Receipt size={32} className="text-light-secondary dark:text-dark-secondary" />
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Nenhum registro ainda.
          </p>
          <Link to="/registros/novo">
            <Button type="button" variant="secondary">
              Criar o primeiro registro
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <TransactionFiltersBar
            filters={filters}
            onChange={setFilters}
            categories={categories}
            accounts={accounts}
            cards={cards}
          />
          {filters.allPeriod ? null : <MonthSelector value={selectedMonth} onChange={setSelectedMonth} />}
          {filtering ? (
            <TransactionSearchResults
              results={results}
              categoriesById={categoriesById}
              accountsById={accountsById}
              cardsById={cardsById}
            />
          ) : (
            <TransactionsGrid
              transactions={transactions}
              categoriesById={categoriesById}
              accountsById={accountsById}
              cardsById={cardsById}
              selectedMonth={selectedMonth}
            />
          )}
        </>
      )}
    </div>
  )
}
