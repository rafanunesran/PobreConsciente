import type { TransactionType } from '../transactions/types'

// Saída bruta de cada parser (CSV/OFX/PDF) — o valor mantém o sinal como
// veio no arquivo de origem. Ainda não é um ParsedEntry porque o
// significado do sinal depende de pra onde está importando (fatura de
// cartão vs. extrato de conta — ver applySignConvention em parseFile.ts).
export interface RawParsedEntry {
  date: string // 'YYYY-MM-DD'
  description: string
  amount: number // pode ser negativo, como veio da fonte
  installmentIndex?: number
  installmentTotal?: number
}

// Resultado final normalizado — a UI de revisão e `importTransactions` só
// conhecem essa forma, nunca o formato de origem nem o sinal bruto.
export interface ParsedEntry {
  date: string // 'YYYY-MM-DD'
  description: string
  amount: number // sempre positivo
  type: TransactionType
  installmentIndex?: number
  installmentTotal?: number
}

// Depois que a pessoa escolhe (ou aceita a sugestão de) categoria na tela
// de revisão, a entrada ganha esse campo — só então pode virar Transaction.
export interface ReviewedEntry extends ParsedEntry {
  categoryId: string
  // Só na sincronização bancária (openFinance/sync.ts): id determinístico
  // do documento, pra reimportar o mesmo lançamento ser idempotente.
  docId?: string
  tags?: string[]
}

export type ImportTarget = { accountId: string } | { cardId: string }

export type ImportFileFormat = 'csv' | 'ofx' | 'pdf'
