import { useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { Select } from '../../components/ui/Select'
import { cn } from '../../lib/utils'
import type { Account } from '../accounts/types'
import type { CreditCard } from '../cards/types'
import type { Category } from '../categories/types'
import { EMPTY_FILTERS, hasActiveFilters, type TransactionFilters } from './filterTransactions'

interface TransactionFiltersBarProps {
  filters: TransactionFilters
  onChange: (filters: TransactionFilters) => void
  categories: Category[]
  accounts: Account[]
  cards: CreditCard[]
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex gap-2">
      {options.map(([option, label]) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-200',
            value === option
              ? 'border-brand-500 bg-brand-500/10 text-brand-500'
              : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function TransactionFiltersBar({
  filters,
  onChange,
  categories,
  accounts,
  cards,
}: TransactionFiltersBarProps) {
  const [open, setOpen] = useState(false)
  const active = hasActiveFilters(filters)
  const visibleCategories =
    filters.type === 'all' ? categories : categories.filter((c) => c.type === filters.type)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-border-light bg-surface-light px-3 py-2.5 focus-within:border-brand-500 dark:border-border-dark dark:bg-surface-dark-elevated">
          <Search size={18} className="shrink-0 text-light-secondary dark:text-dark-secondary" />
          <input
            type="search"
            value={filters.text}
            onChange={(e) => onChange({ ...filters, text: e.target.value })}
            placeholder="Buscar por descrição ou categoria"
            aria-label="Buscar lançamentos"
            className="w-full min-w-0 bg-transparent text-base text-light-primary outline-none placeholder:text-light-secondary dark:text-dark-primary dark:placeholder:text-dark-secondary"
          />
        </label>
        <button
          type="button"
          aria-label="Filtros"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex w-12 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200',
            open || active
              ? 'border-brand-500 bg-brand-500/10 text-brand-500'
              : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
          )}
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

      {open ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-border-light p-4 dark:border-border-dark">
          <Segmented
            value={filters.type}
            options={[
              ['all', 'Todos'],
              ['expense', 'Despesas'],
              ['income', 'Receitas'],
            ]}
            onChange={(type) => onChange({ ...filters, type, categoryId: '' })}
          />
          <Segmented
            value={filters.status}
            options={[
              ['all', 'Qualquer'],
              ['paid', 'Pagos'],
              ['pending', 'Pendentes'],
            ]}
            onChange={(status) => onChange({ ...filters, status })}
          />
          <Select
            label="Categoria"
            value={filters.categoryId}
            onChange={(e) => onChange({ ...filters, categoryId: e.target.value })}
          >
            <option value="">Todas</option>
            {visibleCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <Select
            label="Conta ou cartão"
            value={filters.linked}
            onChange={(e) => onChange({ ...filters, linked: e.target.value })}
          >
            <option value="">Todos</option>
            {accounts.length > 0 ? (
              <optgroup label="Contas">
                {accounts.map((account) => (
                  <option key={account.id} value={`account:${account.id}`}>
                    {account.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {cards.length > 0 ? (
              <optgroup label="Cartões">
                {cards.map((card) => (
                  <option key={card.id} value={`card:${card.id}`}>
                    {card.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
          <label className="flex items-center gap-2 text-sm text-light-primary dark:text-dark-primary">
            <input
              type="checkbox"
              checked={filters.allPeriod}
              onChange={(e) => onChange({ ...filters, allPeriod: e.target.checked })}
              className="h-4 w-4 accent-brand-500"
            />
            Buscar em todo o período (ignora o mês)
          </label>
        </div>
      ) : null}

      {active ? (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="flex items-center gap-1 self-start text-sm text-brand-500"
        >
          <X size={14} />
          Limpar filtros
        </button>
      ) : null}
    </div>
  )
}
