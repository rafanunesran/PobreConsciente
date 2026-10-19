import { ChevronLeft, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface MonthSelectorProps {
  value: string // 'YYYY-MM'
  onChange: (value: string) => void
}

function shiftMonth(value: string, delta: number): string {
  const [yearStr, monthStr] = value.split('-')
  const year = Number(yearStr)
  const month0based = Number(monthStr) - 1
  const totalMonthIndex = year * 12 + month0based + delta
  const newYear = Math.floor(totalMonthIndex / 12)
  const newMonth1based = (totalMonthIndex % 12) + 1
  return `${newYear}-${String(newMonth1based).padStart(2, '0')}`
}

export function MonthSelector({ value, onChange }: MonthSelectorProps) {
  const [yearStr, monthStr] = value.split('-')
  const date = new Date(Number(yearStr), Number(monthStr) - 1, 1)
  const label = format(date, 'MMMM yyyy', { locale: ptBR })

  return (
    <div className="flex items-center justify-center gap-4">
      <button
        type="button"
        aria-label="Mês anterior"
        onClick={() => onChange(shiftMonth(value, -1))}
        className="flex h-9 w-9 items-center justify-center rounded-full text-light-secondary transition-colors duration-200 hover:bg-border-light hover:text-light-primary dark:text-dark-secondary dark:hover:bg-border-dark dark:hover:text-dark-primary"
      >
        <ChevronLeft size={18} />
      </button>
      <span className="min-w-[10rem] text-center font-[family-name:var(--font-display)] text-base font-bold capitalize text-light-primary dark:text-dark-primary">
        {label}
      </span>
      <button
        type="button"
        aria-label="Próximo mês"
        onClick={() => onChange(shiftMonth(value, 1))}
        className="flex h-9 w-9 items-center justify-center rounded-full text-light-secondary transition-colors duration-200 hover:bg-border-light hover:text-light-primary dark:text-dark-secondary dark:hover:bg-border-dark dark:hover:text-dark-primary"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  )
}
