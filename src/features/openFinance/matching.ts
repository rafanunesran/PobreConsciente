import type { Transaction, TransactionType } from '../transactions/types'

// Regras de conciliação (puras, sem Firestore — ver reconcile.ts pra quem
// grava): quando um lançamento do banco É o mesmo gasto de um lançamento
// que já existe no app (lançado à mão, conta pendente, recorrência,
// parcela, importação de arquivo, "Pagar fatura"...).

// Diferença de data aceita entre o lançamento do app e o do banco. Conta:
// boleto/conta pago alguns dias antes ou depois do dia lançado. Cartão: a
// data da compra no app costuma ser a mesma do banco, com folga pequena.
export const ACCOUNT_WINDOW_DAYS = 10
export const CARD_WINDOW_DAYS = 5
// Até aqui, valor + tipo iguais bastam. Além disso, precisa de mais algum
// sinal (ver isPlausibleMatch) — dois gastos de R$ 50 na mesma semana são
// comuns e não podem virar um só.
const CLOSE_DAYS = 2

const AMOUNT_EPSILON = 0.005

// Palavras que aparecem em quase toda descrição bancária e não dizem nada
// sobre o que foi pago.
const STOPWORDS = new Set([
  'pix',
  'enviado',
  'enviada',
  'recebido',
  'recebida',
  'pagamento',
  'pagto',
  'compra',
  'debito',
  'credito',
  'transferencia',
  'para',
  'cartao',
  'conta',
  'boleto',
  'parcela',
  'ltda',
  'com',
  'www',
])

function words(description: string): Set<string> {
  return new Set(
    description
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z]+/g, ' ')
      .split(' ')
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  )
}

export function sharesWord(a: string, b: string): boolean {
  const wa = words(a)
  for (const w of words(b)) if (wa.has(w)) return true
  return false
}

function toDayNumber(date: string): number {
  return (
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000
  )
}

export function dayDistance(a: string, b: string): number {
  return Math.abs(toDayNumber(a) - toDayNumber(b))
}

// O que a conciliação precisa saber de um lançamento do banco.
export interface BankSide {
  key: string // id do documento que o lançamento do banco tem/teria no app
  date: string
  type: TransactionType
  amount: number
  description: string
}

// Lançamentos do app que podem ser "o mesmo" que um do banco: os que não
// vieram da sincronização e ainda não foram conciliados.
export function isManualCandidate(t: Transaction): boolean {
  return !t.id.startsWith('pluggy_') && t.bankRef === undefined
}

function isPlausibleMatch(bank: BankSide, manual: Transaction, windowDays: number): boolean {
  if (bank.type !== manual.type) return false
  if (Math.abs(bank.amount - manual.amount) >= AMOUNT_EPSILON) return false
  const distance = dayDistance(bank.date, manual.date)
  if (distance > windowDays) return false
  if (distance <= CLOSE_DAYS) return true
  // Mais longe: só se o lançamento do app era algo que se espera ver no
  // banco (conta pendente, recorrência, parcela) ou fala da mesma coisa.
  return (
    !manual.paid ||
    manual.recurringRuleId !== undefined ||
    manual.installmentIndex !== undefined ||
    manual.paidTransactionIds !== undefined ||
    sharesWord(bank.description, manual.description)
  )
}

export interface MatchPair<B extends BankSide> {
  bank: B
  manual: Transaction
}

// Casa cada lançamento do banco com no máximo um do app (e vice-versa),
// sempre o par de datas mais próximas primeiro; empate fica com o que
// estava pendente (é o que o banco "confirma").
export function pairBankWithManual<B extends BankSide>(
  bank: B[],
  manual: Transaction[],
  windowDays: number,
): { pairs: MatchPair<B>[]; unmatched: B[] } {
  const options: {
    bankIndex: number
    manualIndex: number
    distance: number
    pending: boolean
  }[] = []
  bank.forEach((b, bankIndex) => {
    manual.forEach((m, manualIndex) => {
      if (isPlausibleMatch(b, m, windowDays)) {
        options.push({
          bankIndex,
          manualIndex,
          distance: dayDistance(b.date, m.date),
          pending: !m.paid,
        })
      }
    })
  })
  options.sort((a, b) => a.distance - b.distance || Number(b.pending) - Number(a.pending))

  const usedBank = new Set<number>()
  const usedManual = new Set<number>()
  const pairs: MatchPair<B>[] = []
  for (const option of options) {
    if (usedBank.has(option.bankIndex) || usedManual.has(option.manualIndex)) continue
    usedBank.add(option.bankIndex)
    usedManual.add(option.manualIndex)
    pairs.push({
      bank: bank[option.bankIndex] as B,
      manual: manual[option.manualIndex] as Transaction,
    })
  }
  return { pairs, unmatched: bank.filter((_, i) => !usedBank.has(i)) }
}

// Débito na conta que é o pagamento de uma fatura de cartão.
export function looksLikeBillPayment(description: string): boolean {
  return /fatura|pagamento\s+(de\s+)?cart[aã]o|pagto\.?\s+cart[aã]o/i.test(description)
}

// Transferência entre contas da própria família: sai de uma conta e entra
// em outra (as duas vinculadas) com o mesmo valor, em poucos dias. No app,
// transferência entre contas não é receita nem despesa (ver
// accounts/accountTransfers.ts) — nenhum dos dois lados vira lançamento.
export const TRANSFER_WINDOW_DAYS = 3

export interface TransferSide {
  key: string
  appAccountId: string
  date: string
  type: TransactionType
  amount: number
}

// Pares saída × entrada em contas diferentes, datas mais próximas primeiro;
// cada lançamento entra em no máximo um par. Devolve as chaves pareadas.
export function findTransferPairs(sides: TransferSide[]): Set<string> {
  const outs = sides.filter((s) => s.type === 'expense')
  const ins = sides.filter((s) => s.type === 'income')
  const options: { out: TransferSide; in: TransferSide; distance: number }[] = []
  for (const out of outs) {
    for (const incoming of ins) {
      if (out.appAccountId === incoming.appAccountId) continue
      if (Math.abs(out.amount - incoming.amount) >= AMOUNT_EPSILON) continue
      const distance = dayDistance(out.date, incoming.date)
      if (distance <= TRANSFER_WINDOW_DAYS) options.push({ out, in: incoming, distance })
    }
  }
  options.sort((a, b) => a.distance - b.distance)
  const paired = new Set<string>()
  for (const option of options) {
    if (paired.has(option.out.key) || paired.has(option.in.key)) continue
    paired.add(option.out.key)
    paired.add(option.in.key)
  }
  return paired
}

// Quem é "da família" pra reconhecer Pix/TED entre vocês: nomes completos
// (perfil da Família + dono de cada conta conectada) e CPFs (dono de cada
// conta conectada, como a Pluggy informa).
export interface FamilyIdentity {
  names: string[][] // cada nome já quebrado em palavras normalizadas
  documents: string[] // só dígitos e '*' (CPF pode vir mascarado)
}

// Descrição de Pix/TED/DOC/transferência.
export const TRANSFER_DESCRIPTION =
  /\b(pix|ted|doc|transf|transferencia|transferência|transferido|transferida)\b/i

const NAME_PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

function nameTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 0 && !NAME_PARTICLES.has(w))
}

function normalizeDocument(value: string): string {
  return value.replace(/[^0-9*]/g, '')
}

export function buildFamilyIdentity(names: string[], documents: string[]): FamilyIdentity {
  return {
    names: names.map(nameTokens).filter((tokens) => tokens.length >= 2),
    documents: documents.map(normalizeDocument).filter((d) => d.replace(/\*/g, '').length >= 4),
  }
}

// Mesmo CPF/CNPJ, aceitando máscara ("***.***.123-22"): compara posição a
// posição onde os dois têm dígito; precisa de pelo menos 5 dígitos em comum.
export function documentsMatch(a: string, b: string): boolean {
  const da = normalizeDocument(a)
  const db = normalizeDocument(b)
  if (da.length !== db.length || da.length === 0) return false
  let compared = 0
  for (let i = 0; i < da.length; i++) {
    if (da[i] === '*' || db[i] === '*') continue
    if (da[i] !== db[i]) return false
    compared++
  }
  return compared >= 5
}

// O texto cita alguém da família: primeiro E último nome aparecem como
// palavras inteiras (o banco abrevia o meio: "Rafael N Figueiredo").
export function mentionsFamilyMember(text: string, identity: FamilyIdentity): boolean {
  const words = new Set(nameTokens(text))
  return identity.names.some(
    (tokens) => words.has(tokens[0] as string) && words.has(tokens[tokens.length - 1] as string),
  )
}

export function isFamilyCounterpart(
  counterpart: { name?: string | null; document?: string | null } | undefined,
  description: string,
  identity: FamilyIdentity,
): boolean {
  // Com a outra ponta informada pelo banco, só ela decide — a descrição
  // de alguns bancos traz o nome do próprio titular em toda linha.
  if (counterpart?.document || counterpart?.name) {
    if (
      counterpart.document &&
      identity.documents.some((d) => documentsMatch(d, counterpart.document as string))
    ) {
      return true
    }
    return Boolean(counterpart.name && mentionsFamilyMember(counterpart.name, identity))
  }
  // Sem ela, o nome na descrição só vale se a linha for de transferência.
  return TRANSFER_DESCRIPTION.test(description) && mentionsFamilyMember(description, identity)
}

// "Pix no crédito" (Nubank e afins): o banco coloca o valor na conta
// ("Valor adicionado na conta por cartão de crédito") e na mesma hora ele
// sai no Pix. O gasto de verdade é a cobrança no cartão (valor + tarifa);
// a entrada e a saída na conta são só passagem — nenhuma das duas conta.
const CREDIT_TOP_UP =
  /(valor|dinheiro|saldo)\s+adicionad[oa].*cart[aã]o\s+de\s+cr[eé]dito|pix\s+(no|com|parcelado\s+no)\s+cr[eé]dito|cr[eé]dito\s+(do|no)\s+cart[aã]o.*adicionad/i

export function isCreditCardTopUp(entry: { description: string; type: TransactionType }): boolean {
  return entry.type === 'income' && CREDIT_TOP_UP.test(entry.description)
}

export interface TopUpSide {
  key: string
  appAccountId: string
  date: string
  type: TransactionType
  amount: number
  description: string
}

// Chaves a ignorar: cada entrada "valor adicionado por cartão de crédito"
// e a saída de mesmo valor na mesma conta, em até 1 dia (a mais próxima).
// A entrada sai mesmo sem par — nunca é receita.
export function findCreditTopUps(sides: TopUpSide[]): Set<string> {
  const skip = new Set<string>()
  const outs = sides.filter((s) => s.type === 'expense')
  for (const topUp of sides.filter(isCreditCardTopUp)) {
    skip.add(topUp.key)
    const candidates = outs
      .filter(
        (o) =>
          !skip.has(o.key) &&
          o.appAccountId === topUp.appAccountId &&
          Math.abs(o.amount - topUp.amount) < AMOUNT_EPSILON &&
          dayDistance(o.date, topUp.date) <= 1,
      )
      .sort(
        (a, b) =>
          dayDistance(a.date, topUp.date) - dayDistance(b.date, topUp.date) ||
          Number(TRANSFER_DESCRIPTION.test(b.description)) - Number(TRANSFER_DESCRIPTION.test(a.description)),
      )
    const out = candidates[0]
    if (out) skip.add(out.key)
  }
  return skip
}
