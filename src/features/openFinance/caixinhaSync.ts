import { doc, getDocs, increment, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { caixinhasCollection } from '../caixinhas/api'
import { caixinhaMovementsCollection } from '../caixinhas/movements'
import type { Caixinha } from '../caixinhas/types'
import type { Transaction } from '../transactions/types'

// Mesmo limite de operações por writeBatch de imports/api.ts.
const BATCH_LIMIT = 500
const CAIXINHA_NAME_MAX = 40 // mesmo teto das regras do Firestore

// Mercado Pago descreve as movimentações das "reservas" assim:
// "Dinheiro reservado <nome>" (guardar) e "Dinheiro retirado <nome>"
// (resgatar). O nome da reserva vira o nome da caixinha.
const RESERVE_PATTERN = /^dinheiro\s+(reservado|retirado|resgatado)\s+(.+)$/i

export interface ReserveMovement {
  kind: 'guardar' | 'resgatar'
  name: string
}

export function parseReserveMovement(transaction: Pick<Transaction, 'description' | 'type'>): ReserveMovement | null {
  const [, verb, rawName] = RESERVE_PATTERN.exec(transaction.description.trim()) ?? []
  if (!verb || !rawName) return null
  const kind = verb.toLowerCase() === 'reservado' ? 'guardar' : 'resgatar'
  // guardar sai da conta (despesa), resgatar volta pra ela (receita) — se
  // o sinal não bate, não é a movimentação que o padrão sugere.
  if ((kind === 'guardar') !== (transaction.type === 'expense')) return null
  return { kind, name: rawName.replace(/\s+/g, ' ').trim().slice(0, CAIXINHA_NAME_MAX) }
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Igual, ou um é começo do outro — a descrição do banco às vezes corta o
// nome da reserva ("Camisetas Ran" pra uma caixinha "Camisetas Rafa...").
function findCaixinha(caixinhas: Caixinha[], accountId: string, name: string): Caixinha | undefined {
  const wanted = normalizeName(name)
  const sameAccount = caixinhas.filter((c) => c.accountId === accountId)
  return (
    sameAccount.find((c) => normalizeName(c.name) === wanted) ??
    sameAccount.find((c) => {
      const existing = normalizeName(c.name)
      return existing.length >= 3 && (existing.startsWith(wanted) || wanted.startsWith(existing))
    })
  )
}

// O movimento da caixinha tem id derivado do lançamento importado — é o
// que marca "já aplicado", então rodar de novo (ou rodar sobre lançamentos
// importados antes desta função existir) nunca soma duas vezes.
function movementIdFor(transactionId: string): string {
  return `bank_${transactionId}`
}

// O lançamento importado ("Dinheiro reservado X", despesa na conta) já é
// o mesmo que o app cria ao "Guardar" numa caixinha — e já mexeu no saldo
// da conta. Falta só o lado da caixinha: saldo + histórico. Caixinha que
// ainda não existe no app é criada na conta do lançamento.
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
  const appliedIds = new Set(movementsSnap.docs.map((d) => d.id))
  const pending = candidates.filter((c) => !appliedIds.has(movementIdFor(c.transaction.id)))
  if (pending.length === 0) return 0

  // Cada movimento são até 3 operações (caixinha nova, saldo, histórico).
  const chunkSize = Math.floor(BATCH_LIMIT / 3)
  for (let start = 0; start < pending.length; start += chunkSize) {
    const batch = writeBatch(db)
    for (const { transaction, movement } of pending.slice(start, start + chunkSize)) {
      const accountId = transaction.accountId as string
      let caixinha = findCaixinha(caixinhas, accountId, movement.name)
      if (!caixinha) {
        const ref = doc(caixinhasCollection(workspaceId))
        caixinha = { id: ref.id, accountId, name: movement.name, balance: 0, createdBy }
        batch.set(ref, caixinha)
        caixinhas.push(caixinha)
      }

      const signed = movement.kind === 'guardar' ? transaction.amount : -transaction.amount
      batch.update(doc(caixinhasCollection(workspaceId), caixinha.id), { balance: increment(signed) })
      const movementRef = doc(caixinhaMovementsCollection(workspaceId), movementIdFor(transaction.id))
      batch.set(movementRef, {
        id: movementRef.id,
        caixinhaId: caixinha.id,
        type: movement.kind,
        amount: signed,
        date: transaction.date,
        createdBy,
      })
    }
    await batch.commit()
  }
  return pending.length
}
