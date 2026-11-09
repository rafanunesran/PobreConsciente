import { doc, getDocs, increment, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { accountDoc } from '../accounts/api'
import { saveTransferLogs } from '../accounts/transferLog'
import { saveCaixinhaRule } from '../caixinhas/rules'
import { cardsCollection } from '../cards/api'
import { signedEffect, transactionsCollection } from '../transactions/api'
import { roundToCents } from '../transactions/dateUtils'
import type { Transaction } from '../transactions/types'
import type { BankHistoryRow } from './bankHistory'
import { applyBankReserves } from './caixinhaSync'
import { autoPayCardBill, linkManualToBank } from './reconcile'
import { BANK_SYNC_TAG, forcedTransactionId } from './sync'

// O que a pessoa faz com uma movimentação do Histórico do banco. O saldo
// da conta é o do app (o banco não sobrescreve mais): cada ação mexe no
// saldo como o lançamento equivalente feito à mão — exceto o que ainda
// está pendente no banco, que entra como pendente.

function bankSide(row: BankHistoryRow) {
  return { key: row.docId, date: row.date, type: row.type, amount: row.amount, description: row.description }
}

// Receita/despesa nova na conta, ligada à movimentação do banco.
export async function registerHistoryTransaction(params: {
  workspaceId: string
  row: BankHistoryRow
  categoryId: string
  description: string
  createdBy: string
}): Promise<void> {
  const { workspaceId, row, categoryId, createdBy } = params
  const id = forcedTransactionId(row.docId)
  const paid = !row.pending
  const batch = writeBatch(db)
  batch.set(doc(transactionsCollection(workspaceId), id), {
    id,
    type: row.type,
    amount: row.amount,
    date: row.date,
    description: params.description.trim().slice(0, 60) || row.description,
    categoryId,
    paid,
    accountId: row.accountId,
    bankRef: row.docId,
    tags: [BANK_SYNC_TAG],
    categorySource: 'manual',
    createdBy,
  })
  if (paid) {
    batch.update(accountDoc(workspaceId, row.accountId), {
      balance: increment(roundToCents(signedEffect(row.type, row.amount))),
    })
  }
  await batch.commit()
}

// "É este lançamento que eu já fiz": o do app passa a ser o do banco
// (data e valor do banco, pago) — mesma conciliação de antes, agora a pedido.
export async function linkHistoryToTransaction(
  workspaceId: string,
  row: BankHistoryRow,
  manual: Transaction,
): Promise<void> {
  await linkManualToBank(workspaceId, [{ bank: bankSide(row), manual }], row.accountId)
}

// Transferência: não é receita nem despesa. Move o saldo (desta conta e,
// se informada, da outra conta do app) e fica no log de transferências.
export async function registerHistoryTransfer(params: {
  workspaceId: string
  row: BankHistoryRow
  otherAccountId?: string
  otherAccountName?: string
  thisAccountName: string
  createdBy: string
}): Promise<void> {
  const { workspaceId, row, otherAccountId, createdBy } = params
  const signed = roundToCents(signedEffect(row.type, row.amount))
  const batch = writeBatch(db)
  if (!row.pending) {
    batch.update(accountDoc(workspaceId, row.accountId), { balance: increment(signed) })
    if (otherAccountId) batch.update(accountDoc(workspaceId, otherAccountId), { balance: increment(-signed) })
  }
  await batch.commit()
  await saveTransferLogs(workspaceId, [
    {
      id: row.docId,
      accountId: row.accountId,
      type: row.type,
      amount: row.amount,
      date: row.date,
      description: row.description,
      createdBy,
    },
    ...(otherAccountId
      ? [
          {
            // o outro lado no banco, se a outra conta também está conectada —
            // assim ele também aparece como já lançado no histórico
            id: row.transferPairDocId ?? `${row.docId}_par`,
            accountId: otherAccountId,
            type: row.type === 'expense' ? ('income' as const) : ('expense' as const),
            amount: row.amount,
            date: row.date,
            description:
              row.type === 'expense'
                ? `Transferência de ${params.thisAccountName}`
                : `Transferência para ${params.thisAccountName}`,
            createdBy,
          },
        ]
      : []),
  ])
}

// Guardar (saída) ou resgatar (entrada) de uma caixinha da conta. Se a
// pessoa já tinha guardado esse valor pelo app, o movimento dela passa a
// ser este (sem mexer em saldo de novo). Lembra a escolha pra próxima
// movimentação igual.
export async function registerHistoryCaixinha(params: {
  workspaceId: string
  row: BankHistoryRow
  caixinhaId?: string
  newCaixinhaName?: string
  createdBy: string
}): Promise<void> {
  const { workspaceId, row, caixinhaId, createdBy } = params
  await applyBankReserves(
    workspaceId,
    [
      {
        key: row.docId,
        accountId: row.accountId,
        date: row.date,
        amount: row.amount,
        movement: {
          kind: row.type === 'expense' ? 'guardar' : 'resgatar',
          ...(caixinhaId ? { caixinhaId } : { name: params.newCaixinhaName?.trim() || 'Reserva' }),
        },
        ...(row.pending ? { historyOnly: true } : {}),
      },
    ],
    createdBy,
  )
  if (caixinhaId) await saveCaixinhaRule(workspaceId, row.accountId, row, caixinhaId, createdBy).catch(() => undefined)
}

// Pagamento de fatura: paga a fatura fechada de cartão cujo valor em
// aberto é exatamente esse. false = não achou uma só fatura com esse valor.
export async function payBillFromHistory(params: {
  workspaceId: string
  row: BankHistoryRow
  categoryId: string
  createdBy: string
}): Promise<boolean> {
  const { workspaceId, row } = params
  const [cardsSnap, transactionsSnap] = await Promise.all([
    getDocs(cardsCollection(workspaceId)),
    getDocs(transactionsCollection(workspaceId)),
  ])
  return autoPayCardBill({
    workspaceId,
    bank: bankSide(row),
    accountId: row.accountId,
    cards: cardsSnap.docs.map((d) => d.data()),
    transactions: transactionsSnap.docs.map((d) => d.data()),
    categoryId: params.categoryId,
    createdBy: params.createdBy,
  })
}
