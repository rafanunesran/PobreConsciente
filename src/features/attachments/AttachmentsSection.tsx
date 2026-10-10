import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { FileText, Paperclip, Trash2 } from 'lucide-react'
import { addAttachment, deleteAttachment, listAttachments, type NewAttachment } from './api'
import { AttachmentTooLargeError, AttachmentTypeError, openAttachment, prepareAttachment } from './prepareFile'
import { MAX_ATTACHMENTS_PER_TRANSACTION, type Attachment } from './types'

interface AttachmentsSectionProps {
  workspaceId: string
  userId: string
  // Edição: grava/apaga direto no Firestore. Criação: o lançamento ainda
  // não tem id, então os arquivos ficam em `pending` e quem salva o form
  // grava depois de criar o lançamento.
  transactionId?: string
  pending: NewAttachment[]
  onPendingChange: (pending: NewAttachment[]) => void
}

type Item = { key: string; name: string; mimeType: string; dataUrl: string; saved?: Attachment }

export function AttachmentsSection({
  workspaceId,
  userId,
  transactionId,
  pending,
  onPendingChange,
}: AttachmentsSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [saved, setSaved] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(Boolean(transactionId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!transactionId) return
    let cancelled = false
    listAttachments(workspaceId, transactionId)
      .then((found) => {
        if (!cancelled) setSaved(found)
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar os comprovantes.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, transactionId])

  const items: Item[] = transactionId
    ? saved.map((a) => ({ key: a.id, name: a.name, mimeType: a.mimeType, dataUrl: a.dataUrl, saved: a }))
    : pending.map((p, index) => ({ key: `pending-${index}`, name: p.name, mimeType: p.mimeType, dataUrl: p.dataUrl }))
  const full = items.length >= MAX_ATTACHMENTS_PER_TRANSACTION

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite escolher o mesmo arquivo de novo
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const prepared = await prepareAttachment(file)
      if (transactionId) {
        const attachment = await addAttachment(workspaceId, transactionId, prepared, userId)
        setSaved((current) => [...current, attachment])
      } else {
        onPendingChange([...pending, prepared])
      }
    } catch (err) {
      if (err instanceof AttachmentTooLargeError) {
        setError('Arquivo grande demais. Para PDF, o limite é de cerca de 650 KB.')
      } else if (err instanceof AttachmentTypeError) {
        setError('Envie uma foto ou um PDF.')
      } else {
        setError('Não foi possível anexar. Tente novamente.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(item: Item, index: number) {
    setError(null)
    if (!item.saved) {
      onPendingChange(pending.filter((_, i) => i !== index))
      return
    }
    setBusy(true)
    try {
      await deleteAttachment(workspaceId, item.saved.id)
      setSaved((current) => current.filter((a) => a.id !== item.saved?.id))
    } catch {
      setError('Não foi possível remover. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-light-secondary dark:text-dark-secondary">Comprovantes (opcional)</span>
      {loading ? (
        <div className="h-16 animate-pulse rounded-xl border border-border-light dark:border-border-dark" />
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item, index) => (
            <div
              key={item.key}
              className="relative h-20 w-20 overflow-hidden rounded-xl border border-border-light dark:border-border-dark"
            >
              <button
                type="button"
                onClick={() => void openAttachment(item.dataUrl)}
                aria-label={`Abrir ${item.name}`}
                className="flex h-full w-full items-center justify-center"
              >
                {item.mimeType === 'application/pdf' ? (
                  <span className="flex flex-col items-center gap-1 text-light-secondary dark:text-dark-secondary">
                    <FileText size={22} />
                    <span className="text-[10px]">PDF</span>
                  </span>
                ) : (
                  <img src={item.dataUrl} alt={item.name} className="h-full w-full object-cover" />
                )}
              </button>
              <button
                type="button"
                aria-label={`Remover ${item.name}`}
                disabled={busy}
                onClick={() => void handleRemove(item, index)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {full ? null : (
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border-light text-light-secondary transition-colors duration-200 hover:border-brand-500 hover:text-brand-500 disabled:opacity-50 dark:border-border-dark dark:text-dark-secondary"
            >
              <Paperclip size={18} />
              <span className="text-[11px]">{busy ? 'Enviando...' : 'Anexar'}</span>
            </button>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => void handleFile(e)}
      />
      {error ? <span className="text-sm text-danger">{error}</span> : null}
    </div>
  )
}
