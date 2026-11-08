import { doc, runTransaction } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { accountDoc } from '../accounts/api'
import { transactionsCollection, transactionDoc, signedEffect } from '../transactions/api'
import { roundToCents } from '../transactions/dateUtils'

export interface PayCardInvoiceParams {
  cardId: string
  cardName: string
  accountId: string
  categoryId: string
  amountPaid: number
  paymentDate: string
  // ids das transações não-pagas do período sendo fechado — calculados pelo
  // caller (que já tem a lista completa via useTransactions em memória).
  // runTransaction do Firestore só aceita transaction.get() em refs já
  // conhecidas, não dá pra rodar uma query nova no meio da transação.
  unpaidTransactionIds: string[]
  nextPeriodStart: string // nextInvoicePeriod(...).start
  createdBy: string
}

export interface PayCardInvoiceResult {
  paymentTransactionId: string
  rolloverTransactionId: string | null
}

// Fecha (total ou parcialmente) a fatura de um cartão. Atômico:
// 1) marca TODAS as não-pagas do período como pagas (mesmo pagando menos
//    que o total — fecha o período por completo);
// 2) debita `amountPaid` do saldo da conta escolhida (mesma mecânica de
//    createTransaction: despesa vinculada a conta, paga);
// 3) cria a transação de pagamento em si;
// 4) se `amountPaid < owed`, cria UMA transação de saldo remanescente,
//    vinculada ao cartão, não-paga, já no próximo período.
// O "ocupado" (soma de não-pagas do cartão, sem filtro de período) cai
// exatamente `amountPaid`: antes = owed (deste período) + outras não-pagas;
// depois = 0 (período fechado) + outras não-pagas + (owed - amountPaid).
export async function payCardInvoice(
  uid: string,
  params: PayCardInvoiceParams,
): Promise<PayCardInvoiceResult> {
  if (params.unpaidTransactionIds.length === 0) {
    throw new Error('Não há valor em aberto para pagar nesta fatura.')
  }
  if (params.amountPaid <= 0) {
    throw new Error('Informe um valor válido para o pagamento.')
  }

  const paymentRef = doc(transactionsCollection(uid))
  const rolloverRef = doc(transactionsCollection(uid))

  const rolloverId = await runTransaction(db, async (transaction) => {
    // --- READS (tudo antes de qualquer write) ---
    const accountSnap = await transaction.get(accountDoc(uid, params.accountId))
    if (!accountSnap.exists()) throw new Error('Conta vinculada não encontrada.')

    const readTxs: { id: string; amount: number; type: 'expense' | 'income' }[] = []
    for (const id of params.unpaidTransactionIds) {
      const snap = await transaction.get(transactionDoc(uid, id))
      if (!snap.exists()) {
        throw new Error('Uma das transações desta fatura não foi encontrada. Atualize a página e tente novamente.')
      }
      const data = snap.data()
      if (data.cardId !== params.cardId) {
        throw new Error('Uma das transações informadas não pertence a este cartão.')
      }
      if (data.paid) {
        throw new Error('Uma das transações desta fatura já estava paga. Atualize a página e tente novamente.')
      }
      readTxs.push({ id, amount: data.amount, type: data.type })
    }

    // receita vinculada ao cartão é um crédito/ajuste — abate o valor
    // devido em vez de somar.
    const owed = roundToCents(
      readTxs.reduce((sum, t) => sum + (t.type === 'expense' ? t.amount : -t.amount), 0),
    )
    if (owed <= 0) throw new Error('Não há valor em aberto para pagar nesta fatura.')
    if (params.amountPaid > owed) throw new Error('O valor pago não pode ser maior que o valor da fatura.')

    // --- WRITES (nenhum get depois daqui) ---
    for (const t of readTxs) {
      transaction.update(transactionDoc(uid, t.id), { paid: true })
    }

    transaction.update(accountDoc(uid, params.accountId), {
      balance: roundToCents(accountSnap.data().balance + signedEffect('expense', params.amountPaid)),
    })

    transaction.set(paymentRef, {
      id: paymentRef.id,
      type: 'expense',
      amount: params.amountPaid,
      date: params.paymentDate,
      description: `Pagamento fatura ${params.cardName}`,
      categoryId: params.categoryId,
      paid: true,
      accountId: params.accountId,
      // guarda quais transações do cartão esta fechou — se esta virar
      // não-paga de novo (edição ou exclusão), elas reabrem junto.
      paidTransactionIds: params.unpaidTransactionIds,
      createdBy: params.createdBy,
    })

    const remaining = roundToCents(owed - params.amountPaid)
    if (remaining > 0) {
      transaction.set(rolloverRef, {
        id: rolloverRef.id,
        type: 'expense',
        amount: remaining,
        date: params.nextPeriodStart,
        description: `Saldo remanescente fatura ${params.cardName}`,
        categoryId: params.categoryId,
        paid: false,
        cardId: params.cardId,
        createdBy: params.createdBy,
      })
      return rolloverRef.id
    }
    return null
  })

  return { paymentTransactionId: paymentRef.id, rolloverTransactionId: rolloverId }
}
