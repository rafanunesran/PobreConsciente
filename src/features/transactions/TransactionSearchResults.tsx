import { TransactionCompactCard } from './TransactionCompactCard'
import { formatBRL } from '../../lib/utils'
import type { Account } from '../accounts/types'
import type { CreditCard } from '../cards/types'
import type { Category } from '../categories/types'
import type { Transaction } from './types'

interface TransactionSearchResultsProps {
  results: Transaction[]
  categoriesById: Map<string, Category>
  accountsById: Map<string, Account>
  cardsById: Map<string, CreditCard>
}

// Lista lançamento a lançamento (inclusive compras de cartão uma a uma, ao
// contrário do TransactionsGrid, que agrega o cartão por fatura) — numa
// busca a pessoa quer achar A compra, não o total da fatura.
export function TransactionSearchResults({
  results,
  categoriesById,
  accountsById,
  cardsById,
}: TransactionSearchResultsProps) {
  const totalExpenses = results.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0)
  const totalIncomes = results.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 rounded-2xl border border-border-light bg-surface-light p-4 dark:border-border-dark dark:bg-surface-dark-elevated">
        <div className="min-w-0">
          <p className="text-xs text-light-secondary dark:text-dark-secondary">Encontrados</p>
          <p className="truncate text-sm font-semibold text-light-primary dark:text-dark-primary">
            {results.length}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-light-secondary dark:text-dark-secondary">Despesas</p>
          <p className="truncate text-sm font-semibold text-danger">{formatBRL(totalExpenses)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-light-secondary dark:text-dark-secondary">Receitas</p>
          <p className="truncate text-sm font-semibold text-brand-500">{formatBRL(totalIncomes)}</p>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-light py-10 text-center text-sm text-light-secondary dark:border-border-dark dark:text-dark-secondary">
          Nenhum lançamento encontrado.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {results.map((transaction) => (
            <TransactionCompactCard
              key={transaction.id}
              transaction={transaction}
              category={categoriesById.get(transaction.categoryId)}
              linkedName={
                transaction.accountId !== undefined
                  ? accountsById.get(transaction.accountId)?.name
                  : cardsById.get(transaction.cardId ?? '')?.name
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
