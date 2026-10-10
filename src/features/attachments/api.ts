import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { ATTACHMENT_MIME_TYPES, type Attachment, type AttachmentMimeType } from './types'

const attachmentConverter: FirestoreDataConverter<Attachment> = {
  toFirestore: (a) => ({
    transactionId: a.transactionId,
    name: a.name,
    mimeType: a.mimeType,
    dataUrl: a.dataUrl,
    createdAt: a.createdAt,
    createdBy: a.createdBy,
  }),
  fromFirestore: (snapshot: QueryDocumentSnapshot) => {
    const data = snapshot.data()
    const mimeType: AttachmentMimeType = ATTACHMENT_MIME_TYPES.includes(data.mimeType) ? data.mimeType : 'image/jpeg'
    return {
      id: snapshot.id,
      transactionId: typeof data.transactionId === 'string' ? data.transactionId : '',
      name: typeof data.name === 'string' ? data.name : 'comprovante',
      mimeType,
      dataUrl: typeof data.dataUrl === 'string' ? data.dataUrl : '',
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
      createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    }
  },
}

function attachmentsCollection(uid: string) {
  return collection(db, 'users', uid, 'attachments').withConverter(attachmentConverter)
}

export interface NewAttachment {
  name: string
  mimeType: AttachmentMimeType
  dataUrl: string
}

export async function addAttachment(
  uid: string,
  transactionId: string,
  file: NewAttachment,
  createdBy: string,
): Promise<Attachment> {
  const ref = doc(attachmentsCollection(uid))
  const attachment: Attachment = {
    id: ref.id,
    transactionId,
    ...file,
    createdAt: new Date().toISOString(),
    createdBy,
  }
  await setDoc(ref, attachment)
  return attachment
}

// Equality num campo só — não precisa de índice composto.
export async function listAttachments(uid: string, transactionId: string): Promise<Attachment[]> {
  const snapshot = await getDocs(query(attachmentsCollection(uid), where('transactionId', '==', transactionId)))
  return snapshot.docs.map((d) => d.data()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function deleteAttachment(uid: string, attachmentId: string): Promise<void> {
  await deleteDoc(doc(attachmentsCollection(uid), attachmentId))
}

// Chamado depois de excluir o lançamento — comprovante sem lançamento só
// ocuparia espaço.
export async function deleteAttachmentsOf(uid: string, transactionIds: string[]): Promise<void> {
  for (const transactionId of transactionIds) {
    const snapshot = await getDocs(query(attachmentsCollection(uid), where('transactionId', '==', transactionId)))
    if (snapshot.empty) continue
    const batch = writeBatch(db)
    for (const d of snapshot.docs) batch.delete(d.ref)
    await batch.commit()
  }
}
