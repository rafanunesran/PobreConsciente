import { doc, getDocs, writeBatch, type DocumentReference } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { transferLogsCollection } from '../accounts/transferLog'
import { caixinhaMovementDoc, caixinhaMovementsCollection } from '../caixinhas/movements'
import { transactionDoc, transactionsCollection } from '../transactions/api'
import type { Transaction } from '../transactions/types'

// Mesmo limite de operações por writeBatch de imports/api.ts.
const BATCH_LIMIT = 450

// "Limpar o que veio do banco nas contas": desde que a conta corrente
// passou a ir pelo Histórico do banco, os lançamentos que a sincronização
// antiga trouxe pras contas sobram. Apaga só o que veio do banco na conta
// corrente:
// - lançamentos de conta importados (`pluggy_…`) ou lançados pelo
//   diagnóstico/histórico (`banco_…`);
// - transferências registradas a partir do banco (log `pluggy_…`);
// - movimentos de caixinha vindos do banco (`bank_…`).
// Fica: tudo dos cartões, pagamento de fatura (está ligado às compras do
// cartão), lançamento feito à mão (mesmo que conciliado com o banco),
// transferência e caixinha feitas pelo app. Nenhum saldo muda — o saldo
// das contas e das caixinhas fica como está.
export interface AccountHistoryCleanup {
  transactions: Transaction[]
  transferIds: string[]
  movementIds: string[]
}

function isBankAccountTransaction(t: Transaction): boolean {
  return (
    t.accountId !== undefined &&
    t.cardId === undefined &&
    (t.id.startsWith('pluggy_') || t.id.startsWith('banco_')) &&
    (t.paidTransactionIds === undefined || t.paidTransactionIds.length === 0)
  )
}

export async function previewAccountHistoryCleanup(workspaceId: string): Promise<AccountHistoryCleanup> {
  const [transactionsSnap, transfersSnap, movementsSnap] = await Promise.all([
    getDocs(transactionsCollection(workspaceId)),
    getDocs(transferLogsCollection(workspaceId)).catch(() => null),
    getDocs(caixinhaMovementsCollection(workspaceId)).catch(() => null),
  ])
  return {
    transactions: transactionsSnap.docs.map((d) => d.data()).filter(isBankAccountTransaction),
    transferIds: (transfersSnap?.docs ?? []).map((d) => d.id).filter((id) => id.startsWith('pluggy_')),
    movementIds: (movementsSnap?.docs ?? []).map((d) => d.id).filter((id) => id.startsWith('bank_')),
  }
}

export async function clearAccountHistory(workspaceId: string, plan: AccountHistoryCleanup): Promise<void> {
  const refs: DocumentReference[] = [
    ...plan.transactions.map((t) => transactionDoc(workspaceId, t.id)),
    ...plan.transferIds.map((id) => doc(transferLogsCollection(workspaceId), id)),
    ...plan.movementIds.map((id) => caixinhaMovementDoc(workspaceId, id)),
  ]
  for (let start = 0; start < refs.length; start += BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const ref of refs.slice(start, start + BATCH_LIMIT)) batch.delete(ref)
    await batch.commit()
  }
}
