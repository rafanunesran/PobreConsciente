import { getDocs } from 'firebase/firestore'
import { accountsCollection } from '../accounts/api'
import { cardsCollection } from '../cards/api'
import { todayDateString } from '../cards/invoiceUtils'
import { categoriesCollection } from '../categories/api'
import { buildCategorySuggester } from '../imports/categorize'
import { importTransactions } from '../imports/api'
import type { ParsedEntry, ReviewedEntry } from '../imports/types'
import { transactionsCollection } from '../transactions/api'
import { formatDate, parseDate, roundToCents } from '../transactions/dateUtils'
import type { Transaction, TransactionType } from '../transactions/types'
import { listPluggyConfigs, recordPluggySync } from './api'
import { applyBankReserveMovements } from './caixinhaSync'
import { authenticate, listTransactions } from './pluggyClient'
import type { PluggyAccountLink, PluggyConfig, PluggyTransaction } from './types'

// Toda importação automática ganha essa tag — dá pra filtrar no extrato o
// que veio do banco e revisar as categorias sugeridas.
export const BANK_SYNC_TAG = 'banco'

// A Meu Pluggy atualiza as conexões uma vez por dia; mais que isso é só
// requisição à toa.
const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000

// Reler alguns dias antes da última sincronização: lançamentos chegam
// atrasados (compensação, compra no cartão que só "posta" dias depois).
// O que já foi importado é descartado pelo id/dedupe abaixo.
const OVERLAP_DAYS = 7

export const CARD_LOOKAHEAD_DAYS = 45

const DESCRIPTION_MAX = 60 // mesmo teto do form de lançamento (schemas.ts)

export function daysBefore(date: string, days: number): string {
  const { year, month1based, day } = parseDate(date)
  const shifted = new Date(year, month1based - 1, day - days)
  return formatDate(shifted.getFullYear(), shifted.getMonth() + 1, shifted.getDate())
}

// Pagamento da fatura aparece na conta do cartão como crédito — mas no app
// quem registra isso é o fluxo "Pagar fatura" (débito na conta corrente).
// Importar também do lado do cartão deixaria a fatura negativa.
export function isCardBillPayment(tx: PluggyTransaction): boolean {
  return (
    tx.amount < 0 &&
    (tx.operationType === 'PAGAMENTO_FATURA' ||
      tx.category === 'Credit card payment' ||
      /pagamento\s+(de\s+)?fatura|pagamento\s+recebido/i.test(tx.description))
  )
}

// Id do documento no Firestore. Prefere o `providerId` (id da própria
// instituição, estável) ao `id` da Pluggy, que muda quando a instituição
// reapresenta lançamentos de cartão perto do fechamento da fatura — ver
// https://docs.pluggy.ai/en/docs/products/credit-card-statement-cycle.
function transactionDocId(tx: PluggyTransaction): string {
  const stableId = tx.providerId || tx.id
  return `pluggy_${tx.accountId}_${stableId}`.replace(/[^A-Za-z0-9_-]/g, '_')
}

export interface BankEntry extends ParsedEntry {
  docId: string
}

export function toBankEntry(tx: PluggyTransaction, targetKind: 'account' | 'card'): BankEntry | null {
  // Na conta corrente, pendente é agendamento/bloqueio que ainda pode não
  // acontecer — só entra depois de confirmado. No cartão é o contrário: a
  // Pluggy marca como PENDING tudo da fatura em aberto, que é justamente o
  // que precisa aparecer (se mudar de id ao fechar, o providerId ou o
  // dedupe por data + valor seguram a duplicata).
  if (targetKind === 'account' && tx.status === 'PENDING') return null
  if (targetKind === 'card' && isCardBillPayment(tx)) return null
  const amount = roundToCents(Math.abs(tx.amount))
  if (amount === 0) return null

  // Cartão: a Pluggy sinaliza pelo valor (positivo = compra, negativo =
  // estorno/crédito) e o `type` nem sempre bate com isso. Conta: `type`.
  const type: TransactionType =
    targetKind === 'card' ? (tx.amount < 0 ? 'income' : 'expense') : tx.type === 'CREDIT' ? 'income' : 'expense'
  const description = tx.description.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX) || 'Lançamento bancário'
  const installmentTotal = tx.creditCardMetadata?.totalInstallments
  const installmentIndex = tx.creditCardMetadata?.installmentNumber

  return {
    docId: transactionDocId(tx),
    date: tx.date.slice(0, 10),
    description,
    amount,
    type,
    ...(installmentTotal && installmentTotal > 1 && installmentIndex
      ? { installmentIndex, installmentTotal }
      : {}),
  }
}

function dedupeKey(entry: { date: string; type: TransactionType; amount: number }): string {
  return `${entry.date}|${entry.type}|${entry.amount.toFixed(2)}`
}

// Descarta o que já existe na conta/cartão de destino:
// 1. mesmo id de documento → já foi importado antes;
// 2. mesma data + tipo + valor de algo já lançado (à mão, por CSV, ou um
//    lançamento de cartão que voltou da Pluggy com id novo). Conta por
//    multiplicidade: dois cafés iguais no mesmo dia no banco e um só
//    lançado à mão → importa só o segundo.
export function newBankEntries(entries: BankEntry[], existing: Transaction[]): BankEntry[] {
  const existingIds = new Set(existing.map((t) => t.id))
  const available = new Map<string, number>()
  for (const t of existing) {
    const key = dedupeKey(t)
    available.set(key, (available.get(key) ?? 0) + 1)
  }

  const seenIds = new Set<string>()
  const pending: BankEntry[] = []
  for (const entry of entries) {
    if (seenIds.has(entry.docId)) continue
    seenIds.add(entry.docId)
    if (existingIds.has(entry.docId)) {
      // o próprio lançamento já está em `existing` — consome a contagem
      // dele pra não "casar" com outro igual que ainda é novo.
      const key = dedupeKey(entry)
      available.set(key, (available.get(key) ?? 0) - 1)
    } else {
      pending.push(entry)
    }
  }

  const fresh: BankEntry[] = []
  for (const entry of pending) {
    const key = dedupeKey(entry)
    const count = available.get(key) ?? 0
    if (count > 0) available.set(key, count - 1)
    else fresh.push(entry)
  }
  return fresh
}

function linkTargetExists(
  link: PluggyAccountLink,
  accountIds: Set<string>,
  cardIds: Set<string>,
): boolean {
  return 'accountId' in link ? accountIds.has(link.accountId) : cardIds.has(link.cardId)
}

export interface SyncResult {
  imported: number
  // uma mensagem por conexão que falhou — as outras seguem normalmente
  errors: string[]
}

interface SyncContext {
  workspaceId: string
  createdBy: string
  accountIds: Set<string>
  cardIds: Set<string>
  // cresce a cada conexão importada: se marido e mulher vincularem a mesma
  // conta conjunta, o dedupe por data + tipo + valor da segunda conexão
  // enxerga o que a primeira acabou de importar.
  transactions: Transaction[]
  suggest: (description: string, type: TransactionType) => string | undefined
  firstCategory: Record<TransactionType, string | undefined>
}

async function syncConnection(ctx: SyncContext, config: PluggyConfig): Promise<number> {
  const linkEntries = Object.entries(config.links)
  if (linkEntries.length === 0) return 0

  const today = todayDateString()
  const overlapStart = config.lastSyncAt ? daysBefore(config.lastSyncAt.slice(0, 10), OVERLAP_DAYS) : ''

  const apiKey = await authenticate(config.clientId, config.clientSecret)
  let imported = 0

  // Sequencial: uma conta por vez, cada uma no seu writeBatch (mesmo
  // motivo de importTransactions — o incremento de saldo é por destino).
  for (const [pluggyAccountId, link] of linkEntries) {
    // conta/cartão apagado no app depois do vínculo — pula em vez de
    // derrubar a sincronização inteira no update de saldo.
    if (!linkTargetExists(link, ctx.accountIds, ctx.cardIds)) continue
    const targetKind = 'cardId' in link ? 'card' : 'account'

    // Cartão: a fatura em aberto (e a parcela dela) pode vir datada até o
    // fechamento, depois de hoje — busca até um ciclo à frente.
    const dateTo = targetKind === 'card' ? daysBefore(today, -CARD_LOOKAHEAD_DAYS) : today
    const start = config.linkSince?.[pluggyAccountId] ?? config.syncFrom
    const dateFrom = [start, overlapStart].filter(Boolean).sort().pop() ?? today
    const pluggyTransactions = await listTransactions(apiKey, pluggyAccountId, dateFrom, dateTo)
    const entries = pluggyTransactions
      .map((tx) => toBankEntry(tx, targetKind))
      .filter((entry): entry is BankEntry => entry !== null)
    const scoped = ctx.transactions.filter((t) =>
      'cardId' in link ? t.cardId === link.cardId : t.accountId === link.accountId,
    )

    const reviewed: ReviewedEntry[] = []
    for (const entry of newBankEntries(entries, scoped)) {
      const categoryId = ctx.suggest(entry.description, entry.type) ?? ctx.firstCategory[entry.type]
      if (!categoryId) continue
      reviewed.push({ ...entry, categoryId, tags: [BANK_SYNC_TAG] })
    }

    await importTransactions(ctx.workspaceId, reviewed, link, ctx.createdBy)
    imported += reviewed.length
    for (const entry of reviewed) {
      ctx.transactions.push({
        id: entry.docId ?? '',
        type: entry.type,
        amount: entry.amount,
        date: entry.date,
        description: entry.description,
        categoryId: entry.categoryId,
        paid: targetKind === 'account',
        createdBy: ctx.createdBy,
        ...link,
      })
    }
  }

  return imported
}

async function runSync(
  workspaceId: string,
  createdBy: string,
  shouldSync: (config: PluggyConfig) => boolean,
): Promise<SyncResult> {
  const configs = (await listPluggyConfigs(workspaceId)).filter(shouldSync)
  if (configs.length === 0) return { imported: 0, errors: [] }

  const [accountsSnap, cardsSnap, categoriesSnap, transactionsSnap] = await Promise.all([
    getDocs(accountsCollection(workspaceId)),
    getDocs(cardsCollection(workspaceId)),
    getDocs(categoriesCollection(workspaceId)),
    getDocs(transactionsCollection(workspaceId)),
  ])
  const categories = categoriesSnap.docs.map((d) => d.data())
  const transactions = transactionsSnap.docs.map((d) => d.data())
  const ctx: SyncContext = {
    workspaceId,
    createdBy,
    accountIds: new Set(accountsSnap.docs.map((d) => d.id)),
    cardIds: new Set(cardsSnap.docs.map((d) => d.id)),
    transactions,
    suggest: buildCategorySuggester(transactions),
    // Sem histórico nenhum daquele tipo, o sugeridor não tem o que propor —
    // cai na primeira categoria do tipo (a pessoa ajusta depois pela tag).
    firstCategory: {
      expense: categories.find((c) => c.type === 'expense')?.id,
      income: categories.find((c) => c.type === 'income')?.id,
    },
  }

  let imported = 0
  const errors: string[] = []
  for (const config of configs) {
    const startedAt = new Date().toISOString()
    try {
      imported += await syncConnection(ctx, config)
      await recordPluggySync(workspaceId, config.ownerUid, { at: startedAt })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na sincronização bancária.'
      errors.push(message)
      await recordPluggySync(workspaceId, config.ownerUid, { at: startedAt, error: message }).catch(
        () => undefined,
      )
    }
  }

  // Depois de importar: reservas do Mercado Pago ("Dinheiro reservado X")
  // também movimentam a caixinha correspondente. Roda sobre tudo que veio
  // do banco, inclusive o importado antes disso existir (idempotente).
  try {
    await applyBankReserveMovements(workspaceId, ctx.transactions, createdBy)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Falha ao atualizar as caixinhas.')
  }
  return { imported, errors }
}

// Uma sincronização por vez nesta aba — o StrictMode e cliques repetidos
// em "Sincronizar agora" não podem disparar duas em paralelo (importariam
// os mesmos lançamentos duas vezes antes de um enxergar o outro).
let running: Promise<SyncResult> | null = null

function exclusive(task: () => Promise<SyncResult>): Promise<SyncResult> {
  running ??= task().finally(() => {
    running = null
  })
  return running
}

// "Sincronizar agora": todas as conexões da família, de uma vez.
export function syncBankTransactions(workspaceId: string, createdBy: string): Promise<SyncResult> {
  return exclusive(() => runSync(workspaceId, createdBy, () => true))
}

function isStale(config: PluggyConfig): boolean {
  if (config.itemIds.length === 0 || Object.keys(config.links).length === 0) return false
  return !config.lastSyncAt || Date.now() - Date.parse(config.lastSyncAt) >= AUTO_SYNC_INTERVAL_MS
}

// Chamado ao abrir o app (AppShell): qualquer membro que abre sincroniza
// as conexões de todos que estiverem há mais de AUTO_SYNC_INTERVAL_MS sem
// sincronizar. Silencioso — o erro fica gravado em cada conexão e aparece
// na tela de Conexão bancária.
export async function autoSyncBankTransactions(workspaceId: string, createdBy: string): Promise<void> {
  await exclusive(() => runSync(workspaceId, createdBy, isStale))
}
