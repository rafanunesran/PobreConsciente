import {
  collection,
  doc,
  getDoc,
  setDoc,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import type { UserProfile } from './types'

const userProfileConverter: FirestoreDataConverter<UserProfile> = {
  toFirestore: (profile) => ({
    displayName: profile.displayName,
    email: profile.email,
    ...(profile.photoURL !== undefined ? { photoURL: profile.photoURL } : {}),
    ...(profile.fullName !== undefined ? { fullName: profile.fullName } : {}),
  }),
  fromFirestore: (snapshot: QueryDocumentSnapshot) => {
    const data = snapshot.data()
    const photoURL = typeof data.photoURL === 'string' ? data.photoURL : undefined
    const fullName = typeof data.fullName === 'string' && data.fullName.trim() !== '' ? data.fullName : undefined
    return {
      uid: snapshot.id,
      displayName: typeof data.displayName === 'string' ? data.displayName : '',
      email: typeof data.email === 'string' ? data.email : '',
      ...(photoURL !== undefined ? { photoURL } : {}),
      ...(fullName !== undefined ? { fullName } : {}),
    }
  },
}

export function userProfilesCollection() {
  return collection(db, 'userProfiles').withConverter(userProfileConverter)
}

export function userProfileDoc(uid: string) {
  return doc(db, 'userProfiles', uid).withConverter(userProfileConverter)
}

// Upsert idempotente — chamado a cada login (ver AppShell.tsx) pra
// manter o espelho público em dia, inclusive pra usuários que nunca
// mexeram em nada de família (assim o perfil já existe quando alguém
// precisar resolver o nome deles).
export async function upsertMyProfile(
  uid: string,
  data: { displayName: string; email: string; photoURL?: string },
): Promise<void> {
  // merge: não apaga o nome completo (que só a tela de Família grava)
  await setDoc(userProfileDoc(uid), { uid, ...data }, { merge: true })
}

const FULL_NAME_MAX = 80

export async function setMyFullName(uid: string, fullName: string): Promise<void> {
  await setDoc(
    doc(db, 'userProfiles', uid),
    { fullName: fullName.replace(/\s+/g, ' ').trim().slice(0, FULL_NAME_MAX) },
    { merge: true },
  )
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(userProfileDoc(uid))
  return snapshot.exists() ? snapshot.data() : null
}
