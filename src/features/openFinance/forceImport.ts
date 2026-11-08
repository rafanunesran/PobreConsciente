import { doc, getDocs, increment, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { accountDoc } from '../accounts/api'
import { transferLogsCollection } from '../accounts/transferLog'
import { caixinhaDoc } from '../caixinhas/api'
import { movementBaseId } from '../caixinhas/merge'
import { caixinhaMovementDoc, caixinhaMovementsCollection } from '../caixinhas/movements'
import { categoriesCollection } from '../categories/api'
import { buildCategorySuggester } from '../imports/categorize'
import { signedEffect, transactionDoc, transactionsCollection } from '../transactions/api'
import { roundToCents } from '../transactions/dateUtils'
import type { Transaction } from '../transactions/types'
import { ACCOUNT_WINDOW_DAYS, dayDistance, isManualCandidate } from './matching'
import { BANK_SYNC_TAG, type BankEntry, forcedTransactionId } from './sync'

export type ForceImportResult =
  | { kind: 'created' }
  | { kind: 'linked'; transaction: Transaction } // usou o que a pessoa já tinha lançado à mão

// Lança no app um lançamento do banco que a sincronização deixou de fora
// (achou que era transferência, caixinha, Pix no crédito, ou caiu fora da
// janela de datas). Pelo diagnóstico, a pessoa diz "isso é receita/despesa".
//
// O saldo da conta já é o do banco, que já contou esse dinheiro — então
// nada aqui soma no saldo. Se a pessoa já tinha lançado à mão (mesmo
// valor e sentido, até 10 dias de diferença), esse lançamento passa a ser
// o do banco e o efeito dele no saldo sai — era ele que deixava o saldo
// errado.
//
// O que a sincronização tinha feito com ele também é desfeito: sai do log
// de transferências e, se tinha ido pra uma caixinha, o movimento sai e o
// saldo da caixinha volta. Daqui pra frente a sincronização não mexe mais
// nele (o bankRef marca que o app já o representa).
export async function forceImportBankEntry(params: {
  workspaceId: string
  accountId: string
  entry: BankEntry
  createdBy: string
}): Promise<ForceImportResult> {
  const { workspaceId, accountId, entry, createdBy } = params
  const [transactionsSnap, categoriesSnap, movementsSnap] = await Promise.all([
    getDocs(transactionsCollection(workspaceId)),
    getDocs(categoriesCollection(workspaceId)),
    getDocs(caixinhaMovementsCollection(workspaceId)),
  ])
  const transactions = transactionsSnap.docs.map((d) => d.data())

  const batch = writeBatch(db)
  let result: ForceImportResult

  const manual = transactions
    .filter(
      (t) =>
        isManualCandidate(t) &&
        t.accountId === accountId &&
        t.type === entry.type &&
        Math.abs(t.amount - entry.amount) < 0.005 &&
        dayDistance(t.date, entry.date) <= ACCOUNT_WINDOW_DAYS,
    )
    .sort((a, b) => dayDistance(a.date, entry.date) - dayDistance(b.date, entry.date))[0]

  if (manual) {
    batch.update(transactionDoc(workspaceId, manual.id), {
      bankRef: entry.docId,
      ...(manual.paid ? {} : { paid: true }),
    })
    if (manual.paid) {
      batch.update(accountDoc(workspaceId, accountId), {
        balance: increment(roundToCents(-signedEffect(manual.type, manual.amount))),
      })
    }
    result = { kind: 'linked', transaction: manual }
  } else {
    const categories = categoriesSnap.docs.map((d) => d.data())
    const categoryId =
      buildCategorySuggester(transactions)(entry.description, entry.type) ??
      categories.find((c) => c.type === entry.type)?.id
    if (!categoryId) throw new Error('Crie uma categoria de ' + (entry.type === 'income' ? 'receita' : 'despesa') + ' antes.')
    const id = forcedTransactionId(entry.docId)
    batch.set(doc(transactionsCollection(workspaceId), id), {
      id,
      type: entry.type,
      amount: entry.amount,
      date: entry.date,
      description: entry.description,
      categoryId,
      paid: true,
      accountId,
      bankRef: entry.docId,
      tags: [BANK_SYNC_TAG],
      categorySource: 'auto',
      createdBy,
    })
    result = { kind: 'created' }
  }

  // desfaz o que a sincronização tinha feito com ele
  batch.delete(doc(transferLogsCollection(workspaceId), entry.docId))
  for (const d of movementsSnap.docs) {
    if (movementBaseId(d.id) !== `bank_${entry.docId}`) continue
    const movement = d.data()
    batch.delete(caixinhaMovementDoc(workspaceId, d.id))
    batch.update(caixinhaDoc(workspaceId, movement.caixinhaId), {
      balance: increment(roundToCents(-movement.amount)),
    })
  }

  await batch.commit()
  return result
}
