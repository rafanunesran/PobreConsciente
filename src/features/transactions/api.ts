import {
  collection,
  doc,
  getDoc,
  runTransaction,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { accountDoc } from '../accounts/api'
import { TRANSACTION_TYPES, type Transaction, type TransactionFormData, type TransactionType } from './types'

// NOTE: mesmo padrão de narrowing campo a campo de accounts/api.ts e
// cards/api.ts (sem `as unknown as X`).
const transactionConverter: FirestoreDataConverter<Transaction> = {
  toFirestore: (t) => {
    const base = {
      type: t.type,
      amount: t.amount,
      date: t.date,
      description: t.description,
      categoryId: t.categoryId,
      paid: t.paid,
      createdBy: t.createdBy,
      ...(t.recurringRuleId !== undefined ? { recurringRuleId: t.recurringRuleId } : {}),
      ...(t.installmentGroupId !== undefined
        ? {
            installmentGroupId: t.installmentGroupId,
            installmentIndex: t.installmentIndex,
            installmentTotal: t.installmentTotal,
          }
        : {}),
      ...(t.paidTransactionIds !== undefined ? { paidTransactionIds: t.paidTransactionIds } : {}),
      ...(t.bankRef !== undefined ? { bankRef: t.bankRef } : {}),
      ...(Array.isArray(t.tags) && t.tags.length > 0 ? { tags: t.tags } : {}),
    }
    return t.accountId !== undefined ? { ...base, accountId: t.accountId } : { ...base, cardId: t.cardId }
  },
  fromFirestore: (snapshot: QueryDocumentSnapshot) => {
    const data = snapshot.data()
    const type: TransactionType = TRANSACTION_TYPES.includes(data.type) ? data.type : 'expense'
    const accountId = typeof data.accountId === 'string' ? data.accountId : undefined
    const cardId = typeof data.cardId === 'string' ? data.cardId : undefined
    const recurringRuleId = typeof data.recurringRuleId === 'string' ? data.recurringRuleId : undefined
    const installmentGroupId =
      typeof data.installmentGroupId === 'string' ? data.installmentGroupId : undefined
    const paidTransactionIds = Array.isArray(data.paidTransactionIds)
      ? data.paidTransactionIds.filter((id): id is string => typeof id === 'string')
      : undefined
    const tags = Array.isArray(data.tags)
      ? data.tags.filter((tag): tag is string => typeof tag === 'string' && tag !== '')
      : []
    return {
      id: snapshot.id,
      type,
      amount: typeof data.amount === 'number' ? data.amount : 0,
      date: typeof data.date === 'string' ? data.date : '',
      description: typeof data.description === 'string' ? data.description : '',
      categoryId: typeof data.categoryId === 'string' ? data.categoryId : '',
      // NOTE: doc pré-existente sem `paid` degrada pra `false`, nunca
      // `true` por engano — não pode assumir que algo já foi pago.
      paid: typeof data.paid === 'boolean' ? data.paid : false,
      createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
      ...(accountId !== undefined ? { accountId } : {}),
      ...(cardId !== undefined ? { cardId } : {}),
      ...(recurringRuleId !== undefined ? { recurringRuleId } : {}),
      ...(installmentGroupId !== undefined
        ? {
            installmentGroupId,
            installmentIndex: typeof data.installmentIndex === 'number' ? data.installmentIndex : 1,
            installmentTotal: typeof data.installmentTotal === 'number' ? data.installmentTotal : 1,
          }
        : {}),
      ...(paidTransactionIds !== undefined ? { paidTransactionIds } : {}),
      ...(typeof data.bankRef === 'string' && data.bankRef !== '' ? { bankRef: data.bankRef } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    }
  },
}

export function transactionsCollection(uid: string) {
  return collection(db, 'users', uid, 'transactions').withConverter(transactionConverter)
}

export function transactionDoc(uid: string, transactionId: string) {
  return doc(db, 'users', uid, 'transactions', transactionId).withConverter(transactionConverter)
}

// Efeito assinado no saldo: income soma, expense subtrai. Só se aplica a
// transações vinculadas a conta E marcadas como pagas — card-linked nunca
// passa por aqui (cartão não tem campo de saldo, só `limit`; "fatura" fica
// pra outra fase), e não-pagas não afetam saldo até serem confirmadas
// (essencial pra recorrência/parcelamento: as ocorrências futuras nascem
// não-pagas e não podem mexer no saldo antes de acontecerem de verdade).
export function signedEffect(type: TransactionType, amount: number): number {
  return type === 'income' ? amount : -amount
}

// Defesa em profundidade — o zod do form já deveria garantir isso, mas a
// api.ts não confia cegamente no caller. Receita vinculada a cartão é
// válida (representa um crédito/ajuste que abate o valor da fatura, ver
// cards/invoiceUtils.ts) — só o form geral de receita não expõe essa
// opção; quem cria isso é o fluxo de ajuste de fatura.
function assertValidLinkage(data: TransactionFormData): void {
  const hasAccount = data.accountId !== undefined
  const hasCard = data.cardId !== undefined
  if (hasAccount === hasCard) {
    throw new Error('A transação deve estar vinculada a exatamente uma conta ou um cartão.')
  }
}

export async function createTransaction(
  uid: string,
  data: TransactionFormData,
  createdBy: string,
): Promise<string> {
  assertValidLinkage(data)
  // addDoc não existe dentro de runTransaction; gera o id do lado do
  // cliente com doc(collectionRef) (sem round-trip) e usa transaction.set().
  const newTxRef = doc(transactionsCollection(uid))

  await runTransaction(db, async (transaction) => {
    // só lê a conta se ela puder de fato ser afetada — não-pagas nunca
    // tocam no saldo, então nem vale a pena ler o doc.
    const accountSnap =
      data.accountId !== undefined && data.paid === true
        ? await transaction.get(accountDoc(uid, data.accountId))
        : undefined
    if (accountSnap !== undefined && !accountSnap.exists()) {
      throw new Error('Conta vinculada não encontrada.')
    }

    if (data.accountId !== undefined && data.paid === true && accountSnap?.exists()) {
      transaction.update(accountDoc(uid, data.accountId), {
        balance: accountSnap.data().balance + signedEffect(data.type, data.amount),
      })
    }
    transaction.set(newTxRef, { id: newTxRef.id, createdBy, ...data })
  })

  return newTxRef.id
}

// Campos que amarram a transação à sua série (recorrência fixa ou
// parcelamento). Não vêm do formulário — são gravados só na criação da
// série — então updateTransaction os copia do doc antigo.
function seriesFields(
  transaction: Transaction,
): Pick<Transaction, 'recurringRuleId' | 'installmentGroupId' | 'installmentIndex' | 'installmentTotal'> {
  return {
    ...(transaction.recurringRuleId !== undefined ? { recurringRuleId: transaction.recurringRuleId } : {}),
    ...(transaction.installmentGroupId !== undefined
      ? {
          installmentGroupId: transaction.installmentGroupId,
          installmentIndex: transaction.installmentIndex,
          installmentTotal: transaction.installmentTotal,
        }
      : {}),
  }
}

export async function updateTransaction(
  uid: string,
  transactionId: string,
  data: TransactionFormData,
): Promise<void> {
  assertValidLinkage(data)
  const txRef = transactionDoc(uid, transactionId)

  await runTransaction(db, async (transaction) => {
    // READ 1: transação existente, pra saber accountId/cardId/type/amount/
    // paid ANTIGOS — o caller só nos dá os dados NOVOS do form. Ler aqui
    // dentro (em vez de confiar num valor já buscado antes) também protege
    // contra stale data, já que o formulário pode ter ficado aberto um tempo.
    const oldSnap = await transaction.get(txRef)
    if (!oldSnap.exists()) throw new Error('Transação não encontrada.')
    const oldData = oldSnap.data()

    const oldAccountId = oldData.accountId
    const newAccountId = data.accountId
    // efeito é 0 a menos que a ponta em questão esteja vinculada a conta E
    // marcada como paga — "marcar como pago" é só isso: um updateTransaction
    // normal com paid:true, sem caminho de código novo.
    const oldEffect =
      oldAccountId !== undefined && oldData.paid === true ? signedEffect(oldData.type, oldData.amount) : 0
    const newEffect = newAccountId !== undefined && data.paid === true ? signedEffect(data.type, data.amount) : 0
    const sameAccount =
      oldAccountId !== undefined &&
      oldData.paid === true &&
      newAccountId !== undefined &&
      data.paid === true &&
      oldAccountId === newAccountId

    // READ 2: conta antiga, só se ela de fato contribuiu pro saldo (paga).
    // Se a transação nunca foi paga, não há nada pra reverter — cobre
    // unpaid→unpaid e unpaid→paid sem tocar no doc da conta antiga.
    const oldAccountSnap =
      oldAccountId !== undefined && oldData.paid === true
        ? await transaction.get(accountDoc(uid, oldAccountId))
        : undefined
    if (oldAccountSnap !== undefined && !oldAccountSnap.exists()) {
      throw new Error('Conta antiga vinculada não encontrada.')
    }
    const oldAccountBalance = oldAccountSnap?.exists() ? oldAccountSnap.data().balance : undefined

    // READ 3: conta nova, só se ela vai passar a contribuir E não é a mesma
    // já lida acima (evita ler o mesmo doc duas vezes).
    const newAccountSnap =
      newAccountId !== undefined && data.paid === true && !sameAccount
        ? await transaction.get(accountDoc(uid, newAccountId))
        : undefined
    if (newAccountSnap !== undefined && !newAccountSnap.exists()) {
      throw new Error('Conta vinculada não encontrada.')
    }
    const newAccountBalance = newAccountSnap?.exists() ? newAccountSnap.data().balance : undefined

    // READ 4: se isto é a transação "Pagamento fatura X" (tem
    // paidTransactionIds) voltando de paga pra não-paga, as transações de
    // cartão que ela fechou reabrem junto — senão ficam presas em "paga"
    // pra sempre, sem nenhuma fatura em aberto que as represente.
    const reopening = oldData.paid === true && data.paid === false
    const reopenIds = reopening ? (oldData.paidTransactionIds ?? []) : []
    const reopenSnaps = []
    for (const id of reopenIds) {
      reopenSnaps.push(await transaction.get(transactionDoc(uid, id)))
    }

    // --- só writes daqui pra baixo ---
    if (sameAccount && oldAccountId !== undefined && oldAccountBalance !== undefined) {
      // mesma conta absorve reversão + aplicação num único write (cobre
      // mudança de valor, de tipo, ou ambos, mantendo a mesma conta)
      transaction.update(accountDoc(uid, oldAccountId), {
        balance: oldAccountBalance - oldEffect + newEffect,
      })
    } else {
      if (oldAccountId !== undefined && oldAccountBalance !== undefined) {
        transaction.update(accountDoc(uid, oldAccountId), { balance: oldAccountBalance - oldEffect })
      }
      if (newAccountId !== undefined && newAccountBalance !== undefined) {
        transaction.update(accountDoc(uid, newAccountId), { balance: newAccountBalance + newEffect })
      }
    }

    for (const snap of reopenSnaps) {
      if (snap.exists()) transaction.update(transactionDoc(uid, snap.id), { paid: false })
    }

    // `set` sobrescreve o doc inteiro — precisa levar adiante o
    // `createdBy` original (não vem em `data`, que é só o form) senão a
    // autoria se perde a cada edição. `paidTransactionIds` também não vem
    // do form (é gravado só por payCardInvoice) — preserva o valor antigo
    // senão some na primeira edição manual desta transação. Mesma coisa
    // pro vínculo com a série (recorrência fixa / parcelamento): o form não
    // manda esses campos, e sem preservá-los a ocorrência se soltaria da
    // série na primeira edição — quebrando o "aplicar a todas" depois.
    transaction.set(txRef, {
      id: transactionId,
      createdBy: oldData.createdBy,
      ...seriesFields(oldData),
      ...data,
      ...(oldData.paidTransactionIds !== undefined ? { paidTransactionIds: oldData.paidTransactionIds } : {}),
      // vínculo com o lançamento do banco também não vem do form — sem
      // preservar, a próxima sincronização importaria o mesmo gasto de novo.
      ...(oldData.bankRef !== undefined ? { bankRef: oldData.bankRef } : {}),
      // Quem não conhece tags (confirmar pendente, pagamento de fatura...)
      // não manda o campo — preserva o que já estava gravado.
      tags: data.tags ?? oldData.tags,
    })
  })
}

export async function deleteTransaction(uid: string, transactionId: string): Promise<void> {
  const txRef = transactionDoc(uid, transactionId)

  await runTransaction(db, async (transaction) => {
    const txSnap = await transaction.get(txRef)
    if (!txSnap.exists()) throw new Error('Transação não encontrada.')
    const txData = txSnap.data()

    const accountSnap =
      txData.accountId !== undefined && txData.paid === true
        ? await transaction.get(accountDoc(uid, txData.accountId))
        : undefined
    if (accountSnap !== undefined && !accountSnap.exists()) {
      throw new Error('Conta vinculada não encontrada.')
    }

    // Apagar a transação "Pagamento fatura X" some com o registro do
    // pagamento, mas o que ela fechou continua marcado como pago pra
    // sempre se não reabrir aqui também — mesma lógica de updateTransaction
    // reabrindo quando `paid` volta pra false.
    const reopenIds = txData.paid === true ? (txData.paidTransactionIds ?? []) : []
    const reopenSnaps = []
    for (const id of reopenIds) {
      reopenSnaps.push(await transaction.get(transactionDoc(uid, id)))
    }

    if (txData.accountId !== undefined && txData.paid === true && accountSnap?.exists()) {
      transaction.update(accountDoc(uid, txData.accountId), {
        balance: accountSnap.data().balance - signedEffect(txData.type, txData.amount),
      })
    }
    for (const snap of reopenSnaps) {
      if (snap.exists()) transaction.update(transactionDoc(uid, snap.id), { paid: false })
    }
    transaction.delete(txRef)
  })
}

// Sequencial, não Promise.all — mesmo motivo de confirmMany em
// useConfirmPending.ts: evita várias runTransaction concorrentes (cada
// deleteTransaction abre uma) que forçariam retries do Firestore. O que já
// foi apagado fica apagado se um erro no meio interromper o resto.
export async function deleteManyTransactions(uid: string, transactionIds: string[]): Promise<void> {
  for (const id of transactionIds) {
    await deleteTransaction(uid, id)
  }
}

export async function getTransaction(uid: string, transactionId: string): Promise<Transaction | null> {
  const snapshot = await getDoc(transactionDoc(uid, transactionId))
  return snapshot.exists() ? snapshot.data() : null
}
