import { effectiveMonth } from '../cards/invoiceUtils'
import type { CreditCard } from '../cards/types'
import type { Transaction, TransactionType } from '../transactions/types'
import type { Category } from './types'
import { rootCategoryId } from './categoryTree'

export interface CategoryTotal {
  categoryId: string
  name: string
  color: string
  value: number
}

// Cartão já pago não conta nos totais do mês — já virou a transação
// "Pagamento fatura X" vinculada à conta, que entra pelo seu próprio mês;
// somar a compra original de novo duplicaria o valor.
export function countsInMonthTotals(t: Transaction): boolean {
  return !(t.cardId !== undefined && t.paid)
}

// Soma por categoria de um tipo (despesa ou receita) num mês — cartão usa o
// mês de VENCIMENTO da fatura (mesma regra do resto do app), não o da
// compra, então uma compra feita depois do fechamento cai no mês seguinte.
// Com `rollUpSubcategories` (padrão), subcategoria soma na categoria mãe —
// é o que gráficos e comparativos querem; orçamentos pedem os valores
// crus pra poder ter teto numa subcategoria específica.
export function categoryTotals(
  transactions: Transaction[],
  categories: Category[],
  cardsById: Map<string, CreditCard>,
  selectedMonth: string,
  type: TransactionType,
  rollUpSubcategories = true,
): CategoryTotal[] {
  const categoriesById = new Map(categories.map((c) => [c.id, c]))
  const totals = new Map<string, number>()

  for (const t of transactions) {
    if (t.type !== type) continue
    if (!countsInMonthTotals(t)) continue
    if (effectiveMonth(t, cardsById) !== selectedMonth) continue
    const key = rollUpSubcategories ? rootCategoryId(t.categoryId, categoriesById) : t.categoryId
    totals.set(key, (totals.get(key) ?? 0) + t.amount)
  }

  return Array.from(totals.entries())
    .map(([categoryId, value]) => {
      const category = categoriesById.get(categoryId)
      return {
        categoryId,
        name: category?.name ?? 'Sem categoria',
        color: category?.color ?? '#898781',
        value,
      }
    })
    .sort((a, b) => b.value - a.value)
}
