// "Pix copia e cola" estático (BR Code), no formato EMV do Banco Central.
// Gerado 100% no navegador — não passa por banco nem por servidor; quem
// recebe o código paga direto para a chave informada.

export interface PixSettings {
  key: string // CPF, CNPJ, e-mail, telefone (+55...) ou chave aleatória
  name: string // nome do recebedor
  city: string
}

function field(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`
}

// O padrão só aceita ASCII nesses campos e limita o tamanho.
function sanitize(value: string, max: number): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .slice(0, max)
}

// Telefone precisa ir no formato +55DDDNUMERO; CPF/CNPJ só com dígitos.
export function normalizePixKey(raw: string): string {
  const key = raw.trim()
  if (key.includes('@')) return key.toLowerCase()
  const digits = key.replace(/\D/g, '')
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return key.toLowerCase()
  if (key.startsWith('+')) return `+${digits}`
  // 11 dígitos é ambíguo (CPF ou celular com DDD) — sem "+" tratamos como CPF.
  return digits
}

// CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF), exigido no campo 63.
function crc16(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1
      crc &= 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function buildPixPayload(settings: PixSettings, amount?: number, message?: string): string {
  const merchantAccount =
    field('00', 'br.gov.bcb.pix') +
    field('01', normalizePixKey(settings.key)) +
    (message ? field('02', sanitize(message, 40)) : '')
  const payload =
    field('00', '01') +
    field('26', merchantAccount) +
    field('52', '0000') +
    field('53', '986') +
    (amount !== undefined && amount > 0 ? field('54', amount.toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', sanitize(settings.name, 25) || 'RECEBEDOR') +
    field('60', sanitize(settings.city, 15) || 'BRASIL') +
    field('62', field('05', '***')) +
    '6304'
  return payload + crc16(payload)
}

// Preferência do aparelho — chave Pix não é segredo, mas também não
// precisa ir pro Firestore compartilhado com a família.
const STORAGE_KEY = 'pc-pix-settings'

export function loadPixSettings(): PixSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PixSettings>
    if (typeof parsed.key !== 'string' || parsed.key === '') return null
    return { key: parsed.key, name: parsed.name ?? '', city: parsed.city ?? '' }
  } catch {
    return null
  }
}

export function savePixSettings(settings: PixSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // storage bloqueado — a chave só não fica lembrada
  }
}
