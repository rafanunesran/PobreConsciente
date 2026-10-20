import { doc, getDocs, increment, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { caixinhasCollection } from '../caixinhas/api'
import { caixinhaMovementDoc, caixinhaMovementsCollection } from '../caixinhas/movements'
import type { Caixinha, CaixinhaMovement } from '../caixinhas/types'
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
// `undefined` = não existe ainda, criar com `nameToCreate`.
function findCaixinha(
  caixinhas: Caixinha[],
  accountId: string,
  name: string | undefined,
): { caixinha?: Caixinha; nameToCreate: string } {
  const sameAccount = caixinhas.filter((c) => c.accountId === accountId)
  if (!name) {
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
  const appliedIds = new Set(movements.map((m) => m.id))
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
        const found = findCaixinha(caixinhas, item.accountId, item.movement.name)
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
  'liquidez',
  'diaria',
])

function investmentCaixinhaName(investment: PluggyInvestment): string {
  const words = investment.name
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => !INVESTMENT_NAME_NOISE.has(normalizeName(w).replace(/[^a-z0-9]/g, '')))
  return words.join(' ').trim().slice(0, CAIXINHA_NAME_MAX)
}

export interface InvestmentItem {
  investment: PluggyInvestment
  accountId: string // conta do app do mesmo banco
}

// O saldo de cada caixinha passa a ser o do investimento correspondente no
// banco (caixinha/reserva aparece no Open Finance como renda fixa). A
// caixinha fica vinculada ao investimento (bankRef); sem vínculo ainda,
// procura pelo nome e, se for renda fixa, cria. Diferença entre o saldo do
// app e o do banco (rendimento, movimento que o app não viu) fica no
// histórico como "Ajuste de saldo".
export async function alignCaixinhasWithInvestments(
  workspaceId: string,
  items: InvestmentItem[],
  createdBy: string,
): Promise<number> {
  if (items.length === 0) return 0
  const caixinhas = (await getDocs(caixinhasCollection(workspaceId))).docs.map((d) => d.data())
  const today = todayDateString()
  const batch = writeBatch(db)
  let aligned = 0

  for (const { investment, accountId } of items) {
    if (investment.status === 'TOTAL_WITHDRAWAL') continue
    const name = investmentCaixinhaName(investment)
    let caixinha =
      caixinhas.find((c) => c.bankRef === investment.id) ??
      (name
        ? findCaixinha(
            caixinhas.filter((c) => c.bankRef === undefined),
            accountId,
            name,
          ).caixinha
        : undefined)
    if (!caixinha) {
      // só renda fixa vira caixinha nova (ação, fundo... não são reserva)
      if (investment.type !== 'FIXED_INCOME' || investment.balance <= 0) continue
      const ref = doc(caixinhasCollection(workspaceId))
      caixinha = {
        id: ref.id,
        accountId,
        name: name || investment.name.slice(0, CAIXINHA_NAME_MAX) || DEFAULT_CAIXINHA_NAME,
        balance: 0,
        createdBy,
      }
      batch.set(ref, caixinha)
      caixinhas.push(caixinha)
    }

    const bankBalance = Math.round(investment.balance * 100) / 100
    const diff = Math.round((bankBalance - caixinha.balance) * 100) / 100
    batch.update(doc(caixinhasCollection(workspaceId), caixinha.id), {
      balance: bankBalance,
      bankRef: investment.id,
    })
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
    caixinha.bankRef = investment.id
    aligned++
  }
  await batch.commit()
  return aligned
}
