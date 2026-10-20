import { doc, runTransaction } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { accountDoc } from '../accounts/api'
import { createTransaction } from '../transactions/api'
import { todayDateString } from '../cards/invoiceUtils'
import { caixinhaDoc } from './api'
import { caixinhaMovementsCollection } from './movements'
import type { CaixinhaMovementType } from './types'

// Guardar e resgatar são reserva, não gasto nem receita: o dinheiro só
// muda de lugar (conta ↔ caixinha), como uma transferência entre contas
// (accounts/accountTransfers.ts) — por isso não criam Transaction e não
// entram nos totais do mês. Ficam registrados só no histórico da caixinha
// (caixinhaMovements). A conexão bancária segue a mesma regra
// (openFinance/caixinhaSync.ts).
//
// Guardar: tira da conta, põe na caixinha. `movementType` default
// 'guardar', mas registerCaixinhaYield reaproveita esta mesma
// transferência com 'rendimento' pra rotular certo no histórico.
export async function depositToCaixinha(
  uid: string,
  accountId: string,
  caixinhaId: string,
  amount: number,
  createdBy: string,
  movementType: CaixinhaMovementType = 'guardar',
): Promise<void> {
  const movementRef = doc(caixinhaMovementsCollection(uid))
  await runTransaction(db, async (transaction) => {
    const accountSnap = await transaction.get(accountDoc(uid, accountId))
    const caixinhaSnap = await transaction.get(caixinhaDoc(uid, caixinhaId))
    if (!accountSnap.exists()) throw new Error('Conta não encontrada.')
    if (!caixinhaSnap.exists()) throw new Error('Caixinha não encontrada.')
    transaction.update(accountDoc(uid, accountId), { balance: accountSnap.data().balance - amount })
    transaction.update(caixinhaDoc(uid, caixinhaId), { balance: caixinhaSnap.data().balance + amount })
    transaction.set(movementRef, {
      id: movementRef.id,
      caixinhaId,
      type: movementType,
      amount,
      date: todayDateString(),
      createdBy,
    })
  })
}

// Resgatar: tira da caixinha, devolve pra conta. Mesma lógica de saldo,
// valida saldo suficiente na caixinha antes de escrever.
export async function withdrawFromCaixinha(
  uid: string,
  accountId: string,
  caixinhaId: string,
  amount: number,
  createdBy: string,
): Promise<void> {
  const movementRef = doc(caixinhaMovementsCollection(uid))
  await runTransaction(db, async (transaction) => {
    const accountSnap = await transaction.get(accountDoc(uid, accountId))
    const caixinhaSnap = await transaction.get(caixinhaDoc(uid, caixinhaId))
    if (!accountSnap.exists()) throw new Error('Conta não encontrada.')
    if (!caixinhaSnap.exists()) throw new Error('Caixinha não encontrada.')
    if (caixinhaSnap.data().balance < amount) throw new Error('Saldo insuficiente na caixinha.')
    transaction.update(accountDoc(uid, accountId), { balance: accountSnap.data().balance + amount })
    transaction.update(caixinhaDoc(uid, caixinhaId), { balance: caixinhaSnap.data().balance - amount })
    transaction.set(movementRef, {
      id: movementRef.id,
      caixinhaId,
      type: 'resgatar',
      amount: -amount,
      date: todayDateString(),
      createdBy,
    })
  })
}

// Encerrar: devolve o saldo (se houver) pra conta e apaga a caixinha,
// atomicamente — nunca perde dinheiro no fechamento (mesmo comportamento
// de "Encerrar caixinha" do Nubank). Não registra movimento — a caixinha
// deixa de existir, não há mais extrato pra ver.
export async function closeCaixinha(uid: string, accountId: string, caixinhaId: string): Promise<void> {
  await runTransaction(db, async (transaction) => {
    const accountSnap = await transaction.get(accountDoc(uid, accountId))
    const caixinhaSnap = await transaction.get(caixinhaDoc(uid, caixinhaId))
    if (!accountSnap.exists()) throw new Error('Conta não encontrada.')
    if (!caixinhaSnap.exists()) throw new Error('Caixinha não encontrada.')
    const remaining = caixinhaSnap.data().balance
    if (remaining > 0) {
      transaction.update(accountDoc(uid, accountId), { balance: accountSnap.data().balance + remaining })
    }
    transaction.delete(caixinhaDoc(uid, caixinhaId))
  })
}

// Rendimento: dinheiro genuinamente novo (diferente de guardar/resgatar,
// que são só transferência). O valor nunca passa pela conta de verdade —
// fica todo dentro da caixinha — mas ainda precisa virar receita real no
// extrato. Registra a receita normalmente (comporta-se como qualquer
// receita comum se o usuário editar/excluir depois) e em seguida
// transfere o mesmo valor da conta pra caixinha: o efeito líquido no
// saldo da conta é zero (+receita, −transferência), a caixinha ganha o
// valor.
export async function registerCaixinhaYield(
  uid: string,
  accountId: string,
  caixinhaId: string,
  caixinhaName: string,
  amount: number,
  categoryId: string,
  createdBy: string,
): Promise<void> {
  await createTransaction(
    uid,
    {
      type: 'income',
      amount,
      date: todayDateString(),
      description: `Rendimento — ${caixinhaName}`,
      categoryId,
      paid: true,
      accountId,
    },
    createdBy,
  )
  await depositToCaixinha(uid, accountId, caixinhaId, amount, createdBy, 'rendimento')
}
