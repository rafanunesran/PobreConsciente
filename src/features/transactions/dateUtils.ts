// NOTE: aritmética de datas em string 'YYYY-MM-DD', nunca via Date +
// toISOString (isso desloca o dia dependendo do fuso horário do navegador).
// Compartilhado entre recurring.ts e installments.ts.

export function parseDate(date: string): { year: number; month1based: number; day: number } {
  const parts = date.split('-')
  return { year: Number(parts[0]), month1based: Number(parts[1]), day: Number(parts[2]) }
}

export function formatDate(year: number, month1based: number, day: number): string {
  return `${year}-${String(month1based).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function daysInMonth(year: number, month1based: number): number {
  return new Date(year, month1based, 0).getDate() // só componentes locais, nunca toISOString
}

export function addMonthsClamped(
  year: number,
  month1based: number,
  dayOfMonth: number,
  monthsToAdd: number,
): { year: number; month1based: number; day: number } {
  const totalMonthIndex = year * 12 + (month1based - 1) + monthsToAdd
  const newYear = Math.floor(totalMonthIndex / 12)
  const newMonth1based = (totalMonthIndex % 12) + 1
  const day = Math.min(dayOfMonth, daysInMonth(newYear, newMonth1based)) // dia 31 em fevereiro -> 28/29
  return { year: newYear, month1based: newMonth1based, day }
}

export function monthsBetween(fromDate: string, toDate: string): number {
  const from = parseDate(fromDate)
  const to = parseDate(toDate)
  return (to.year - from.year) * 12 + (to.month1based - from.month1based)
}

export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100
}

export function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// Mesmo dia no mês seguinte; dia que não existe lá vira o último do mês
// (31/jan → 28 ou 29/fev). Usado pelo "Adiar" dos pendentes.
export function nextMonthSameDay(date: string): string {
  const { year, month1based, day } = parseDate(date)
  const next = addMonthsClamped(year, month1based, day, 1)
  return formatDate(next.year, next.month1based, next.day)
}
