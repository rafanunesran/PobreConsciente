import { doc, getDocs, increment, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { caixinhasCollection } from '../caixinhas/api'
import { caixinhaMovementDoc, caixinhaMovementsCollection } from '../caixinhas/movements'
import type { Caixinha, CaixinhaMovement } from '../caixinhas/types'
import { mergeCaixinhas, movementBaseId } from '../caixinhas/merge'
import { accountDoc } from '../accounts/api'
import { transactionDoc, transactionsCollection } from '../transactions/api'
import type { Transaction } from '../transactions/types'
import { ACCOUNT_WINDOW_DAYS, dayDistance, sharesWord } from './matching'
import { CAIXINHA_NAME_MAX, type ReserveMovement } from './reserveParsing'
import type { PluggyInvestment } from './types'
import { todayDateString } from '../cards/invoiceUtils'

// Mesmo limite de operações por writeBatch de imports/api.ts.
const BATCH_LIMIT = 500
// Caixinha usada quando o banco não diz qual (ex.: "Aplicação RDB") e a
// conta tem mais de uma (ou nenhuma) caixinha.
const DEFAULT_CAIXINHA_NAME = 'Reserva'

function normalizeName(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
}

// Qual caixinha da conta é a do lançamento:
// - com nome: igual; um começo do outro (o banco às vezes corta o nome —
//   "Camisetas Ran" pra "Camisetas Rafa"); ou uma palavra em comum;
// - sem nome: a única caixinha da conta, se houver só uma; senão a
//   "Reserva".
// Marcada pela pessoa (regra em caixinhas/rules.ts): essa, se ainda existe.
// `undefined` = não existe ainda, criar com `nameToCreate`.
function findCaixinha(
  caixinhas: Caixinha[],
  accountId: string,
  name: string | undefined,
  caixinhaId?: string,
): { caixinha?: Caixinha; nameToCreate: string } {
  const sameAccount = caixinhas.filter((c) => c.accountId === accountId)
  const marked = caixinhaId !== undefined ? sameAccount.find((c) => c.id === caixinhaId) : undefined
  if (marked) return { caixinha: marked, nameToCreate: marked.name }
  if (!name) {
    // a que já está ligada às aplicações sem nome do banco
    const bankReserve = sameAccount.find((c) => isGenericBankRef(c.bankRef))
    if (bankReserve) return { caixinha: bankReserve, nameToCreate: bankReserve.name }
    if (sameAccount.length === 1) return { caixinha: sameAccount[0], nameToCreate: DEFAULT_CAIXINHA_NAME }
    const fallback = sameAccount.find((c) => normalizeName(c.name) === normalizeName(DEFAULT_CAIXINHA_NAME))
    return { caixinha: fallback, nameToCreate: DEFAULT_CAIXINHA_NAME }
  }
  const wanted = normalizeName(name)
  const caixinha =
    sameAccount.find((c) => normalizeName(c.name) === wanted) ??
    sameAccount.find((c) => {
      const existing = normalizeName(c.name)
      return existing.length >= 3 && (existing.startsWith(wanted) || wanted.startsWith(existing))
    }) ??
    sameAccount.find((c) => sharesWord(c.name, name))
  return { caixinha, nameToCreate: name }
}

// O movimento da caixinha tem id derivado do lançamento do banco — é o
// que marca "já aplicado", então rodar de novo nunca soma duas vezes.
function movementIdFor(bankKey: string): string {
  return `bank_${bankKey}`
}

// Mesma folga de data da conciliação de conta (matching.ts).
const CLAIM_WINDOW_DAYS = ACCOUNT_WINDOW_DAYS

export interface ReserveItem {
  key: string // id do documento que o lançamento do banco tem/teria no app
  accountId: string
  date: string
  amount: number
  movement: ReserveMovement
  // lançamento importado antes desta regra (virou despesa/receita): sai
  // do extrato, sem mexer de novo no saldo da conta — o efeito dele já está lá
  legacyTransactionId?: string
}

// Guardar/resgatar vindo do banco é reserva, não gasto nem receita (mesma
// regra de caixinhas/caixinhaTransfers.ts): nunca vira Transaction. Pra
// cada um:
// 1. já aplicado antes (movimento bank_<id>) → nada a fazer;
// 2. a pessoa já guardou/resgatou esse valor pelo app (movimento da mesma
//    caixinha, mesmo tipo e valor, em até 10 dias) → o do app passa a ser
//    "o" do banco, sem mexer em saldo nenhum;
// 3. senão → move o saldo (conta → caixinha ou o contrário) e registra no
//    histórico. Caixinha que ainda não existe no app é criada.
export async function applyBankReserves(
  workspaceId: string,
  items: ReserveItem[],
  createdBy: string,
): Promise<void> {
  if (items.length === 0) return
  const [caixinhasSnap, movementsSnap] = await Promise.all([
    getDocs(caixinhasCollection(workspaceId)),
    getDocs(caixinhaMovementsCollection(workspaceId)),
  ])
  const caixinhas = caixinhasSnap.docs.map((d) => d.data())
  const movements = movementsSnap.docs.map((d) => d.data())
  // sem o sufixo de "movido de caixinha" (caixinhas/merge.ts)
  const appliedIds = new Set(movements.map((m) => movementBaseId(m.id)))
  // movimentos feitos pelo app (não vindos do banco) que ainda podem ser
  // reconhecidos como o mesmo de um lançamento do banco
  const claimable = movements.filter(
    (m) => !m.id.startsWith('bank_') && (m.type === 'guardar' || m.type === 'resgatar'),
  )

  // Cada item são até 5 operações (caixinha nova, saldo da caixinha, saldo
  // da conta, histórico, lançamento antigo).
  const chunkSize = Math.floor(BATCH_LIMIT / 5)
  for (let start = 0; start < items.length; start += chunkSize) {
    const batch = writeBatch(db)
    let writes = 0
    for (const item of items.slice(start, start + chunkSize)) {
      const movementId = movementIdFor(item.key)
      if (!appliedIds.has(movementId)) {
        appliedIds.add(movementId)
        const signed = item.movement.kind === 'guardar' ? item.amount : -item.amount
        const found = findCaixinha(caixinhas, item.accountId, item.movement.name, item.movement.caixinhaId)
        const accountCaixinhaIds = new Set(
          caixinhas.filter((c) => c.accountId === item.accountId).map((c) => c.id),
        )

        const claimIndex = claimable.findIndex(
          (m) =>
            m.type === item.movement.kind &&
            Math.abs(Math.abs(m.amount) - item.amount) < 0.005 &&
            dayDistance(m.date, item.date) <= CLAIM_WINDOW_DAYS &&
            (found.caixinha ? m.caixinhaId === found.caixinha.id : accountCaixinhaIds.has(m.caixinhaId)),
        )
        const movementRef = doc(caixinhaMovementsCollection(workspaceId), movementId)
        if (claimIndex >= 0) {
          // 2. já feito pelo app: troca o registro pelo do banco, saldos iguais
          const [claimed] = claimable.splice(claimIndex, 1) as [CaixinhaMovement]
          batch.delete(caixinhaMovementDoc(workspaceId, claimed.id))
          batch.set(movementRef, { ...claimed, id: movementId, date: item.date })
        } else {
          // 3. novo: move o saldo
          let caixinha = found.caixinha
          if (!caixinha) {
            const ref = doc(caixinhasCollection(workspaceId))
            caixinha = {
              id: ref.id,
              accountId: item.accountId,
              name: found.nameToCreate,
              balance: 0,
              createdBy,
            }
            batch.set(ref, caixinha)
            caixinhas.push(caixinha)
          }
          batch.update(doc(caixinhasCollection(workspaceId), caixinha.id), { balance: increment(signed) })
          caixinha.balance += signed
          if (!item.legacyTransactionId) {
            batch.update(accountDoc(workspaceId, item.accountId), { balance: increment(-signed) })
          }
          batch.set(movementRef, {
            id: movementId,
            caixinhaId: caixinha.id,
            type: item.movement.kind,
            amount: signed,
            date: item.date,
            createdBy,
          })
        }
        writes++
      }
      if (item.legacyTransactionId) {
        batch.delete(transactionDoc(workspaceId, item.legacyTransactionId))
        writes++
      }
    }
    if (writes > 0) await batch.commit()
  }
}

// Lançamentos "Guardado — X" / "Resgatado — X" que o app criava antes de
// caixinha virar reserva: saem do extrato (e dos totais do mês). O saldo
// da conta e o da caixinha já estão certos — o movimento no histórico da
// caixinha foi gravado junto — então é só apagar.
export function isLegacyCaixinhaTransaction(t: Transaction): boolean {
  return (
    t.accountId !== undefined &&
    !t.id.startsWith('pluggy_') &&
    ((t.type === 'expense' && t.description.startsWith('Guardado — ')) ||
      (t.type === 'income' && t.description.startsWith('Resgatado — ')))
  )
}

export async function removeLegacyCaixinhaTransactions(workspaceId: string): Promise<void> {
  const snapshot = await getDocs(transactionsCollection(workspaceId))
  const legacy = snapshot.docs.map((d) => d.data()).filter(isLegacyCaixinhaTransaction)
  if (legacy.length === 0) return
  for (let start = 0; start < legacy.length; start += BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const t of legacy.slice(start, start + BATCH_LIMIT)) batch.delete(transactionDoc(workspaceId, t.id))
    await batch.commit()
  }
}

// Palavras genéricas que o banco põe no nome do investimento e que não são
// o nome da caixinha ("Caixinha Viagem" → "Viagem"; "RDB" → nada).
const INVESTMENT_NAME_NOISE = new Set([
  'caixinha',
  'caixinhas',
  'reserva',
  'cofrinho',
  'porquinho',
  'objetivo',
  'meta',
  'rdb',
  'cdb',
  'lci',
  'lca',
  'lc',
  'liquidez',
  'diaria',
  'diario',
  'cdi',
  'ipca',
  'pre',
  'pos',
  'fixado',
  'prefixado',
  'posfixado',
  'renda',
  'fixa',
  'venc',
  'vencimento',
  'emissao',
  'aplicacao',
  'resgate',
  'investimento',
  'de',
  'do',
  'da',
  'em',
  'e',
  'com',
])
// Nome do investimento com o nome da instituição ("RDB Nu Financeira",
// "CDB NU PAGAMENTOS S.A.") é o nome do produto, não o de uma caixinha:
// pelo Open Finance o Nubank manda cada aplicação como um investimento
// separado, todos com esse nome de produto e sem o nome da caixinha.
const INSTITUTION_WORDS = new Set([
  'nu',
  'nubank',
  'financeira',
  'banco',
  'pagamentos',
  'instituicao',
  'scfi',
  'sa',
  'ltda',
  'corretora',
])

function cleanWord(word: string): string {
  return normalizeName(word).replace(/[^a-z0-9]/g, '')
}

// Nome de caixinha que o nome do investimento traz; '' = nenhum (só
// produto, taxa, vencimento...).
export function investmentCaixinhaName(investmentName: string): string {
  const words = investmentName.replace(/\s+/g, ' ').trim().split(/[\s—–\-:|/()]+/).filter(Boolean)
  if (words.some((w) => INSTITUTION_WORDS.has(cleanWord(w)))) return ''
  return words
    .filter((w) => {
      const c = cleanWord(w)
      // número/taxa/data ("110%", "2028", "15/01/2028") não é nome
      return c !== '' && !/\d/.test(c) && !INVESTMENT_NAME_NOISE.has(c)
    })
    .join(' ')
    .trim()
    .slice(0, CAIXINHA_NAME_MAX)
}

export interface InvestmentItem {
  investment: PluggyInvestment
  accountId: string // conta do app do mesmo banco
}

// Investimentos que são a mesma caixinha. Renda fixa com o mesmo nome de
// caixinha (ou sem nome nenhum) do mesmo banco é uma caixinha só, com a
// soma dos saldos — cada "Dinheiro guardado" no Nubank vira uma aplicação
// (RDB) nova, e antes cada uma virava uma caixinha. Ação, fundo... ficam
// cada um por si e só se ligam a uma caixinha que já exista com o nome.
interface InvestmentGroup {
  // vai em Caixinha.bankRef
  key: string
  accountId: string
  name: string // '' = sem nome (a "Reserva" da conta)
  balance: number
  ids: Set<string>
  // nomes (normalizados) que o banco deu aos investimentos do grupo
  rawNames: Set<string>
  // pode criar caixinha nova: renda fixa com saldo
  creatable: boolean
}

const GENERIC_GROUP_SUFFIX = ':*'

export function isGenericBankRef(bankRef: string | undefined): boolean {
  return bankRef !== undefined && bankRef.startsWith('inv:') && bankRef.endsWith(GENERIC_GROUP_SUFFIX)
}

function groupInvestments(items: InvestmentItem[]): InvestmentGroup[] {
  const groups = new Map<string, InvestmentGroup>()
  for (const { investment, accountId } of items) {
    const fixedIncome = investment.type === 'FIXED_INCOME'
    const name = investmentCaixinhaName(investment.name)
    if (!fixedIncome && !name) continue
    const key = fixedIncome
      ? `inv:${investment.itemId}:${name ? normalizeName(name) : '*'}`
      : investment.id
    const active = investment.status !== 'TOTAL_WITHDRAWAL'
    let group = groups.get(key)
    if (!group) {
      group = { key, accountId, name, balance: 0, ids: new Set(), rawNames: new Set(), creatable: false }
      groups.set(key, group)
    }
    group.ids.add(investment.id)
    group.rawNames.add(normalizeName(investment.name))
    if (active) {
      group.balance += investment.balance
      if (fixedIncome && investment.balance > 0) group.creatable = true
    }
  }
  for (const g of groups.values()) g.balance = Math.round(g.balance * 100) / 100
  // com nome primeiro: a "Reserva" sem nome fica com o que sobra
  return [...groups.values()].sort((a, b) => Number(a.name === '') - Number(b.name === ''))
}

// O saldo de cada caixinha passa a ser o do investimento correspondente no
// banco (caixinha/reserva aparece no Open Finance como renda fixa). A
// caixinha fica vinculada ao grupo de investimentos (bankRef); sem vínculo
// ainda, procura pelo nome e, se for renda fixa, cria.
// Caixinhas que versões antigas criaram uma por aplicação (bankRef = id do
// investimento) são juntadas na do grupo, com histórico e saldo.
// Diferença entre o saldo do app e o do banco (rendimento, movimento que o
// app não viu, aplicação contada duas vezes) fica no histórico como
// "Ajuste de saldo".
export async function alignCaixinhasWithInvestments(
  workspaceId: string,
  items: InvestmentItem[],
  createdBy: string,
): Promise<number> {
  if (items.length === 0) return 0
  const [caixinhasSnap, movementsSnap] = await Promise.all([
    getDocs(caixinhasCollection(workspaceId)),
    getDocs(caixinhaMovementsCollection(workspaceId)),
  ])
  let caixinhas = caixinhasSnap.docs.map((d) => d.data())
  const movements = movementsSnap.docs.map((d) => d.data())
  const reportedIds = new Set(items.map((i) => i.investment.id))
  const today = todayDateString()
  const linked = new Set<string>() // caixinhas já ligadas a um grupo nesta rodada
  const pending: { caixinha: Caixinha; group: InvestmentGroup; created: boolean }[] = []

  for (const group of groupInvestments(items)) {
    const generic = group.name === ''
    const sameAccount = caixinhas.filter((c) => c.accountId === group.accountId && !linked.has(c.id))
    const byKey = sameAccount.find((c) => c.bankRef === group.key)
    const legacy = sameAccount.filter((c) => c.bankRef !== undefined && group.ids.has(c.bankRef))
    // aplicação que já foi toda resgatada e o banco nem lista mais: a
    // caixinha que tinha sido criada pra ela também é desse grupo
    const stale = generic
      ? sameAccount.filter(
          (c) =>
            c.bankRef !== undefined &&
            !c.bankRef.startsWith('inv:') &&
            !reportedIds.has(c.bankRef) &&
            (investmentCaixinhaName(c.name) === '' || group.rawNames.has(normalizeName(c.name))),
        )
      : []
    const free = sameAccount.filter((c) => c.bankRef === undefined)
    const reservaByName = free.find((c) => normalizeName(c.name) === normalizeName(DEFAULT_CAIXINHA_NAME))
    let caixinha = generic
      ? (byKey ?? reservaByName ?? legacy[0] ?? stale[0] ?? findCaixinha(free, group.accountId, undefined).caixinha)
      : (byKey ?? legacy[0] ?? findCaixinha(free, group.accountId, group.name).caixinha)

    let created = false
    if (!caixinha) {
      if (!group.creatable) continue
      const ref = doc(caixinhasCollection(workspaceId))
      caixinha = {
        id: ref.id,
        accountId: group.accountId,
        name: group.name || DEFAULT_CAIXINHA_NAME,
        balance: 0,
        createdBy,
      }
      caixinhas.push(caixinha)
      created = true
    }

    const target = caixinha
    const duplicates = [byKey, ...legacy, ...stale].filter(
      (c, i, all): c is Caixinha => c !== undefined && c.id !== target.id && all.indexOf(c) === i,
    )
    if (duplicates.length > 0) {
      await mergeCaixinhas(workspaceId, target, duplicates, movements)
      const gone = new Set(duplicates.map((c) => c.id))
      caixinhas = caixinhas.filter((c) => !gone.has(c.id))
    }
    linked.add(target.id)
    pending.push({ caixinha: target, group, created })
  }

  const batch = writeBatch(db)
  let aligned = 0
  for (const { caixinha, group, created } of pending) {
    let bankBalance = group.balance
    if (group.name === '') {
      // Sem nome, o banco só diz o total guardado na conta: o que já está
      // nas outras caixinhas dessa conta (marcadas pela pessoa, com nome)
      // sai dele — o resto é desta.
      // (as ligadas a um investimento com nome já têm o saldo delas à parte)
      const others = caixinhas.filter(
        (c) => c.accountId === caixinha.accountId && c.id !== caixinha.id && !linked.has(c.id),
      )
      bankBalance = Math.round((group.balance - others.reduce((sum, c) => sum + c.balance, 0)) * 100) / 100
    }
    const ref = doc(caixinhasCollection(workspaceId), caixinha.id)
    if (bankBalance < 0) {
      // as outras já passam do total do banco — não inventa saldo negativo
      if (created) continue
      batch.update(ref, { bankRef: group.key })
      caixinha.bankRef = group.key
      continue
    }
    const diff = Math.round((bankBalance - caixinha.balance) * 100) / 100
    if (created) {
      batch.set(ref, { ...caixinha, balance: bankBalance, bankRef: group.key })
    } else {
      batch.update(ref, { balance: bankBalance, bankRef: group.key })
    }
    if (Math.abs(diff) >= 0.01) {
      const movementRef = doc(caixinhaMovementsCollection(workspaceId))
      batch.set(movementRef, {
        id: movementRef.id,
        caixinhaId: caixinha.id,
        type: 'ajuste',
        amount: diff,
        date: today,
        createdBy,
      })
    }
    caixinha.balance = bankBalance
    caixinha.bankRef = group.key
    aligned++
  }
  await batch.commit()
  return aligned
}
