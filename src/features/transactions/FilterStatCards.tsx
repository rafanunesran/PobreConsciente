import { cn, formatBRL } from '../../lib/utils'

export interface FilterStat<T extends string> {
  value: T
  label: string
  amount: number
  tone: string
}

interface FilterStatCardsProps<T extends string> {
  stats: FilterStat<T>[]
  selected: string
  onSelect: (value: T) => void
}

// Resumo do mês que também é o filtro da lista abaixo (extrato, conta,
// saldo atual): tocar num card mostra só aquilo.
export function FilterStatCards<T extends string>({ stats, selected, onSelect }: FilterStatCardsProps<T>) {
  return (
    <div
      className={cn('grid gap-2', stats.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}
      role="tablist"
      aria-label="Filtrar lançamentos"
    >
      {stats.map((stat) => (
        <button
          key={stat.value}
          type="button"
          role="tab"
          aria-selected={selected === stat.value}
          onClick={() => onSelect(stat.value)}
          className={cn(
            'min-w-0 rounded-xl border bg-surface-light px-3 py-2 text-left transition-colors duration-200 dark:bg-surface-dark-elevated',
            selected === stat.value ? 'border-brand-500 ring-1 ring-brand-500' : 'border-border-light dark:border-transparent',
          )}
        >
          <p className="text-[11px] text-light-secondary dark:text-dark-secondary">{stat.label}</p>
          <p className={cn('tabular truncate text-sm font-bold', stat.tone)}>
            {stat.amount < 0 ? '− ' : ''}
            {formatBRL(Math.abs(stat.amount))}
          </p>
        </button>
      ))}
    </div>
  )
}
