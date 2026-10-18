import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  updateDoc,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { createTransaction, deleteTransaction } from '../transactions/api'
import { getOrCreateCategoryByName } from '../categories/api'
import type { Category } from '../categories/types'
import { DEBT_DIRECTIONS, type Debt, type DebtDirection, type DebtPayment } from './types'
import type { DebtFormData, DebtPaymentFormData } from './schemas'

function parsePayments(raw: unknown): DebtPayment[] {
  if (!Array.isArray(raw)) return []
  const payments: DebtPayment[] = []
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) continue
    const item = p as Record<string, unknown>
    if (typeof item.amount !== 'number' || typeof item.date !== 'string') continue
    payments.push({
      id: typeof item.id === 'string' ? item.id : `${item.date}-${item.amount}`,
      date: item.date,
      amount: item.amount,
      ...(typeof item.transactionId === 'string' ? { transactionId: item.transactionId } : {}),
    })
  }
  return payments
}

const debtConverter: FirestoreDataConverter<Debt> = {
  toFirestore: (debt) => ({
    direction: debt.direction,
    person: debt.person,
    description: debt.description,
    amount: debt.amount,
    payments: debt.payments,
    createdAt: debt.createdAt,
    createdBy: debt.createdBy,
    ...(typeof debt.dueDate === 'string' && debt.dueDate !== '' ? { dueDate: debt.dueDate } : {}),
  }),
  fromFirestore: (snapshot: QueryDocumentSnapshot) => {
    const data = snapshot.data()
    const direction: DebtDirection = DEBT_DIRECTIONS.includes(data.direction) ? data.direction : 'owed'
    return {
      id: snapshot.id,
      direction,
      person: typeof data.person === 'string' ? data.person : '',
      description: typeof data.description === 'string' ? data.description : '',
      amount: typeof data.amount === 'number' ? data.amount : 0,
      payments: parsePayments(data.payments),
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
      createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
      ...(typeof data.dueDate === 'string' && data.dueDate !== '' ? { dueDate: data.dueDate } : {}),
    }
  },
}

export function debtsCollection(uid: string) {
  return collection(db, 'users', uid, 'debts').withConverter(debtConverter)
}

function debtDoc(uid: string, debtId: string) {
  return doc(db, 'users', uid, 'debts', debtId).withConverter(debtConverter)
}

export async function createDebt(uid: string, data: DebtFormData, createdBy: string): Promise<string> {
  const ref = await addDoc(debtsCollection(uid), {
    id: '',
    direction: data.direction,
    person: data.person,
    description: data.description,
    amount: data.amount,
    payments: [],
    createdAt: new Date().toISOString(),
    createdBy,
    ...(data.dueDate ? { dueDate: data.dueDate } : {}),
  })
  return ref.id
}

export async function getDebt(uid: string, debtId: string): Promise<Debt | null> {
  const snapshot = await getDoc(debtDoc(uid, debtId))
  return snapshot.exists() ? snapshot.data() : null
}

// Pagamentos nunca passam por aqui (só por add/removeDebtPayment).
// Vencimento apagado no form precisa sumir do doc — deleteField().
export async function updateDebt(uid: string, debt: Debt, data: DebtFormData): Promise<void> {
  const { dueDate, ...rest } = data
  await updateDoc(debtDoc(uid, debt.id), {
    ...rest,
    dueDate: dueDate ? dueDate : deleteField(),
  })
}

export async function deleteDebt(uid: string, debtId: string): Promise<void> {
  await deleteDoc(debtDoc(uid, debtId))
}

// Pagamento de dívida que movimenta conta vira um lançamento comum: quem
// paga o que deve tem uma despesa; quem recebe o que emprestou, uma receita.
// A categoria é fixa e criada na primeira vez (mesmo padrão dos ajustes).
const CATEGORY_BY_DIRECTION = {
  owe: { name: 'Dívidas', type: 'expense', icon: 'receipt', color: '#EF4444' },
  owed: { name: 'Empréstimos recebidos', type: 'income', icon: 'wallet', color: '#10B981' },
} as const

export async function addDebtPayment(
  uid: string,
  debt: Debt,
  data: DebtPaymentFormData,
  categories: Category[],
  createdBy: string,
): Promise<void> {
  let transactionId: string | undefined
  if (data.accountId) {
    const cat = CATEGORY_BY_DIRECTION[debt.direction]
    const categoryId = await getOrCreateCategoryByName(uid, categories, cat.name, cat.type, cat.icon, cat.color, createdBy)
    transactionId = await createTransaction(
      uid,
      {
        type: cat.type,
        amount: data.amount,
        date: data.date,
        description: debt.direction === 'owe' ? `Pagamento a ${debt.person}` : `Recebido de ${debt.person}`,
        categoryId,
        paid: true,
        accountId: data.accountId,
      },
      createdBy,
    )
  }
  const payment: DebtPayment = {
    id: crypto.randomUUID(),
    date: data.date,
    amount: data.amount,
    ...(transactionId !== undefined ? { transactionId } : {}),
  }
  await updateDoc(debtDoc(uid, debt.id), { payments: [...debt.payments, payment] })
}

// Desfaz o pagamento — e o lançamento que ele criou, devolvendo o saldo da
// conta (deleteTransaction já reverte o efeito no saldo).
export async function removeDebtPayment(uid: string, debt: Debt, paymentId: string): Promise<void> {
  const payment = debt.payments.find((p) => p.id === paymentId)
  if (!payment) return
  if (payment.transactionId) {
    try {
      await deleteTransaction(uid, payment.transactionId)
    } catch {
      // lançamento já apagado à mão — segue removendo o pagamento
    }
  }
  await updateDoc(debtDoc(uid, debt.id), { payments: debt.payments.filter((p) => p.id !== paymentId) })
}
