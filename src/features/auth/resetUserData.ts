import { collection, getDocs, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'

// Toda coleção que hoje vive sob users/{uid}/... (ver firestore.rules) —
// mantida em sincronia manualmente com os `match` de lá.
const USER_COLLECTIONS = [
  'accounts',
  'cards',
  'categories',
  'transactions',
  'recurringRules',
  'caixinhas',
  'caixinhaMovements',
  'budgets',
  'attachments',
] as const

// Firestore só aceita até 500 operações por writeBatch.
const BATCH_LIMIT = 500

// Apaga TODOS os documentos do usuário em todas as coleções conhecidas —
// irreversível. Não usa converter (não precisa ler/tipar os dados, só
// apagar cada doc.ref).
export async function resetUserData(uid: string): Promise<void> {
  for (const name of USER_COLLECTIONS) {
    const snapshot = await getDocs(collection(db, 'users', uid, name))
    const refs = snapshot.docs.map((d) => d.ref)
    for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db)
      for (const ref of refs.slice(i, i + BATCH_LIMIT)) batch.delete(ref)
      await batch.commit()
    }
  }
}
