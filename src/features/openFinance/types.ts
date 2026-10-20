import type { ImportTarget } from '../imports/types'

// Pra onde vão os lançamentos de uma conta da Pluggy: uma conta ou um
// cartão do app. Conta da Pluggy sem vínculo é ignorada na sincronização.
export type PluggyAccountLink = ImportTarget

// Configuração da conexão via Meu Pluggy — uma por pessoa do workspace
// (no modo família, marido e mulher têm cada um a sua). Credenciais são da
// própria pessoa (aplicação dela no dashboard da Pluggy), por isso ficam
// no Firestore do workspace e não num servidor nosso: o app chama a API
// da Pluggy direto do navegador.
export interface PluggyConfig {
  ownerUid: string // quem configurou — só essa pessoa edita as credenciais
  clientId: string
  clientSecret: string
  itemIds: string[]
  // chave: id da conta na Pluggy
  links: Record<string, PluggyAccountLink>
  // 'YYYY-MM-DD' — nada antes disso é importado, pra não duplicar o
  // histórico que a pessoa já lançou à mão antes de conectar o banco.
  syncFrom: string
  // data inicial própria de uma conta da Pluggy (chave: id dela), que vence
  // `syncFrom` — usada quando o banco vira a fonte de um cartão a partir do
  // início da fatura atual (ver switchCardToBankSource).
  linkSince?: Record<string, string>
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
  creditData?: {
    brand?: string | null
    creditLimit?: number | null
    balanceCloseDate?: string | null // 'YYYY-MM-DD'
    balanceDueDate?: string | null // 'YYYY-MM-DD'
  } | null
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
  operationType?: string | null
  // quem pagou e quem recebeu (Pix/TED) — mesmo CPF/CNPJ nos dois lados é
  // transferência entre contas da mesma pessoa
  paymentData?: {
    payer?: { documentNumber?: { value?: string | null } | null } | null
    receiver?: { documentNumber?: { value?: string | null } | null } | null
  } | null
  creditCardMetadata?: {
    installmentNumber?: number
    totalInstallments?: number
  } | null
}
