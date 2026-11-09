import { getDocs, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { caixinhaMovementsCollection } from '../caixinhas/movements'
import { movementBaseId } from '../caixinhas/merge'
import type { CaixinhaMovement } from '../caixinhas/types'
import { cardsCollection } from '../cards/api'
import { todayDateString } from '../cards/invoiceUtils'
import { categoriesCollection } from '../categories/api'
import { buildCategorySuggester, buildDetailedCategorySuggester } from '../imports/categorize'
import { isAutoCategory } from '../transactions/categorySource'
import { importTransactions } from '../imports/api'
import type { ParsedEntry, ReviewedEntry } from '../imports/types'
import { transactionDoc, transactionsCollection } from '../transactions/api'
import { formatDate, parseDate, roundToCents } from '../transactions/dateUtils'
import type { Transaction, TransactionType } from '../transactions/types'
import { listPluggyConfigs, recordPluggySync } from './api'
import { authenticate, listTransactions } from './pluggyClient'
import { CARD_WINDOW_DAYS, isManualCandidate, pairBankWithManual } from './matching'
import { linkManualToBank, mergeImportedDuplicates } from './reconcile'
import type { PluggyConfig, PluggyTransaction } from './types'

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

// Conexão do Open Finance que ficou dias sem atualizar (consentimento
// vencido, banco fora do ar) devolve, quando volta, lançamentos com data
// anterior à última sincronização do app — que avançou mesmo sem dado
// novo. Por isso a releitura também volta até o último lançamento do banco
// já importado naquela conta/cartão, com esse teto.
const MAX_REREAD_DAYS = 90

// De onde reler uma conta/cartão: a data inicial dela, ou — depois da
// primeira sincronização — alguns dias antes da última sincronização ou do
// último lançamento do banco já no app (o que for mais antigo), sem passar
// de MAX_REREAD_DAYS atrás.
export function syncWindowStart(params: {
  start: string
  lastSyncAt?: string
  latestImported?: string
  today: string
}): string {
  const { start, lastSyncAt, latestImported, today } = params
  if (!lastSyncAt) return start || today
  const anchors = [daysBefore(lastSyncAt.slice(0, 10), OVERLAP_DAYS)]
  if (latestImported) anchors.push(daysBefore(latestImported, OVERLAP_DAYS))
  const earliest = anchors.sort()[0] as string
  const floor = daysBefore(today, MAX_REREAD_DAYS)
  return [start, earliest > floor ? earliest : floor].filter(Boolean).sort().pop() ?? today
}

// Id de um lançamento que a pessoa trouxe do Histórico do banco (ver
// bankHistoryActions.ts). Não começa com `pluggy_`: a sincronização não
// mexe nele; o `bankRef` diz qual lançamento do banco ele é.
export function forcedTransactionId(bankDocId: string): string {
  return `banco_${bankDocId}`
}

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
    targetKind === 'card'
      ? tx.amount < 0
        ? 'income'
        : 'expense'
      : tx.type === 'CREDIT'
        ? 'income'
        : 'expense'
  const description =
    tx.description.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX) || 'Lançamento bancário'
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
  // lançamento do app conciliado com um do banco conta como "esse do banco
  // já existe" (ver reconcile.ts)
  const existingIds = new Set(existing.flatMap((t) => (t.bankRef !== undefined ? [t.id, t.bankRef] : [t.id])))
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

export interface SyncResult {
  imported: number
  // uma mensagem por conexão que falhou — as outras seguem normalmente
  errors: string[]
}

interface SyncContext {
  workspaceId: string
  createdBy: string
  cardIds: Set<string>
  movementsById: Map<string, CaixinhaMovement>
  // cresce a cada conexão importada: se marido e mulher vincularem o mesmo
  // cartão, o dedupe por data + tipo + valor da segunda conexão enxerga o
  // que a primeira acabou de importar.
  transactions: Transaction[]
  // lançamentos do banco que um lançamento do app já representa (bankRef)
  claimedBankKeys: Set<string>
  suggest: (description: string, type: TransactionType) => string | undefined
  firstCategory: Record<TransactionType, string | undefined>
}

// O que foi lido da Pluggy pra um cartão vinculado, antes de gravar nada.
interface FetchedLink {
  config: PluggyConfig
  pluggyAccountId: string
  link: { cardId: string }
  entries: BankEntry[]
}

// Fase 1: lê da Pluggy os lançamentos dos cartões de uma conexão (sem
// gravar nada). Conta corrente não é mais importada sozinha: o banco manda
// com ~1 dia de atraso e a pessoa lança na hora — o que vem do banco fica
// no Histórico do banco (bankHistory.ts), de onde ela escolhe o que vira
// lançamento.
async function fetchConnection(ctx: SyncContext, config: PluggyConfig): Promise<FetchedLink[]> {
  const cardLinks = Object.entries(config.links).flatMap(([pid, link]) =>
    'cardId' in link && ctx.cardIds.has(link.cardId) ? [[pid, link] as const] : [],
  )
  if (cardLinks.length === 0) return []

  const today = todayDateString()
  const apiKey = await authenticate(config.clientId, config.clientSecret)

  const fetched: FetchedLink[] = []
  for (const [pluggyAccountId, link] of cardLinks) {
    // a fatura em aberto (e a parcela dela) pode vir datada até o
    // fechamento, depois de hoje — busca até um ciclo à frente.
    const dateTo = daysBefore(today, -CARD_LOOKAHEAD_DAYS)
    const start = config.linkSince?.[pluggyAccountId] ?? config.syncFrom
    const latestImported = ctx.transactions
      .filter(
        (t) => (t.id.startsWith('pluggy_') || t.bankRef !== undefined) && t.cardId === link.cardId && t.date <= today,
      )
      .reduce<string | undefined>((latest, t) => (latest === undefined || t.date > latest ? t.date : latest), undefined)
    const dateFrom = syncWindowStart({ start, lastSyncAt: config.lastSyncAt, latestImported, today })
    const pluggyTransactions = await listTransactions(apiKey, pluggyAccountId, dateFrom, dateTo)

    const entries: BankEntry[] = []
    for (const tx of pluggyTransactions) {
      const entry = toBankEntry(tx, 'card')
      // já representado por um lançamento do app (conciliado): fica como a
      // pessoa deixou
      if (!entry || ctx.claimedBankKeys.has(entry.docId) || entry.date < dateFrom) continue
      entries.push(entry)
    }
    fetched.push({ config, pluggyAccountId, link: { cardId: link.cardId }, entries })
  }
  return fetched
}

// Fase 2: grava o que é de um cartão vinculado.
async function processLink(ctx: SyncContext, f: FetchedLink): Promise<number> {
  const { link } = f
  const scopedNow = () => ctx.transactions.filter((t) => t.cardId === link.cardId)

  // 1. Duplicata que já entrou antes (importado do banco + lançado no
  //    app): une os dois, fica o do app.
  const importedSides = scopedNow()
    .filter((t) => t.id.startsWith('pluggy_'))
    .map((t) => ({
      key: t.id,
      date: t.date,
      type: t.type,
      amount: t.amount,
      description: t.description,
      installmentIndex: t.installmentIndex,
      installmentTotal: t.installmentTotal,
      imported: t,
    }))
  const cleanup = pairBankWithManual(importedSides, scopedNow().filter(isManualCandidate), CARD_WINDOW_DAYS)
  if (cleanup.pairs.length > 0) {
    await mergeImportedDuplicates(ctx.workspaceId, cleanup.pairs, undefined, ctx.movementsById, ctx.transactions)
  }

  // 2. Lançamentos novos do banco: o que já foi importado/conciliado cai
  //    fora; o que corresponde a algo lançado no app só é vinculado.
  const fresh = newBankEntries(
    f.entries,
    scopedNow().filter((t) => t.id.startsWith('pluggy_') || t.bankRef !== undefined),
  ).map((entry) => ({ ...entry, key: entry.docId }))
  const matched = pairBankWithManual(fresh, scopedNow().filter(isManualCandidate), CARD_WINDOW_DAYS)
  if (matched.pairs.length > 0) await linkManualToBank(ctx.workspaceId, matched.pairs, undefined)

  const reviewed: ReviewedEntry[] = []
  for (const entry of matched.unmatched) {
    const categoryId = ctx.suggest(entry.description, entry.type) ?? ctx.firstCategory[entry.type]
    if (!categoryId) continue
    reviewed.push({ ...entry, categoryId, tags: [BANK_SYNC_TAG], categorySource: 'auto' })
  }

  await importTransactions(ctx.workspaceId, reviewed, link, ctx.createdBy)

  for (const entry of reviewed) {
    ctx.transactions.push({
      id: entry.docId ?? '',
      type: entry.type,
      amount: entry.amount,
      date: entry.date,
      description: entry.description,
      categoryId: entry.categoryId,
      paid: false,
      categorySource: 'auto',
      createdBy: ctx.createdBy,
      ...link,
    })
  }
  return reviewed.length
}

// Palpites de categoria (lançamentos do banco que ninguém corrigiu) são
// refeitos com base no que a pessoa categorizou à mão: se agora existe
// lançamento manual igual ou parecido com outra categoria, o palpite segue
// a escolha da pessoa. Continua marcado como palpite — só vira "manual"
// quando a pessoa mesma trocar.
async function refineAutoCategories(ctx: SyncContext): Promise<number> {
  const suggest = buildDetailedCategorySuggester(ctx.transactions, { manualOnly: true })
  const changes: { transaction: Transaction; categoryId: string }[] = []
  for (const t of ctx.transactions) {
    if (!isAutoCategory(t)) continue
    const suggestion = suggest(t.description, t.type)
    if (!suggestion || suggestion.confidence === 'fallback' || suggestion.categoryId === t.categoryId)
      continue
    changes.push({ transaction: t, categoryId: suggestion.categoryId })
  }
  for (let start = 0; start < changes.length; start += 450) {
    const batch = writeBatch(db)
    for (const { transaction, categoryId } of changes.slice(start, start + 450)) {
      batch.update(transactionDoc(ctx.workspaceId, transaction.id), { categoryId, categorySource: 'auto' })
      transaction.categoryId = categoryId
    }
    await batch.commit()
  }
  return changes.length
}

async function runSync(
  workspaceId: string,
  createdBy: string,
  shouldSync: (config: PluggyConfig) => boolean,
): Promise<SyncResult> {
  const configs = (await listPluggyConfigs(workspaceId)).filter(shouldSync)
  if (configs.length === 0) return { imported: 0, errors: [] }

  const [cardsSnap, categoriesSnap, transactionsSnap, movementsSnap] = await Promise.all([
    getDocs(cardsCollection(workspaceId)),
    getDocs(categoriesCollection(workspaceId)),
    getDocs(transactionsCollection(workspaceId)),
    getDocs(caixinhaMovementsCollection(workspaceId)),
  ])
  const categories = categoriesSnap.docs.map((d) => d.data())
  const transactions = transactionsSnap.docs.map((d) => d.data())
  const ctx: SyncContext = {
    workspaceId,
    createdBy,
    cardIds: new Set(cardsSnap.docs.map((d) => d.id)),
    // chave sem o sufixo de "movido de caixinha" (caixinhas/merge.ts)
    movementsById: new Map(movementsSnap.docs.map((d) => [movementBaseId(d.id), d.data()])),
    transactions,
    claimedBankKeys: new Set(transactions.flatMap((t) => (t.bankRef !== undefined ? [t.bankRef] : []))),
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
  const startedAt = new Date().toISOString()
  const failed = new Map<string, string>() // ownerUid → erro

  for (const config of configs) {
    try {
      for (const f of await fetchConnection(ctx, config)) imported += await processLink(ctx, f)
    } catch (err) {
      failed.set(config.ownerUid, err instanceof Error ? err.message : 'Falha na sincronização bancária.')
    }
  }

  for (const config of configs) {
    const error = failed.get(config.ownerUid)
    if (error) errors.push(error)
    await recordPluggySync(workspaceId, config.ownerUid, {
      at: startedAt,
      ...(error ? { error } : {}),
    }).catch(() => undefined)
  }

  try {
    await refineAutoCategories(ctx)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Falha ao refinar categorias.')
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
  if (config.itemIds.length === 0 || !Object.values(config.links).some((link) => 'cardId' in link)) return false
  return !config.lastSyncAt || Date.now() - Date.parse(config.lastSyncAt) >= AUTO_SYNC_INTERVAL_MS
}

// Chamado ao abrir o app (AppShell): qualquer membro que abre sincroniza
// as conexões de todos que estiverem há mais de AUTO_SYNC_INTERVAL_MS sem
// sincronizar. Silencioso — o erro fica gravado em cada conexão e aparece
// na tela de Conexão bancária.
export async function autoSyncBankTransactions(workspaceId: string, createdBy: string): Promise<void> {
  await exclusive(() => runSync(workspaceId, createdBy, isStale))
}
