import { runTransaction } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { accountDoc } from './api'
import { todayDateString } from '../cards/invoiceUtils'
import { newTransferLogId, saveTransferLogs } from './transferLog'

// Transferência entre contas do próprio usuário — não é receita nem
// despesa, então nunca cria Transaction, só move saldo atomicamente. (Já
// guardar/resgatar de caixinha cria Transaction vinculada — ali o dinheiro
// sai/entra do "mundo visível" da conta de verdade; aqui ele só troca de
// conta, então nenhum lado do extrato deveria mostrar nada.) Fica só no
// log de transferências (transferLog.ts), que aparece na divisão por
// categoria do extrato como "Transferências".
export async function transferBetweenAccounts(
  uid: string,
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  createdBy: string,
): Promise<void> {
  const names = await runTransaction(db, async (transaction) => {
    const fromSnap = await transaction.get(accountDoc(uid, fromAccountId))
    const toSnap = await transaction.get(accountDoc(uid, toAccountId))
    if (!fromSnap.exists()) throw new Error('Conta de origem não encontrada.')
    if (!toSnap.exists()) throw new Error('Conta de destino não encontrada.')
    if (fromSnap.data().balance < amount) throw new Error('Saldo insuficiente na conta de origem.')
    transaction.update(accountDoc(uid, fromAccountId), { balance: fromSnap.data().balance - amount })
    transaction.update(accountDoc(uid, toAccountId), { balance: toSnap.data().balance + amount })
    return { from: fromSnap.data().name, to: toSnap.data().name }
  })
  // Fora da transação e sem falhar a transferência: o saldo já mudou, o
  // log é só pra visualização (e falha se as regras ainda não têm a coleção).
  const date = todayDateString()
  await saveTransferLogs(uid, [
    { id: newTransferLogId(uid), accountId: fromAccountId, type: 'expense', amount, date, description: `Transferência para ${names.to}`, createdBy },
    { id: newTransferLogId(uid), accountId: toAccountId, type: 'income', amount, date, description: `Transferência de ${names.from}`, createdBy },
  ]).catch(() => undefined)
}
