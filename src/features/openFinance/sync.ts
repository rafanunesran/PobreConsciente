import { doc, getDoc, getDocs, writeBatch } from 'firebase/firestore'
import { getUserProfile } from '../family/userProfiles'
import { db } from '../../lib/firebase'
import { accountDoc, accountsCollection } from '../accounts/api'
import { type AccountTransferLog, listTransferLogIds, saveTransferLogs } from '../accounts/transferLog'
import { caixinhaMovementsCollection } from '../caixinhas/movements'
import type { CaixinhaMovement } from '../caixinhas/types'
import type { CreditCard } from '../cards/types'
import { cardsCollection } from '../cards/api'
import { todayDateString } from '../cards/invoiceUtils'
import { categoriesCollection } from '../categories/api'
import { buildCategorySuggester } from '../imports/categorize'
import { importTransactions } from '../imports/api'
import type { ParsedEntry, ReviewedEntry } from '../imports/types'
import { transactionDoc, transactionsCollection } from '../transactions/api'
import { formatDate, parseDate, roundToCents } from '../transactions/dateUtils'
import type { Transaction, TransactionType } from '../transactions/types'
import { listPluggyConfigs, recordPluggySync } from './api'
import {
  alignCaixinhasWithInvestments,
  applyBankReserves,
  type InvestmentItem,
  isLegacyCaixinhaTransaction,
  removeLegacyCaixinhaTransactions,
  type ReserveItem,
} from './caixinhaSync'
import { parseReserveMovement, type ReserveMovement } from './reserveParsing'
import { type CaixinhaRule, findCaixinhaRule, listCaixinhaRules } from '../caixinhas/rules'
import { authenticate, listAccounts, listInvestments, listTransactions } from './pluggyClient'
import {
  ACCOUNT_WINDOW_DAYS,
  CARD_WINDOW_DAYS,
  buildFamilyIdentity,
  type FamilyIdentity,
  type TopUpSide,
  findCreditTopUps,
  findTransferPairs,
  isFamilyCounterpart,
  isManualCandidate,
  TRANSFER_DESCRIPTION,
  looksLikeBillPayment,
  pairBankWithManual,
  TRANSFER_WINDOW_DAYS,
  type TransferSide,
} from './matching'
import { autoPayCardBill, linkManualToBank, mergeImportedDuplicates } from './reconcile'
import type { PluggyAccount, PluggyAccountLink, PluggyConfig, PluggyTransaction } from './types'

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

function linkTargetExists(link: PluggyAccountLink, accountIds: Set<string>, cardIds: Set<string>): boolean {
  return 'accountId' in link ? accountIds.has(link.accountId) : cardIds.has(link.cardId)
}

export interface SyncResult {
  imported: number
  accountsAligned?: number // contas com saldo igualado ao do banco
  caixinhasAligned?: number // caixinhas com saldo igualado ao do investimento
  // uma mensagem por conexão que falhou — as outras seguem normalmente
  errors: string[]
}

interface SyncContext {
  workspaceId: string
  createdBy: string
  accountIds: Set<string>
  cardIds: Set<string>
  cards: CreditCard[]
  movementsById: Map<string, CaixinhaMovement>
  // "esta movimentação é a caixinha X" marcadas pela pessoa (caixinhas/rules.ts)
  caixinhaRules: CaixinhaRule[]
  // saldo informado pelo banco por conta do app — aplicado no fim (ver runSync)
  bankBalances: Map<string, number>
  // cresce a cada conexão importada: se marido e mulher vincularem a mesma
  // conta conjunta, o dedupe por data + tipo + valor da segunda conexão
  // enxerga o que a primeira acabou de importar.
  transactions: Transaction[]
  suggest: (description: string, type: TransactionType) => string | undefined
  firstCategory: Record<TransactionType, string | undefined>
}

// O que foi lido da Pluggy pra uma conta vinculada, antes de gravar nada.
interface FetchedLink {
  config: PluggyConfig
  pluggyAccountId: string
  link: PluggyAccountLink
  targetKind: 'account' | 'card'
  // a partir da data de início (o que pode ser importado)
  entries: BankEntry[]
  // alguns dias antes também — só pra achar o outro lado de uma
  // transferência que caiu logo antes da janela
  pairingEntries: BankEntry[]
  // id do documento → quem pagou e quem recebeu têm o mesmo CPF/CNPJ
  ownTransferKeys: Set<string>
  // id do documento → a outra ponta do Pix/TED (quem recebeu, numa saída;
  // quem pagou, numa entrada), quando o banco informa
  counterparts: Map<string, { name?: string | null; document?: string | null }>
  pluggyAccount?: PluggyAccount
}

interface FetchedConnection {
  links: FetchedLink[]
  investments: InvestmentItem[]
  // titulares das contas conectadas — também são "da família"
  ownerNames: string[]
  ownerDocuments: string[]
}

function sameDocument(tx: PluggyTransaction): boolean {
  const payer = tx.paymentData?.payer?.documentNumber?.value?.replace(/\D/g, '')
  const receiver = tx.paymentData?.receiver?.documentNumber?.value?.replace(/\D/g, '')
  return Boolean(payer && receiver && payer === receiver)
}

// Fase 1: lê da Pluggy tudo de uma conexão (sem gravar nada).
async function fetchConnection(ctx: SyncContext, config: PluggyConfig): Promise<FetchedConnection> {
  const linkEntries = Object.entries(config.links)
  const empty: FetchedConnection = { links: [], investments: [], ownerNames: [], ownerDocuments: [] }
  if (linkEntries.length === 0) return empty

  const today = todayDateString()
  const overlapStart = config.lastSyncAt ? daysBefore(config.lastSyncAt.slice(0, 10), OVERLAP_DAYS) : ''
  const apiKey = await authenticate(config.clientId, config.clientSecret)

  // Contas da Pluggy (pra saber o saldo atual de cada uma) — uma chamada
  // por banco conectado.
  const pluggyAccounts = new Map<string, PluggyAccount>()
  for (const itemId of config.itemIds) {
    for (const account of await listAccounts(apiKey, itemId)) pluggyAccounts.set(account.id, account)
  }
  const ownerNames = [...pluggyAccounts.values()].flatMap((a) => (a.owner ? [a.owner] : []))
  const ownerDocuments = [...pluggyAccounts.values()].flatMap((a) => (a.taxNumber ? [a.taxNumber] : []))

  // Investimentos (caixinhas/reservas) de cada banco, ligados à conta do
  // app vinculada à conta corrente desse mesmo banco. Banco que não
  // informa investimentos só fica sem — não derruba a sincronização.
  const investments: InvestmentItem[] = []
  for (const itemId of config.itemIds) {
    const appAccountId = linkEntries.flatMap(([pid, link]) =>
      'accountId' in link && pluggyAccounts.get(pid)?.itemId === itemId && ctx.accountIds.has(link.accountId)
        ? [link.accountId]
        : [],
    )[0]
    if (!appAccountId) continue
    try {
      for (const investment of await listInvestments(apiKey, itemId)) {
        investments.push({ investment, accountId: appAccountId })
      }
    } catch {
      // sem investimentos nesse banco
    }
  }

  const fetched: FetchedLink[] = []
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
    const fetchFrom = targetKind === 'account' ? daysBefore(dateFrom, TRANSFER_WINDOW_DAYS) : dateFrom
    const pluggyTransactions = await listTransactions(apiKey, pluggyAccountId, fetchFrom, dateTo)

    const pairingEntries: BankEntry[] = []
    const ownTransferKeys = new Set<string>()
    const counterparts: FetchedLink['counterparts'] = new Map()
    for (const tx of pluggyTransactions) {
      const entry = toBankEntry(tx, targetKind)
      if (!entry) continue
      pairingEntries.push(entry)
      if (targetKind !== 'account') continue
      if (sameDocument(tx)) ownTransferKeys.add(entry.docId)
      const other = entry.type === 'expense' ? tx.paymentData?.receiver : tx.paymentData?.payer
      if (other) counterparts.set(entry.docId, { name: other.name, document: other.documentNumber?.value })
    }
    fetched.push({
      config,
      pluggyAccountId,
      link,
      targetKind,
      entries: pairingEntries.filter((e) => e.date >= dateFrom),
      pairingEntries,
      ownTransferKeys,
      counterparts,
      pluggyAccount: pluggyAccounts.get(pluggyAccountId),
    })
  }
  return { links: fetched, investments, ownerNames, ownerDocuments }
}

// Só entra na busca de pares o que tem cara de transferência dos dois
// lados — sem isso, um salário e um aluguel de mesmo valor no mesmo dia
// em contas diferentes "virariam" transferência. Caixinha e pagamento de
// fatura têm tratamento próprio e ficam de fora.

// Guardar/resgatar caixinha: primeiro a marcação da pessoa pra essa
// descrição nessa conta; senão, o que a descrição diz.
function reserveMovementOf(
  ctx: SyncContext,
  accountId: string,
  entry: { description: string; type: TransactionType },
): ReserveMovement | null {
  const rule = findCaixinhaRule(ctx.caixinhaRules, accountId, entry)
  if (rule) return { kind: rule.type === 'expense' ? 'guardar' : 'resgatar', caixinhaId: rule.caixinhaId }
  return parseReserveMovement(entry)
}

function isTransferCandidate(
  ctx: SyncContext,
  accountId: string,
  entry: { description: string; type: TransactionType },
): boolean {
  return (
    TRANSFER_DESCRIPTION.test(entry.description) &&
    reserveMovementOf(ctx, accountId, entry) === null &&
    !looksLikeBillPayment(entry.description)
  )
}

// Fase 2: transferências entre contas da família (todas as conexões
// juntas — a saída pode estar na conexão do marido e a entrada na da
// esposa). Devolve as chaves que não devem virar lançamento e apaga as
// transferências que já tinham sido importadas como receita/despesa.
async function detectTransfers(
  ctx: SyncContext,
  fetched: FetchedLink[],
  family: FamilyIdentity,
): Promise<Set<string>> {
  const sides: TransferSide[] = []
  const skip = new Set<string>()
  const seen = new Set<string>()

  // "Pix no crédito": a entrada "valor adicionado por cartão de crédito" e
  // a saída de mesmo valor na conta são só passagem — o gasto é a cobrança
  // no cartão. Não é transferência (não vai pro log), só não vira
  // lançamento. Inclui o que já tinha sido importado.
  const topUpSides: TopUpSide[] = []
  for (const f of fetched) {
    if (!('accountId' in f.link)) continue
    for (const entry of f.pairingEntries)
      topUpSides.push({ key: entry.docId, appAccountId: f.link.accountId, ...entry })
  }
  for (const t of ctx.transactions) {
    if (!t.id.startsWith('pluggy_') || t.accountId === undefined) continue
    topUpSides.push({
      key: t.id,
      appAccountId: t.accountId,
      date: t.date,
      type: t.type,
      amount: t.amount,
      description: t.description,
    })
  }
  const creditTopUps = findCreditTopUps(topUpSides)

  // o que cada chave é, pra registrar no log de transferências (transferLog.ts)
  const details = new Map<string, Omit<AccountTransferLog, 'id' | 'createdBy'>>()
  for (const f of fetched) {
    if (!('accountId' in f.link)) continue
    for (const key of f.ownTransferKeys) skip.add(key)
    for (const entry of f.pairingEntries) {
      if (seen.has(entry.docId) || creditTopUps.has(entry.docId)) continue
      seen.add(entry.docId)
      details.set(entry.docId, {
        accountId: f.link.accountId,
        type: entry.type,
        amount: entry.amount,
        date: entry.date,
        description: entry.description,
      })
      // Pix/TED pra (ou de) alguém da família — mesmo sem a conta do outro
      // conectada, o dinheiro não saiu da casa (ver FamilyIdentity)
      if (
        reserveMovementOf(ctx, f.link.accountId, entry) === null &&
        isFamilyCounterpart(f.counterparts.get(entry.docId), entry.description, family)
      ) {
        skip.add(entry.docId)
        continue
      }
      if (isTransferCandidate(ctx, f.link.accountId, entry))
        sides.push({ key: entry.docId, appAccountId: f.link.accountId, ...entry })
    }
  }
  // o que já foi importado também entra — a transferência pode ter virado
  // receita/despesa antes desta regra existir
  for (const t of ctx.transactions) {
    if (!t.id.startsWith('pluggy_') || t.accountId === undefined || seen.has(t.id)) continue
    if (creditTopUps.has(t.id)) continue
    details.set(t.id, {
      accountId: t.accountId,
      type: t.type,
      amount: t.amount,
      date: t.date,
      description: t.description,
    })
    if (
      reserveMovementOf(ctx, t.accountId, t) === null &&
      isFamilyCounterpart(undefined, t.description, family)
    ) {
      skip.add(t.id)
      continue
    }
    if (!isTransferCandidate(ctx, t.accountId, t)) continue
    sides.push({ key: t.id, appAccountId: t.accountId, date: t.date, type: t.type, amount: t.amount })
  }
  for (const key of findTransferPairs(sides)) skip.add(key)

  // Não vira lançamento, mas aparece como "Transferências" na divisão por
  // categoria do extrato. Só o que ainda não está no log; falhar aqui (regras
  // do Firestore sem a coleção) não impede a sincronização.
  try {
    const logged = await listTransferLogIds(ctx.workspaceId)
    const logs: AccountTransferLog[] = []
    for (const key of skip) {
      const detail = details.get(key)
      if (detail && !logged.has(key) && reserveMovementOf(ctx, detail.accountId, detail) === null)
        logs.push({ id: key, ...detail, createdBy: ctx.createdBy })
    }
    await saveTransferLogs(ctx.workspaceId, logs)
  } catch {
    // só visualização
  }

  for (const key of creditTopUps) skip.add(key)
  const toDelete = [...skip].filter((key) => ctx.transactions.some((t) => t.id === key))
  if (toDelete.length > 0) {
    // saldo das contas é corrigido no fim (saldo do banco), então basta apagar
    const batch = writeBatch(db)
    for (const id of toDelete) batch.delete(transactionDoc(ctx.workspaceId, id))
    await batch.commit()
    ctx.transactions = ctx.transactions.filter((t) => !toDelete.includes(t.id))
  }
  return skip
}

// Fase 3: grava o que é de uma conta vinculada.
async function processLink(ctx: SyncContext, f: FetchedLink, transferKeys: Set<string>): Promise<number> {
  const { link, targetKind } = f
  const entries = f.entries.filter((e) => !transferKeys.has(e.docId))
  let imported = 0
  const accountId = 'accountId' in link ? link.accountId : undefined
  const windowDays = accountId !== undefined ? ACCOUNT_WINDOW_DAYS : CARD_WINDOW_DAYS
  const scopedNow = () =>
    ctx.transactions.filter((t) =>
      'cardId' in link ? t.cardId === link.cardId : t.accountId === link.accountId,
    )

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
      imported: t,
    }))
  const cleanup = pairBankWithManual(importedSides, scopedNow().filter(isManualCandidate), windowDays)
  if (cleanup.pairs.length > 0) {
    await mergeImportedDuplicates(
      ctx.workspaceId,
      cleanup.pairs,
      accountId,
      ctx.movementsById,
      ctx.transactions,
    )
  }

  // 2. Lançamentos novos do banco: o que já foi importado/conciliado cai
  //    fora; o que corresponde a algo lançado no app só é vinculado.
  const fresh = newBankEntries(
    entries,
    scopedNow().filter((t) => t.id.startsWith('pluggy_') || t.bankRef !== undefined),
  ).map((entry) => ({ ...entry, key: entry.docId }))
  const matched = pairBankWithManual(fresh, scopedNow().filter(isManualCandidate), windowDays)
  if (matched.pairs.length > 0) await linkManualToBank(ctx.workspaceId, matched.pairs, accountId)

  // 3. Pagamento de fatura na conta sem "Pagar fatura" no app: paga a
  //    fatura do cartão correspondente em vez de virar despesa solta.
  const toImport: BankEntry[] = []
  for (const entry of matched.unmatched) {
    if (accountId !== undefined && entry.type === 'expense' && looksLikeBillPayment(entry.description)) {
      const categoryId = ctx.suggest(entry.description, 'expense') ?? ctx.firstCategory.expense
      const paid =
        categoryId !== undefined &&
        (await autoPayCardBill({
          workspaceId: ctx.workspaceId,
          bank: entry,
          accountId,
          cards: ctx.cards,
          transactions: ctx.transactions,
          categoryId,
          createdBy: ctx.createdBy,
        }))
      if (paid) continue
    }
    toImport.push(entry)
  }

  const reviewed: ReviewedEntry[] = []
  for (const entry of toImport) {
    const categoryId = ctx.suggest(entry.description, entry.type) ?? ctx.firstCategory[entry.type]
    if (!categoryId) continue
    reviewed.push({ ...entry, categoryId, tags: [BANK_SYNC_TAG] })
  }

  await importTransactions(ctx.workspaceId, reviewed, link, ctx.createdBy)
  imported += reviewed.length
  // 4. Saldo da conta = saldo do banco (aplicado no fim da sincronização).
  const pluggyAccount = f.pluggyAccount
  if (
    accountId !== undefined &&
    pluggyAccount &&
    pluggyAccount.type !== 'CREDIT' &&
    typeof pluggyAccount.balance === 'number'
  ) {
    ctx.bankBalances.set(accountId, pluggyAccount.balance)
  }

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
  return imported
}

// Nome completo (e o nome de exibição, se tiver nome e sobrenome) de cada
// pessoa do workspace — o perfil da Família (ver family/userProfiles.ts).
async function loadFamilyNames(workspaceId: string, createdBy: string): Promise<string[]> {
  const familySnap = await getDoc(doc(db, 'families', workspaceId))
  const memberIds: string[] =
    familySnap.exists() && Array.isArray(familySnap.data().memberIds)
      ? familySnap.data().memberIds.filter((id: unknown): id is string => typeof id === 'string')
      : [createdBy]
  const profiles = await Promise.all(memberIds.map((uid) => getUserProfile(uid).catch(() => null)))
  return profiles.flatMap((p) => [p?.fullName, p?.displayName].filter((n): n is string => Boolean(n)))
}

async function runSync(
  workspaceId: string,
  createdBy: string,
  shouldSync: (config: PluggyConfig) => boolean,
): Promise<SyncResult> {
  const configs = (await listPluggyConfigs(workspaceId)).filter(shouldSync)
  if (configs.length === 0) return { imported: 0, errors: [] }

  const [accountsSnap, cardsSnap, categoriesSnap, transactionsSnap, movementsSnap, caixinhaRules] =
    await Promise.all([
      getDocs(accountsCollection(workspaceId)),
      getDocs(cardsCollection(workspaceId)),
      getDocs(categoriesCollection(workspaceId)),
      getDocs(transactionsCollection(workspaceId)),
      getDocs(caixinhaMovementsCollection(workspaceId)),
      // regras novas não têm permissão ainda se o firestore.rules não foi
      // publicado — segue só com a leitura da descrição
      listCaixinhaRules(workspaceId).catch(() => [] as CaixinhaRule[]),
    ])
  const categories = categoriesSnap.docs.map((d) => d.data())
  const transactions = transactionsSnap.docs.map((d) => d.data())
  const ctx: SyncContext = {
    workspaceId,
    createdBy,
    accountIds: new Set(accountsSnap.docs.map((d) => d.id)),
    cardIds: new Set(cardsSnap.docs.map((d) => d.id)),
    cards: cardsSnap.docs.map((d) => d.data()),
    movementsById: new Map(movementsSnap.docs.map((d) => [d.id, d.data()])),
    caixinhaRules,
    bankBalances: new Map(),
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
  const startedAt = new Date().toISOString()

  // "Guardado — X"/"Resgatado — X" que o app criava antes de caixinha virar
  // reserva saem antes de conciliar — senão viram par de um lançamento do banco.
  if (ctx.transactions.some(isLegacyCaixinhaTransaction)) {
    await removeLegacyCaixinhaTransactions(workspaceId)
    ctx.transactions = ctx.transactions.filter((t) => !isLegacyCaixinhaTransaction(t))
  }
  const failed = new Map<string, string>() // ownerUid → erro

  const fetched: FetchedLink[] = []
  const investments: InvestmentItem[] = []
  const familyNames = await loadFamilyNames(workspaceId, createdBy).catch(() => [] as string[])
  const familyDocuments: string[] = []
  for (const config of configs) {
    try {
      const connection = await fetchConnection(ctx, config)
      fetched.push(...connection.links)
      investments.push(...connection.investments)
      familyNames.push(...connection.ownerNames)
      familyDocuments.push(...connection.ownerDocuments)
    } catch (err) {
      failed.set(config.ownerUid, err instanceof Error ? err.message : 'Falha na sincronização bancária.')
    }
  }
  const family = buildFamilyIdentity(familyNames, familyDocuments)

  let transferKeys = new Set<string>()
  try {
    transferKeys = await detectTransfers(ctx, fetched, family)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Falha ao reconhecer transferências.')
  }
  // Alguma conexão falhou: o outro lado de uma transferência pode estar
  // nela. Em vez de importar uma metade como receita/despesa, o que tem
  // cara de transferência fica pra próxima sincronização.
  if (failed.size > 0) {
    for (const f of fetched) {
      for (const entry of f.entries)
        if ('accountId' in f.link && isTransferCandidate(ctx, f.link.accountId, entry))
          transferKeys.add(entry.docId)
    }
  }

  // Caixinha (guardar/resgatar) é reserva, não gasto nem receita: não vira
  // lançamento — o valor vai direto pra caixinha (ver caixinhaSync.ts).
  // Inclui o que já tinha sido importado como despesa/receita antes.
  try {
    const existingIds = new Set(ctx.transactions.map((t) => t.id))
    const items: ReserveItem[] = []
    const seen = new Set<string>()
    for (const f of fetched) {
      if (!('accountId' in f.link) || failed.has(f.config.ownerUid)) continue
      for (const entry of f.entries) {
        if (transferKeys.has(entry.docId) || seen.has(entry.docId)) continue
        const movement = reserveMovementOf(ctx, f.link.accountId, entry)
        if (!movement) continue
        seen.add(entry.docId)
        transferKeys.add(entry.docId)
        items.push({
          key: entry.docId,
          accountId: f.link.accountId,
          date: entry.date,
          amount: entry.amount,
          movement,
          ...(existingIds.has(entry.docId) ? { legacyTransactionId: entry.docId } : {}),
        })
      }
    }
    for (const t of ctx.transactions) {
      if (!t.id.startsWith('pluggy_') || t.accountId === undefined || seen.has(t.id)) continue
      const movement = reserveMovementOf(ctx, t.accountId, t)
      if (!movement) continue
      items.push({
        key: t.id,
        accountId: t.accountId,
        date: t.date,
        amount: t.amount,
        movement,
        legacyTransactionId: t.id,
      })
    }
    await applyBankReserves(workspaceId, items, createdBy)
    const removed = new Set(items.flatMap((i) => (i.legacyTransactionId ? [i.legacyTransactionId] : [])))
    ctx.transactions = ctx.transactions.filter((t) => !removed.has(t.id))
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Falha ao atualizar as caixinhas.')
  }

  // Saldo de cada caixinha = saldo do investimento no banco (depois dos
  // movimentos acima, pra diferença virar só o rendimento/ajuste).
  let caixinhasAligned = 0
  try {
    caixinhasAligned = await alignCaixinhasWithInvestments(workspaceId, investments, createdBy)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Falha ao atualizar o saldo das caixinhas.')
  }

  for (const f of fetched) {
    if (failed.has(f.config.ownerUid)) continue
    try {
      imported += await processLink(ctx, f, transferKeys)
    } catch (err) {
      failed.set(f.config.ownerUid, err instanceof Error ? err.message : 'Falha na sincronização bancária.')
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

  // Por último: o saldo de cada conta vinculada passa a ser o que o banco
  // informa. É o que garante que app e banco batem mesmo com diferenças
  // que a conciliação não resolve (lançamento manual que nunca vai
  // aparecer no banco, saldo inicial errado...). Um lançamento manual pago
  // que o banco ainda não mostrou "some" do saldo até o banco registrar —
  // aí é conciliado e o saldo continua batendo.
  if (ctx.bankBalances.size > 0) {
    try {
      const batch = writeBatch(db)
      for (const [accountId, balance] of ctx.bankBalances) {
        if (ctx.accountIds.has(accountId))
          batch.update(accountDoc(workspaceId, accountId), {
            balance: roundToCents(balance),
          })
      }
      await batch.commit()
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Falha ao atualizar o saldo das contas.')
    }
  }
  return { imported, errors, accountsAligned: ctx.bankBalances.size, caixinhasAligned }
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
