import type { Transaction } from './types'

export const MAX_TAGS = 5
export const MAX_TAG_LENGTH = 20

// Minúsculas, espaços colapsados, sem "#" na frente — "#Viagem  SP" e
// "viagem sp" viram a mesma tag.
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_TAG_LENGTH)
}

// Todas as tags já usadas, das mais frequentes pras menos — sugestões no
// form e opções no filtro do extrato.
export function collectTags(transactions: Transaction[]): string[] {
  const counts = new Map<string, number>()
  for (const t of transactions) {
    for (const tag of t.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
}
