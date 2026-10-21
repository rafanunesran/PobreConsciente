import { isAutoCategory } from '../transactions/categorySource'
import type { Transaction, TransactionType } from '../transactions/types'

// Palavras que aparecem em qualquer descrição bancária e não dizem nada
// sobre o que foi comprado/pago — e prefixos de maquininha/processador de
// pagamento ("MP*", "PAG*", "HTM*"...), que se repetem entre lojas diferentes.
const NOISE = new Set([
  'pix',
  'enviado',
  'enviada',
  'recebido',
  'recebida',
  'transferencia',
  'pagamento',
  'pagto',
  'compra',
  'debito',
  'credito',
  'cartao',
  'para',
  'pelo',
  'pela',
  'dos',
  'das',
  'com',
  'ltda',
  'eireli',
  'mei',
  'www',
  'br',
  'mp',
  'pag',
  'pg',
  'htm',
  'stb',
  'ifd',
  'pp',
  'ec',
])

// Palavras que identificam o lançamento: sem acento, sem número (parcela
// "7/12", CPF/CNPJ, códigos), sem as genéricas acima.
export function descriptionTokens(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[0-9]/g, ' ')
        .replace(/[^a-z]+/g, ' ')
        .split(' ')
        .filter((w) => w.length >= 3 && !NOISE.has(w)),
    ),
  )
}

// Quanto duas descrições falam da mesma coisa (0–1): palavras em comum
// sobre o tamanho da menor. Precisa de uma palavra em comum com 4+ letras
// — "ana" sozinho não basta.
function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setB = new Set(b)
  const shared = a.filter((w) => setB.has(w))
  if (!shared.some((w) => w.length >= 4)) return 0
  return shared.length / Math.min(a.length, b.length)
}

const SIMILAR_THRESHOLD = 0.5
// Categoria escolhida pela pessoa vale bem mais que um palpite automático
// (lançamento importado do banco que ninguém corrigiu) — senão um palpite
// errado se reforça a cada importação.
const MANUAL_WEIGHT = 4
const AUTO_WEIGHT = 1

export type SuggestionConfidence = 'exact' | 'similar' | 'fallback'

export interface CategorySuggestion {
  categoryId: string
  confidence: SuggestionConfidence
}

interface HistoryEntry {
  tokens: string[]
  key: string
  categoryId: string
  weight: number
}

// Monta um "sugeridor" a partir do histórico já categorizado — separado
// por tipo (expense/income não se misturam). Vota por categoria: cada
// lançamento parecido soma peso × semelhança; lançamento categorizado à
// mão pesa mais que palpite. Retorna também a confiança, pra quem quiser
// só agir quando a sugestão vier de algo parecido de verdade.
export function buildDetailedCategorySuggester(
  history: Transaction[],
  options: { manualOnly?: boolean } = {},
): (description: string, type: TransactionType) => CategorySuggestion | undefined {
  const byType: Record<TransactionType, HistoryEntry[]> = { expense: [], income: [] }
  const usage: Record<TransactionType, Map<string, number>> = { expense: new Map(), income: new Map() }

  for (const t of history) {
    if (!t.categoryId) continue
    const auto = isAutoCategory(t)
    if (options.manualOnly && auto) continue
    const weight = auto ? AUTO_WEIGHT : MANUAL_WEIGHT
    usage[t.type].set(t.categoryId, (usage[t.type].get(t.categoryId) ?? 0) + weight)
    const tokens = descriptionTokens(t.description)
    if (tokens.length === 0) continue
    byType[t.type].push({ tokens, key: [...tokens].sort().join(' '), categoryId: t.categoryId, weight })
  }

  const fallbackByType: Record<TransactionType, string | undefined> = {
    expense: best(usage.expense),
    income: best(usage.income),
  }

  return (description, type) => {
    const tokens = descriptionTokens(description)
    if (tokens.length > 0) {
      const key = [...tokens].sort().join(' ')
      const exact = new Map<string, number>()
      const similar = new Map<string, number>()
      for (const entry of byType[type]) {
        if (entry.key === key) {
          exact.set(entry.categoryId, (exact.get(entry.categoryId) ?? 0) + entry.weight)
          continue
        }
        const score = similarity(tokens, entry.tokens)
        if (score >= SIMILAR_THRESHOLD) {
          similar.set(entry.categoryId, (similar.get(entry.categoryId) ?? 0) + entry.weight * score)
        }
      }
      const exactBest = best(exact)
      if (exactBest) return { categoryId: exactBest, confidence: 'exact' }
      const similarBest = best(similar)
      if (similarBest) return { categoryId: similarBest, confidence: 'similar' }
    }

    // Sem nada parecido: a categoria mais usada nesse tipo, em vez de deixar
    // em branco — a pessoa ainda pode trocar.
    const fallback = fallbackByType[type]
    return fallback ? { categoryId: fallback, confidence: 'fallback' } : undefined
  }
}

function best(scores: Map<string, number>): string | undefined {
  let bestId: string | undefined
  let bestScore = 0
  for (const [id, score] of scores) {
    if (score > bestScore) {
      bestId = id
      bestScore = score
    }
  }
  return bestId
}

// Forma simples (só o id), usada na importação de arquivo.
export function buildCategorySuggester(
  history: Transaction[],
): (description: string, type: TransactionType) => string | undefined {
  const suggest = buildDetailedCategorySuggester(history)
  return (description, type) => suggest(description, type)?.categoryId
}
