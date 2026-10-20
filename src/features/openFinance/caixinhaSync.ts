import { doc, getDocs, increment, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { caixinhasCollection } from '../caixinhas/api'
import { caixinhaMovementsCollection } from '../caixinhas/movements'
import type { Caixinha } from '../caixinhas/types'
import { transactionDoc } from '../transactions/api'
import type { Transaction } from '../transactions/types'
import { sharesWord } from './matching'
import { parseReserveMovement, type ReserveMovement } from './reserveParsing'

// Mesmo limite de operações por writeBatch de imports/api.ts.
const BATCH_LIMIT = 500
const DESCRIPTION_MAX = 60 // mesmo teto do form de lançamento
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

// Como o app descreve guardar/resgatar (caixinhaTransfers.ts) — o
// lançamento do banco passa a aparecer igual no extrato.
function appDescription(kind: ReserveMovement['kind'], caixinhaName: string): string {
  return `${kind === 'guardar' ? 'Guardado' : 'Resgatado'} — ${caixinhaName}`.slice(0, DESCRIPTION_MAX)
}

// O movimento da caixinha tem id derivado do lançamento importado — é o
// que marca "já aplicado", então rodar de novo (ou rodar sobre lançamentos
// importados antes desta função existir) nunca soma duas vezes.
function movementIdFor(transactionId: string): string {
  return `bank_${transactionId}`
}

// O lançamento importado ("Dinheiro reservado X", despesa na conta) já é
// o mesmo que o app cria ao "Guardar" numa caixinha — e já mexeu no saldo
// da conta. Falta o lado da caixinha (saldo + histórico) e deixar claro no
// extrato que foi caixinha ("Guardado — X"). Caixinha que ainda não existe
// no app é criada na conta do lançamento.
export async function applyBankReserveMovements(
  workspaceId: string,
  transactions: Transaction[],
  createdBy: string,
): Promise<number> {
  const candidates = transactions
    .filter((t) => t.id.startsWith('pluggy_') && t.accountId !== undefined)
    .map((t) => ({ transaction: t, movement: parseReserveMovement(t) }))
    .filter((c): c is { transaction: Transaction; movement: ReserveMovement } => c.movement !== null)
  if (candidates.length === 0) return 0

  const [caixinhasSnap, movementsSnap] = await Promise.all([
    getDocs(caixinhasCollection(workspaceId)),
    getDocs(caixinhaMovementsCollection(workspaceId)),
  ])
  const caixinhas = caixinhasSnap.docs.map((d) => d.data())
  const movementsById = new Map(movementsSnap.docs.map((d) => [d.id, d.data()]))

  // Cada lançamento são até 4 operações (caixinha nova, saldo, histórico,
  // descrição).
  const chunkSize = Math.floor(BATCH_LIMIT / 4)
  let applied = 0
  for (let start = 0; start < candidates.length; start += chunkSize) {
    const batch = writeBatch(db)
    let writes = 0
    for (const { transaction, movement } of candidates.slice(start, start + chunkSize)) {
      const accountId = transaction.accountId as string
      const existingMovement = movementsById.get(movementIdFor(transaction.id))

      // Já aplicado antes: só garante a descrição no formato do app.
      let caixinha = existingMovement
        ? caixinhas.find((c) => c.id === existingMovement.caixinhaId)
        : undefined
      if (!existingMovement) {
        const found = findCaixinha(caixinhas, accountId, movement.name)
        caixinha = found.caixinha
        if (!caixinha) {
          const ref = doc(caixinhasCollection(workspaceId))
          caixinha = { id: ref.id, accountId, name: found.nameToCreate, balance: 0, createdBy }
          batch.set(ref, caixinha)
          caixinhas.push(caixinha)
        }

        const signed = movement.kind === 'guardar' ? transaction.amount : -transaction.amount
        batch.update(doc(caixinhasCollection(workspaceId), caixinha.id), { balance: increment(signed) })
        caixinha.balance += signed
        const movementRef = doc(caixinhaMovementsCollection(workspaceId), movementIdFor(transaction.id))
        batch.set(movementRef, {
          id: movementRef.id,
          caixinhaId: caixinha.id,
          type: movement.kind,
          amount: signed,
          date: transaction.date,
          createdBy,
        })
        applied++
        writes++
      }

      if (caixinha) {
        const description = appDescription(movement.kind, caixinha.name)
        if (transaction.description !== description) {
          batch.update(transactionDoc(workspaceId, transaction.id), { description })
          transaction.description = description
          writes++
        }
      }
    }
    if (writes > 0) await batch.commit()
  }
  return applied
}
