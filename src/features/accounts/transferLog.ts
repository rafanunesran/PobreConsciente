import {
  collection,
  doc,
  getDocs,
  writeBatch,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import type { TransactionType } from '../transactions/types'

// Transferência entre contas não vira Transaction (não é receita nem
// despesa — ver accountTransfers.ts), mas a pessoa quer ver no extrato da
// conta quanto saiu/entrou assim no mês. Este log guarda um lado por
// documento: 'expense' = saiu da conta, 'income' = entrou nela. Só pra
// exibição — nunca mexe em saldo nem entra em receitas/despesas.
export interface AccountTransferLog {
  id: string
  accountId: string
  type: TransactionType
  amount: number // sempre positivo; o sentido vem de `type`
  date: string // 'YYYY-MM-DD'
  description: string
  createdBy: string
}

const DESCRIPTION_MAX = 60

const transferLogConverter: FirestoreDataConverter<AccountTransferLog> = {
  toFirestore: (log) => ({
    accountId: log.accountId,
    type: log.type,
    amount: log.amount,
    date: log.date,
    description: log.description,
    createdBy: log.createdBy,
  }),
  fromFirestore: (snapshot: QueryDocumentSnapshot) => {
    const data = snapshot.data()
    return {
      id: snapshot.id,
      accountId: typeof data.accountId === 'string' ? data.accountId : '',
      type: data.type === 'income' ? 'income' : 'expense',
      amount: typeof data.amount === 'number' ? data.amount : 0,
      date: typeof data.date === 'string' ? data.date : '',
      description: typeof data.description === 'string' ? data.description : '',
      createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    }
  },
}

export function transferLogsCollection(uid: string) {
  return collection(db, 'users', uid, 'accountTransfers').withConverter(transferLogConverter)
}

// Grava (ou regrava, pelo id) cada lado — o id do lançamento do banco
// torna a gravação da sincronização idempotente.
export async function saveTransferLogs(uid: string, logs: AccountTransferLog[]): Promise<void> {
  const BATCH_LIMIT = 450
  for (let i = 0; i < logs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const log of logs.slice(i, i + BATCH_LIMIT))
      batch.set(doc(transferLogsCollection(uid), log.id), {
        ...log,
        description: log.description.slice(0, DESCRIPTION_MAX),
      })
    await batch.commit()
  }
}

export async function listTransferLogIds(uid: string): Promise<Set<string>> {
  const snapshot = await getDocs(transferLogsCollection(uid))
  return new Set(snapshot.docs.map((d) => d.id))
}

export function newTransferLogId(uid: string): string {
  return doc(transferLogsCollection(uid)).id
}
