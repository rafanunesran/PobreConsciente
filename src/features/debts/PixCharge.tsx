import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, MessageCircle, Settings2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { formatBRL } from '../../lib/utils'
import { buildPixPayload, loadPixSettings, savePixSettings, type PixSettings } from './pix'

interface PixChargeProps {
  amount: number
  person: string
  description: string
}

// Cobrança por Pix "copia e cola" + QR Code, com a chave Pix da pessoa
// (guardada neste aparelho). O dinheiro vai direto pra conta dela — o app
// só monta o código, não intermedeia nada.
export function PixCharge({ amount, person, description }: PixChargeProps) {
  const [settings, setSettings] = useState<PixSettings | null>(loadPixSettings)
  const [editing, setEditing] = useState(settings === null)
  const [draft, setDraft] = useState<PixSettings>(settings ?? { key: '', name: '', city: '' })
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const payload = settings ? buildPixPayload(settings, amount, description || undefined) : null

  useEffect(() => {
    if (!payload) return
    let cancelled = false
    QRCode.toDataURL(payload, { margin: 1, width: 240 })
      .then((url) => {
        if (!cancelled) setQr(url)
      })
      .catch(() => setQr(null))
    return () => {
      cancelled = true
    }
  }, [payload])

  if (editing || !settings || !payload) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-light-secondary dark:text-dark-secondary">
          Informe sua chave Pix para gerar a cobrança. Ela fica salva só neste aparelho.
        </p>
        <Input
          label="Chave Pix"
          placeholder="CPF, e-mail, +55 telefone ou chave aleatória"
          value={draft.key}
          onChange={(e) => setDraft({ ...draft, key: e.target.value })}
        />
        <Input
          label="Seu nome"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <Input
          label="Cidade"
          value={draft.city}
          onChange={(e) => setDraft({ ...draft, city: e.target.value })}
        />
        <Button
          type="button"
          disabled={draft.key.trim() === '' || draft.name.trim() === ''}
          onClick={() => {
            savePixSettings(draft)
            setSettings(draft)
            setEditing(false)
          }}
        >
          Salvar chave
        </Button>
      </div>
    )
  }

  const message =
    `Oi, ${person}! Segue o Pix de ${formatBRL(amount)}` +
    (description ? ` (${description})` : '') +
    `:\n\n${payload}`

  async function copy() {
    if (!payload) return
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // sem permissão de área de transferência — o código continua visível pra copiar à mão
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {qr ? <img src={qr} alt="QR Code Pix" className="h-48 w-48 rounded-xl bg-white p-2" /> : null}
      <p className="w-full break-all rounded-xl border border-border-light p-3 font-mono text-[11px] text-light-secondary dark:border-border-dark dark:text-dark-secondary">
        {payload}
      </p>
      <div className="grid w-full grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copiado!' : 'Copiar código'}
        </Button>
        <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
          <Button type="button" className="w-full">
            <MessageCircle size={16} />
            WhatsApp
          </Button>
        </a>
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex items-center gap-1 text-xs text-light-secondary dark:text-dark-secondary"
      >
        <Settings2 size={12} />
        Chave: {settings.key}
      </button>
    </div>
  )
}
