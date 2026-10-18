import { addMonthsClamped, formatDate, parseDate } from '../transactions/dateUtils'
import type { Transaction } from '../transactions/types'
import { isLikelyDuplicate } from './duplicates'
import type { ReviewedEntry } from './types'

// Uma linha importada com parcela detectada (ex: "AMAZON BR 2/10") é só a
// ocorrência daquele mês — as parcelas seguintes (3/10, 4/10, ...) ainda não
// apareceram em nenhuma fatura. Gera essas ocorrências futuras automaticamente
// (mesmo valor e categoria da linha original, um mês depois cada uma — mesmo
// cálculo de data de installments.ts), sem `installmentGroupId` novo: elas não
// nasceram juntas de um único parcelamento manual, cada uma vem de uma fatura
// diferente.
//
// Dedupe: se depois a fatura do mês seguinte for importada e mostrar
// "AMAZON BR 3/10" de novo, essa ocorrência específica já foi criada aqui —
// isLikelyDuplicate (mesma checagem usada pra qualquer linha importada) evita
// recriá-la.
export function expandFutureInstallments(entry: ReviewedEntry, existing: Transaction[]): ReviewedEntry[] {
  if (entry.installmentIndex === undefined || entry.installmentTotal === undefined) return []
  const remaining = entry.installmentTotal - entry.installmentIndex
  if (remaining <= 0) return []

  const { year, month1based, day } = parseDate(entry.date)
  const future: ReviewedEntry[] = []

  for (let offset = 1; offset <= remaining; offset++) {
    const { year: y, month1based: m, day: d } = addMonthsClamped(year, month1based, day, offset)
    const candidate: ReviewedEntry = {
      date: formatDate(y, m, d),
      description: entry.description,
      amount: entry.amount,
      type: entry.type,
      categoryId: entry.categoryId,
      ...(entry.tags !== undefined ? { tags: entry.tags } : {}),
      installmentIndex: entry.installmentIndex + offset,
      installmentTotal: entry.installmentTotal,
    }
    if (!isLikelyDuplicate(candidate, existing)) future.push(candidate)
  }

  return future
}
