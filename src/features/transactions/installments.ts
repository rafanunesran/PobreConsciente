import { doc, runTransaction } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { accountDoc } from '../accounts/api'
import { transactionsCollection, transactionDoc, signedEffect } from './api'
import { addMonthsClamped, parseDate, formatDate, roundToCents } from './dateUtils'
import type { TransactionFormData, TransactionType } from './types'

export interface InstallmentFormData {
  amount: number
  description: string
  categoryId: string
  date: string
  accountId?: string
  cardId?: string
  tags?: string[]
}

// Cria `installments` documentos mensais a partir de `data.date`. Se
// `amountIsPerInstallment`, cada parcela usa `data.amount` como está; caso
// contrário `data.amount` é o total a dividir — a última parcela absorve o
// resto do arredondamento, pra soma bater exatamente com o valor declarado.
// Mesmo padrão de createRecurringTransaction: runTransaction (a 1ª parcela
// pode nascer paga, precisa mover saldo atomicamente com a criação) e IDs
// determinísticos (`${groupId}_${index}`) — aqui só por consistência com o
// resto do código, já que parcelamento não tem top-up (série finita, gerada
// de uma vez só, sem necessidade de idempotência entre chamadas).
export async function createInstallmentTransaction(
  uid: string,
  data: InstallmentFormData,
  type: TransactionType,
  installments: number,
  amountIsPerInstallment: boolean,
  firstOccurrencePaid: boolean,
  createdBy: string,
): Promise<string> {
  if ((data.accountId !== undefined) === (data.cardId !== undefined)) {
    throw new Error('O lançamento deve estar vinculado a exatamente uma conta ou um cartão.')
  }

  const groupRef = doc(transactionsCollection(uid))
  const groupId = groupRef.id

  const perInstallmentAmount = amountIsPerInstallment ? data.amount : roundToCents(data.amount / installments)
  const lastInstallmentAmount = amountIsPerInstallment
    ? data.amount
    : roundToCents(data.amount - perInstallmentAmount * (installments - 1))

  const { year, month1based, day } = parseDate(data.date)
  const occurrences: (TransactionFormData & {
    installmentGroupId: string
    installmentIndex: number
    installmentTotal: number
  })[] = []

  for (let index = 1; index <= installments; index++) {
    const { year: y, month1based: m, day: d } = addMonthsClamped(year, month1based, day, index - 1)
    const amount = index === installments ? lastInstallmentAmount : perInstallmentAmount
    const base = {
      type,
      amount,
      date: formatDate(y, m, d),
      description: `${data.description} (${index}/${installments})`,
      categoryId: data.categoryId,
      paid: index === 1 ? firstOccurrencePaid : false,
      installmentGroupId: groupId,
      installmentIndex: index,
      installmentTotal: installments,
      ...(data.tags !== undefined && data.tags.length > 0 ? { tags: data.tags } : {}),
    }
    occurrences.push(
      data.accountId !== undefined ? { ...base, accountId: data.accountId } : { ...base, cardId: data.cardId },
    )
  }

  const first = occurrences[0]
  if (first === undefined) throw new Error('Número de parcelas inválido.')

  await runTransaction(db, async (transaction) => {
    const accountSnap =
      data.accountId !== undefined && firstOccurrencePaid
        ? await transaction.get(accountDoc(uid, data.accountId))
        : undefined
    if (accountSnap !== undefined && !accountSnap.exists()) throw new Error('Conta vinculada não encontrada.')

    if (data.accountId !== undefined && firstOccurrencePaid && accountSnap?.exists()) {
      transaction.update(accountDoc(uid, data.accountId), {
        balance: accountSnap.data().balance + signedEffect(type, first.amount),
      })
    }

    for (const occurrence of occurrences) {
      const txId = `${groupId}_${occurrence.installmentIndex}`
      transaction.set(transactionDoc(uid, txId), { id: txId, createdBy, ...occurrence })
    }
  })

  return groupId
}
