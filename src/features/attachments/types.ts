export const ATTACHMENT_MIME_TYPES = ['image/jpeg', 'application/pdf'] as const
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number]

// Comprovante de um lançamento. O arquivo vive DENTRO do documento, como
// data URL — sem Firebase Storage (que exige plano pago em projeto novo).
// Por isso o teto de tamanho: um documento do Firestore aguenta ~1 MiB.
export interface Attachment {
  id: string
  transactionId: string
  name: string
  mimeType: AttachmentMimeType
  dataUrl: string
  createdAt: string // ISO
  createdBy: string
}

export const MAX_ATTACHMENTS_PER_TRANSACTION = 3
// Folga em relação ao 1 MiB do documento pros outros campos.
export const MAX_DATA_URL_LENGTH = 900_000
