import { effectiveMonth } from '../cards/invoiceUtils'
import type { CreditCard } from '../cards/types'
import type { Category } from '../categories/types'
import type { Transaction, TransactionType } from './types'
import { categoryWithChildren } from '../categories/categoryTree'

export interface TransactionFilters {
  text: string
  type: TransactionType | 'all'
  categoryId: string // '' = todas
  // 'account:<id>' | 'card:<id>' | '' (todas) — um select só pros dois
  // tipos de vínculo, mesma ideia do "Pago com" do form de despesa.
  linked: string
  status: 'all' | 'paid' | 'pending'
  allPeriod: boolean // false = só o mês selecionado na tela
}

export const EMPTY_FILTERS: TransactionFilters = {
  text: '',
  type: 'all',
  categoryId: '',
  linked: '',
  status: 'all',
  allPeriod: false,
}

// "Filtrando" = qualquer coisa além do mês — é o que troca a visão agregada
// (faturas de cartão somadas) pela lista lançamento a lançamento.
export function hasActiveFilters(filters: TransactionFilters): boolean {
  return (
    filters.text.trim() !== '' ||
    filters.type !== 'all' ||
    filters.categoryId !== '' ||
    filters.linked !== '' ||
    filters.status !== 'all' ||
    filters.allPeriod
  )
}

// Busca sem acento e sem caixa: "acougue" acha "Açougue".
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export function filterTransactions(
  transactions: Transaction[],
  filters: TransactionFilters,
  selectedMonth: string,
  cardsById: Map<string, CreditCard>,
  categoriesById: Map<string, Category>,
): Transaction[] {
  const text = normalizeSearch(filters.text)
  const [linkedKind, linkedId] = filters.linked.split(':')
  // Filtrar por uma categoria principal traz também as subcategorias dela.
  const categoryIds =
    filters.categoryId !== ''
      ? categoryWithChildren(filters.categoryId, Array.from(categoriesById.values()))
      : null

  return transactions.filter((t) => {
    if (!filters.allPeriod && effectiveMonth(t, cardsById) !== selectedMonth) return false
    if (filters.type !== 'all' && t.type !== filters.type) return false
    if (categoryIds !== null && !categoryIds.has(t.categoryId)) return false
    if (linkedKind === 'account' && t.accountId !== linkedId) return false
    if (linkedKind === 'card' && t.cardId !== linkedId) return false
    if (filters.status === 'paid' && !t.paid) return false
    if (filters.status === 'pending' && t.paid) return false
    if (text !== '') {
      const categoryName = categoriesById.get(t.categoryId)?.name ?? ''
      const haystack = normalizeSearch(`${t.description} ${categoryName}`)
      if (!haystack.includes(text)) return false
    }
    return true
  })
}
