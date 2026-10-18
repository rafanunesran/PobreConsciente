import type { ImportTarget } from '../imports/types'

// Pra onde vão os lançamentos de uma conta da Pluggy: uma conta ou um
// cartão do app. Conta da Pluggy sem vínculo é ignorada na sincronização.
export type PluggyAccountLink = ImportTarget

// Configuração da conexão via Meu Pluggy — uma por workspace (a família
// inteira compartilha). Credenciais são da própria pessoa (aplicação dela
// no dashboard da Pluggy), por isso ficam no Firestore do workspace e não
// num servidor nosso: o app chama a API da Pluggy direto do navegador.
export interface PluggyConfig {
  clientId: string
  clientSecret: string
  itemIds: string[]
  // chave: id da conta na Pluggy
  links: Record<string, PluggyAccountLink>
  // 'YYYY-MM-DD' — nada antes disso é importado, pra não duplicar o
  // histórico que a pessoa já lançou à mão antes de conectar o banco.
  syncFrom: string
  lastSyncAt?: string // ISO
  lastSyncError?: string
}

// Recortes do formato da API (https://docs.pluggy.ai) — só os campos usados.
export interface PluggyItem {
  id: string
  status: string
  connector?: { name?: string }
}

export interface PluggyAccount {
  id: string
  itemId: string
  type: 'BANK' | 'CREDIT' | string
  subtype?: string
  name: string
  marketingName?: string | null
  number?: string
  balance?: number
}

export interface PluggyTransaction {
  id: string
  providerId?: string | null
  accountId: string
  description: string
  amount: number
  date: string // ISO
  type: 'DEBIT' | 'CREDIT'
  status?: 'PENDING' | 'POSTED' | string
  category?: string | null
  creditCardMetadata?: {
    installmentNumber?: number
    totalInstallments?: number
  } | null
}
