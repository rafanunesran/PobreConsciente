import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Plus, Receipt } from 'lucide-react'
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
import { collectTags } from './tags'
import { downloadCsv, transactionsToCsv } from './exportCsv'
import { effectiveMonth } from '../cards/invoiceUtils'
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
  const tags = useMemo(() => collectTags(transactions), [transactions])
  const filtering = hasActiveFilters(filters)
  const results = useMemo(
    () =>
      filtering ? filterTransactions(transactions, filters, selectedMonth, cardsById, categoriesById) : [],
    [filtering, transactions, filters, selectedMonth, cardsById, categoriesById],
  )

  if (!user || !workspaceId) return null

  // Exporta o que está na tela: o resultado da busca, ou o mês inteiro
  // lançamento a lançamento (compras de cartão individuais incluídas).
  function handleExport() {
    const rows = filtering ? results : transactions.filter((t) => effectiveMonth(t, cardsById) === selectedMonth)
    const suffix = filtering ? (filters.allPeriod ? 'busca' : `${selectedMonth}-busca`) : selectedMonth
    downloadCsv(
      `pobreconsciente-extrato-${suffix}.csv`,
      transactionsToCsv(rows, { categoriesById, accountsById, cardsById }),
    )
  }

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">
          Registros
        </h1>
        <div className="flex gap-2">
          {transactions.length > 0 ? (
            <Button type="button" variant="secondary" className="gap-1.5" onClick={handleExport} aria-label="Exportar CSV">
              <Download size={18} />
              <span className="hidden sm:inline">Exportar</span>
            </Button>
          ) : null}
          <Link to="/registros/novo">
            <Button type="button" className="gap-1.5">
              <Plus size={18} />
              Novo
            </Button>
          </Link>
        </div>
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
            tags={tags}
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
