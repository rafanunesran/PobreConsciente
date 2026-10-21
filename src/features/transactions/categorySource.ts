import type { Transaction } from './types'

// Categoria foi palpite automático (ver Transaction.categorySource).
export function isAutoCategory(t: Pick<Transaction, 'id' | 'categorySource'>): boolean {
  return t.categorySource === 'auto' || (t.categorySource === undefined && t.id.startsWith('pluggy_'))
}
