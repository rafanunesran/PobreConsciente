import { normalizeSearch } from '../transactions/filterTransactions'
import type { TransactionType } from '../transactions/types'
import type { CategoryRule } from './types'

// Regra mais específica (trecho mais longo) ganha: "uber eats" vence "uber"
// quando as duas casam com "UBER EATS PEDIDO 123".
export function matchCategoryRule(
  rules: CategoryRule[],
  description: string,
  type: TransactionType,
): CategoryRule | undefined {
  const text = normalizeSearch(description)
  if (text === '') return undefined
  let best: CategoryRule | undefined
  for (const rule of rules) {
    if (rule.type !== type) continue
    const pattern = normalizeSearch(rule.pattern)
    if (pattern === '' || !text.includes(pattern)) continue
    if (!best || pattern.length > normalizeSearch(best.pattern).length) best = rule
  }
  return best
}
