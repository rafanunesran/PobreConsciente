import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  deleteField,
  getDoc,
  runTransaction,
  updateDoc,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { todayDateString } from '../cards/invoiceUtils'
import { caixinhaMovementsCollection } from './movements'
import type { Caixinha } from './types'
import type { CaixinhaFormData } from './schemas'

// NOTE: mesmo padrão de narrowing campo a campo de accounts/api.ts (sem
// `as unknown as X`).
const caixinhaConverter: FirestoreDataConverter<Caixinha> = {
  toFirestore: (caixinha) => ({
    accountId: caixinha.accountId,
    name: caixinha.name,
    balance: caixinha.balance,
    createdBy: caixinha.createdBy,
    ...(caixinha.yieldLabel !== undefined ? { yieldLabel: caixinha.yieldLabel } : {}),
    ...(caixinha.goalAmount !== undefined ? { goalAmount: caixinha.goalAmount } : {}),
    ...(caixinha.goalDate !== undefined ? { goalDate: caixinha.goalDate } : {}),
  }),
  fromFirestore: (snapshot: QueryDocumentSnapshot) => {
    const data = snapshot.data()
    const yieldLabel = typeof data.yieldLabel === 'string' ? data.yieldLabel : undefined
    const goalAmount = typeof data.goalAmount === 'number' && data.goalAmount > 0 ? data.goalAmount : undefined
    const goalDate = typeof data.goalDate === 'string' && data.goalDate !== '' ? data.goalDate : undefined
    return {
      id: snapshot.id,
      accountId: typeof data.accountId === 'string' ? data.accountId : '',
      name: typeof data.name === 'string' ? data.name : '',
      balance: typeof data.balance === 'number' ? data.balance : 0,
      createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
      ...(yieldLabel !== undefined ? { yieldLabel } : {}),
      ...(goalAmount !== undefined ? { goalAmount } : {}),
      ...(goalDate !== undefined ? { goalDate } : {}),
    }
  },
}

export function caixinhasCollection(uid: string) {
  return collection(db, 'users', uid, 'caixinhas').withConverter(caixinhaConverter)
}

export function caixinhaDoc(uid: string, caixinhaId: string) {
  return doc(db, 'users', uid, 'caixinhas', caixinhaId).withConverter(caixinhaConverter)
}

export async function createCaixinha(
  uid: string,
  accountId: string,
  data: CaixinhaFormData,
  createdBy: string,
): Promise<string> {
  const ref = await addDoc(caixinhasCollection(uid), {
    id: '',
    accountId,
    balance: 0,
    name: data.name,
    createdBy,
    // string vazia (campo deixado em branco no form) vira "ausente" —
    // não persiste um yieldLabel sem conteúdo.
    ...(data.yieldLabel ? { yieldLabel: data.yieldLabel } : {}),
    ...(data.goalAmount !== undefined ? { goalAmount: data.goalAmount } : {}),
    ...(data.goalDate ? { goalDate: data.goalDate } : {}),
  })
  return ref.id
}

// Só nome/rótulo de rendimento — saldo nunca é escrito por aqui, sempre
// pelas operações atômicas de caixinhaTransfers.ts (guardar/resgatar/
// rendimento) ou pelo ajuste direto (que não passa nem por elas).
export async function updateCaixinha(
  uid: string,
  caixinhaId: string,
  data: CaixinhaFormData,
): Promise<void> {
  // Meta apagada no form precisa SUMIR do doc — updateDoc com undefined
  // é erro no Firestore, daí o deleteField() explícito.
  await updateDoc(caixinhaDoc(uid, caixinhaId), {
    name: data.name,
    yieldLabel: data.yieldLabel ?? '',
    goalAmount: data.goalAmount ?? deleteField(),
    goalDate: data.goalDate ? data.goalDate : deleteField(),
  })
}

export async function deleteCaixinha(uid: string, caixinhaId: string): Promise<void> {
  await deleteDoc(caixinhaDoc(uid, caixinhaId))
}

export async function getCaixinha(uid: string, caixinhaId: string): Promise<Caixinha | null> {
  const snapshot = await getDoc(caixinhaDoc(uid, caixinhaId))
  return snapshot.exists() ? snapshot.data() : null
}

// Ajuste de saldo da caixinha: sem Transaction (o tipo `Transaction` de
// receita/despesa) e sem tocar `account.balance` — restrição explícita do
// usuário (corrigir um desvio na caixinha não é receita, diferente do
// ajuste de conta/fatura, que reconcilia contra uma fonte de verdade
// externa real). Ainda assim registra um `CaixinhaMovement` (o log de
// extrato, não o ledger de despesas/receitas) pra aparecer no histórico.
export async function adjustCaixinhaBalance(
  uid: string,
  caixinhaId: string,
  realBalance: number,
  diff: number,
  createdBy: string,
): Promise<void> {
  if (diff === 0) return
  const movementRef = doc(caixinhaMovementsCollection(uid))
  await runTransaction(db, async (transaction) => {
    transaction.update(caixinhaDoc(uid, caixinhaId), { balance: realBalance })
    transaction.set(movementRef, {
      id: movementRef.id,
      caixinhaId,
      type: 'ajuste',
      amount: diff,
      date: todayDateString(),
      createdBy,
    })
  })
}
