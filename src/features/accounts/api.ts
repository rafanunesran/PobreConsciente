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
import { ACCOUNT_TYPES, type Account, type AccountType } from './types'
import type { AccountFormData } from './schemas'

// NOTE: narrowing campo a campo (sem `as unknown as Account`) porque
// `snapshot.data()` do Firestore é DocumentData (Record<string, any>) por
// natureza — o banco não garante schema no servidor. Um doc malformado
// degrada pra defaults seguros em vez de estourar em runtime.
const accountConverter: FirestoreDataConverter<Account> = {
  toFirestore: (account) => ({
    name: account.name,
    type: account.type,
    balance: account.balance,
    currency: account.currency,
    includeInTotal: account.includeInTotal,
    createdBy: account.createdBy,
  }),
  fromFirestore: (snapshot: QueryDocumentSnapshot) => {
    const data = snapshot.data()
    const type: AccountType = ACCOUNT_TYPES.includes(data.type) ? data.type : 'carteira'
    return {
      id: snapshot.id,
      name: typeof data.name === 'string' ? data.name : '',
      type,
      balance: typeof data.balance === 'number' ? data.balance : 0,
      currency: 'BRL',
      // NOTE: doc pré-existente sem o campo degrada pra `true` — não
      // regride contas já criadas antes desta mudança.
      includeInTotal: typeof data.includeInTotal === 'boolean' ? data.includeInTotal : true,
      // NOTE: doc pré-existente sem o campo (antes do modo família)
      // degrada pra string vazia — nunca quebra, só não tem autor pra
      // mostrar na UI.
      createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    }
  },
}

export function accountsCollection(uid: string) {
  return collection(db, 'users', uid, 'accounts').withConverter(accountConverter)
}

export function accountDoc(uid: string, accountId: string) {
  return doc(db, 'users', uid, 'accounts', accountId).withConverter(accountConverter)
}

export async function createAccount(uid: string, data: AccountFormData, createdBy: string): Promise<string> {
  const ref = await addDoc(accountsCollection(uid), { id: '', currency: 'BRL', createdBy, ...data })
  return ref.id
}

export async function updateAccount(
  uid: string,
  accountId: string,
  data: AccountFormData,
): Promise<void> {
  await updateDoc(accountDoc(uid, accountId), data)
}

export async function deleteAccount(uid: string, accountId: string): Promise<void> {
  await deleteDoc(accountDoc(uid, accountId))
}

export async function getAccount(uid: string, accountId: string): Promise<Account | null> {
  const snapshot = await getDoc(accountDoc(uid, accountId))
  return snapshot.exists() ? snapshot.data() : null
}
