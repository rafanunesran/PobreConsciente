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
import { CARD_BRANDS, type CardBrand, type CreditCard } from './types'
import type { CardFormData } from './schemas'

// NOTE: mesmo padrão de narrowing campo a campo de features/accounts/api.ts
// (sem `as unknown as X`) — snapshot.data() é DocumentData por natureza.
const cardConverter: FirestoreDataConverter<CreditCard> = {
  toFirestore: (card) => ({
    name: card.name,
    brand: card.brand,
    limit: card.limit,
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    createdBy: card.createdBy,
  }),
  fromFirestore: (snapshot: QueryDocumentSnapshot) => {
    const data = snapshot.data()
    const brand: CardBrand = CARD_BRANDS.includes(data.brand) ? data.brand : 'outro'
    return {
      id: snapshot.id,
      name: typeof data.name === 'string' ? data.name : '',
      brand,
      limit: typeof data.limit === 'number' ? data.limit : 0,
      closingDay: typeof data.closingDay === 'number' ? data.closingDay : 1,
      dueDay: typeof data.dueDay === 'number' ? data.dueDay : 1,
      createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    }
  },
}

export function cardsCollection(uid: string) {
  return collection(db, 'users', uid, 'cards').withConverter(cardConverter)
}

function cardDoc(uid: string, cardId: string) {
  return doc(db, 'users', uid, 'cards', cardId).withConverter(cardConverter)
}

export async function createCard(uid: string, data: CardFormData, createdBy: string): Promise<string> {
  const ref = await addDoc(cardsCollection(uid), { id: '', createdBy, ...data })
  return ref.id
}

export async function updateCard(uid: string, cardId: string, data: CardFormData): Promise<void> {
  await updateDoc(cardDoc(uid, cardId), data)
}

export async function deleteCard(uid: string, cardId: string): Promise<void> {
  await deleteDoc(cardDoc(uid, cardId))
}

export async function getCard(uid: string, cardId: string): Promise<CreditCard | null> {
  const snapshot = await getDoc(cardDoc(uid, cardId))
  return snapshot.exists() ? snapshot.data() : null
}
