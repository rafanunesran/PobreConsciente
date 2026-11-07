import { doc, getDocs, increment, query, where, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { caixinhaDoc } from './api'
import { caixinhaMovementDoc, caixinhaMovementsCollection } from './movements'
import { caixinhaRulesCollection } from './rules'
import type { Caixinha, CaixinhaMovement } from './types'

// Mesmo limite de operações por writeBatch de imports/api.ts.
const BATCH_LIMIT = 500

// O histórico da caixinha é só de criação (firestore.rules não deixa
// alterar um movimento), então pra levar um movimento pra outra caixinha
// ele é apagado e regravado com um id novo: `<id original>~<sufixo>`. O
// pedaço antes do "~" continua sendo o que diz "esse lançamento do banco
// já foi aplicado" (bank_<id> — ver openFinance/caixinhaSync.ts).
const MOVED_SEPARATOR = '~'

export function movementBaseId(id: string): string {
  const at = id.indexOf(MOVED_SEPARATOR)
  return at < 0 ? id : id.slice(0, at)
}

// Junta `sources` em `target`: o saldo delas soma no da que fica, o
// histórico e as regras "esta movimentação é a caixinha X" passam pra ela
// e as outras deixam de existir. Nada sai nem entra na conta — o dinheiro
// continua todo guardado, só numa caixinha só.
// `movements` (opcional) evita reler o histórico quando quem chama já tem.
export async function mergeCaixinhas(
  workspaceId: string,
  target: Caixinha,
  sources: Caixinha[],
  movements?: CaixinhaMovement[],
): Promise<void> {
  const others = sources.filter((s) => s.id !== target.id && s.accountId === target.accountId)
  if (others.length === 0) return
  const sourceIds = new Set(others.map((s) => s.id))
  const all = movements ?? (await getDocs(caixinhaMovementsCollection(workspaceId))).docs.map((d) => d.data())
  const toMove = all.filter((m) => sourceIds.has(m.caixinhaId))

  // 1. histórico (2 operações por movimento)
  const perBatch = Math.floor(BATCH_LIMIT / 2)
  for (let start = 0; start < toMove.length; start += perBatch) {
    const batch = writeBatch(db)
    for (const movement of toMove.slice(start, start + perBatch)) {
      const suffix = doc(caixinhaMovementsCollection(workspaceId)).id
      const id = `${movementBaseId(movement.id)}${MOVED_SEPARATOR}${suffix}`
      batch.delete(caixinhaMovementDoc(workspaceId, movement.id))
      batch.set(caixinhaMovementDoc(workspaceId, id), { ...movement, id, caixinhaId: target.id })
      movement.id = id
      movement.caixinhaId = target.id
    }
    await batch.commit()
  }

  // 2. regras de marcação que apontavam pras que somem
  const rules = (
    await Promise.all(
      others.map((s) =>
        getDocs(query(caixinhaRulesCollection(workspaceId), where('caixinhaId', '==', s.id))).catch(() => null),
      ),
    )
  ).flatMap((snap) => (snap ? snap.docs : []))
  for (let start = 0; start < rules.length; start += BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const rule of rules.slice(start, start + BATCH_LIMIT)) batch.update(rule.ref, { caixinhaId: target.id })
    await batch.commit()
  }

  // 3. saldo e as caixinhas que somem (por último: se algo acima falhar,
  // juntar de novo termina o serviço sem somar nada duas vezes)
  const moved = Math.round(others.reduce((sum, s) => sum + s.balance, 0) * 100) / 100
  const bankRef = target.bankRef ?? others.find((s) => s.bankRef !== undefined)?.bankRef
  for (let start = 0; start < others.length; start += BATCH_LIMIT - 1) {
    const batch = writeBatch(db)
    if (start === 0) {
      batch.update(caixinhaDoc(workspaceId, target.id), {
        balance: increment(moved),
        ...(bankRef !== undefined ? { bankRef } : {}),
      })
    }
    for (const s of others.slice(start, start + BATCH_LIMIT - 1)) batch.delete(caixinhaDoc(workspaceId, s.id))
    await batch.commit()
  }
  target.balance = Math.round((target.balance + moved) * 100) / 100
  if (bankRef !== undefined) target.bankRef = bankRef
}
