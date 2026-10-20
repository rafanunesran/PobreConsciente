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
