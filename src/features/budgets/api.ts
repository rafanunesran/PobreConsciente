import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  updateDoc,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import type { Budget } from './types'
import type { BudgetFormData } from './schemas'

// NOTE: mesmo padrão de narrowing campo a campo de categories/api.ts.
const budgetConverter: FirestoreDataConverter<Budget> = {
  toFirestore: (budget) => ({
    categoryId: budget.categoryId,
    amount: budget.amount,
    createdBy: budget.createdBy,
  }),
  fromFirestore: (snapshot: QueryDocumentSnapshot) => {
    const data = snapshot.data()
    return {
      id: snapshot.id,
      categoryId: typeof data.categoryId === 'string' ? data.categoryId : '',
      amount: typeof data.amount === 'number' ? data.amount : 0,
      createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    }
  },
}

export function budgetsCollection(uid: string) {
  return collection(db, 'users', uid, 'budgets').withConverter(budgetConverter)
}

function budgetDoc(uid: string, budgetId: string) {
  return doc(db, 'users', uid, 'budgets', budgetId).withConverter(budgetConverter)
}

export async function createBudget(uid: string, data: BudgetFormData, createdBy: string): Promise<string> {
  const ref = await addDoc(budgetsCollection(uid), { id: '', createdBy, ...data })
  return ref.id
}

export async function updateBudget(uid: string, budgetId: string, data: BudgetFormData): Promise<void> {
  await updateDoc(budgetDoc(uid, budgetId), data)
}

export async function deleteBudget(uid: string, budgetId: string): Promise<void> {
  await deleteDoc(budgetDoc(uid, budgetId))
}

export async function getBudget(uid: string, budgetId: string): Promise<Budget | null> {
  const snapshot = await getDoc(budgetDoc(uid, budgetId))
  return snapshot.exists() ? snapshot.data() : null
}
