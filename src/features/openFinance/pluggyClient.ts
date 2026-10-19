import type { PluggyAccount, PluggyItem, PluggyTransaction } from './types'

// A API da Pluggy libera CORS (Access-Control-Allow-Origin: *), então o
// app chama direto do navegador com as credenciais da própria pessoa — não
// há backend nosso no meio (o hosting é GitHub Pages).
const BASE_URL = 'https://api.pluggy.ai'

// Teto de páginas por conta (500 lançamentos cada) — só pra um cursor
// quebrado nunca virar laço infinito.
const MAX_PAGES = 40

export class PluggyError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function friendlyMessage(status: number, apiMessage: string | undefined): string {
  if (status === 401 || status === 403) {
    return 'A Pluggy recusou as credenciais. Confira o Client ID e o Client Secret.'
  }
  if (status === 404) return 'A Pluggy não encontrou esse Item ID. Confira se copiou o ID certo.'
  if (status === 429) return 'Muitas requisições à Pluggy em pouco tempo. Tente de novo em um minuto.'
  return apiMessage ? `Pluggy: ${apiMessage}` : `Erro ao falar com a Pluggy (HTTP ${status}).`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, init)
  } catch {
    throw new PluggyError(0, 'Não foi possível conectar à Pluggy. Verifique sua internet.')
  }
  if (!response.ok) {
    let apiMessage: string | undefined
    try {
      const body: unknown = await response.json()
      if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
        apiMessage = body.message
      }
    } catch {
      // corpo não-JSON — fica só o status
    }
    throw new PluggyError(response.status, friendlyMessage(response.status, apiMessage))
  }
  return (await response.json()) as T
}

// A chave dura 2h; cada sincronização pede uma nova (são poucas chamadas).
export async function authenticate(clientId: string, clientSecret: string): Promise<string> {
  const { apiKey } = await request<{ apiKey: string }>('/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
  })
  return apiKey
}

export function getItem(apiKey: string, itemId: string): Promise<PluggyItem> {
  return request<PluggyItem>(`/items/${encodeURIComponent(itemId)}`, { headers: { 'X-API-KEY': apiKey } })
}

export async function listAccounts(apiKey: string, itemId: string): Promise<PluggyAccount[]> {
  const { results } = await request<{ results: PluggyAccount[] }>(
    `/accounts?itemId=${encodeURIComponent(itemId)}`,
    { headers: { 'X-API-KEY': apiKey } },
  )
  return results
}

// GET /transactions (paginado por página) foi descontinuado — o v2 pagina
// por cursor e devolve em `next` a query string pronta da próxima página,
// pra concatenar como veio (re-encodar o cursor quebra a paginação).
export async function listTransactions(
  apiKey: string,
  accountId: string,
  dateFrom: string,
  dateTo: string,
): Promise<PluggyTransaction[]> {
  const all: PluggyTransaction[] = []
  let query: string | null =
    `?accountId=${encodeURIComponent(accountId)}&dateFrom=${dateFrom}&dateTo=${dateTo}`

  for (let page = 0; query !== null && page < MAX_PAGES; page++) {
    const body: { results: PluggyTransaction[]; next: string | null } = await request(
      `/v2/transactions${query}`,
      { headers: { 'X-API-KEY': apiKey } },
    )
    all.push(...body.results)
    query = body.next ? (body.next.startsWith('?') ? body.next : `?${body.next}`) : null
  }

  return all
}

export interface PluggyBill {
  id: string
  dueDate: string // ISO
  totalAmount: number
}

// Faturas já fechadas do cartão (a em aberto não é uma Bill) — nem toda
// instituição devolve; erro aqui não deve derrubar quem chama.
export async function listBills(apiKey: string, accountId: string): Promise<PluggyBill[]> {
  const { results } = await request<{ results: PluggyBill[] }>(
    `/bills?accountId=${encodeURIComponent(accountId)}`,
    { headers: { 'X-API-KEY': apiKey } },
  )
  return results
}
