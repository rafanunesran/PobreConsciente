import { addMonthsClamped, formatDate, monthsBetween, parseDate, roundToCents } from '../transactions/dateUtils'
import type { Transaction } from '../transactions/types'
import type { CreditCard } from './types'

export interface InvoicePeriod {
  start: string // 'YYYY-MM-DD', inclusive
  end: string // 'YYYY-MM-DD', inclusive — sempre um dia de fechamento (clamped)
}

function addOneDay(year: number, month1based: number, day: number) {
  const d = new Date(year, month1based - 1, day + 1) // só componentes locais, nunca toISOString
  return { year: d.getFullYear(), month1based: d.getMonth() + 1, day: d.getDate() }
}

// Período cujo FECHAMENTO cai no mês year/month1based.
function periodEndingInMonth(closingDay: number, year: number, month1based: number): InvoicePeriod {
  const end = addMonthsClamped(year, month1based, closingDay, 0)
  const prevEnd = addMonthsClamped(year, month1based, closingDay, -1)
  const start = addOneDay(prevEnd.year, prevEnd.month1based, prevEnd.day)
  return {
    start: formatDate(start.year, start.month1based, start.day),
    end: formatDate(end.year, end.month1based, end.day),
  }
}

// Período que CONTÉM referenceDate (o dia de fechamento pertence à fatura
// que fecha nele, não à seguinte).
export function getInvoicePeriod(closingDay: number, referenceDate: string): InvoicePeriod {
  const ref = parseDate(referenceDate)
  const closingThisMonth = addMonthsClamped(ref.year, ref.month1based, closingDay, 0)
  if (ref.day <= closingThisMonth.day) return periodEndingInMonth(closingDay, ref.year, ref.month1based)
  const next = addMonthsClamped(ref.year, ref.month1based, closingDay, 1)
  return periodEndingInMonth(closingDay, next.year, next.month1based)
}

export function previousInvoicePeriod(closingDay: number, period: InvoicePeriod): InvoicePeriod {
  const end = parseDate(period.end)
  const m = addMonthsClamped(end.year, end.month1based, closingDay, -1)
  return periodEndingInMonth(closingDay, m.year, m.month1based)
}

export function nextInvoicePeriod(closingDay: number, period: InvoicePeriod): InvoicePeriod {
  const end = parseDate(period.end)
  const m = addMonthsClamped(end.year, end.month1based, closingDay, 1)
  return periodEndingInMonth(closingDay, m.year, m.month1based)
}

// 1ª ocorrência de dueDay ESTRITAMENTE depois de periodEnd — cobre tanto o
// vencimento cair ainda no mês de fechamento quanto no mês seguinte.
export function getDueDate(periodEnd: string, dueDay: number): string {
  const end = parseDate(periodEnd)
  const dueThisMonth = addMonthsClamped(end.year, end.month1based, dueDay, 0)
  const due = dueThisMonth.day > end.day ? dueThisMonth : addMonthsClamped(end.year, end.month1based, dueDay, 1)
  return formatDate(due.year, due.month1based, due.day)
}

export function todayDateString(): string {
  const now = new Date()
  return formatDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function transactionsInPeriod(
  transactions: Transaction[],
  cardId: string,
  period: InvoicePeriod,
): Transaction[] {
  return transactions.filter((t) => t.cardId === cardId && t.date >= period.start && t.date <= period.end)
}

// Receita vinculada a cartão é um crédito/ajuste — abate o valor devido em
// vez de somar, por isso netamos por `type` aqui.
export function sumUnpaid(transactions: Transaction[]): number {
  return roundToCents(
    transactions.reduce((sum, t) => {
      if (t.paid) return sum
      return t.type === 'expense' ? sum + t.amount : sum - t.amount
    }, 0),
  )
}

// "Ocupado": todas as despesas não-pagas do cartão, sem filtro de período —
// um retrato ao vivo do quanto do limite está comprometido.
export function cardOccupiedLimit(transactions: Transaction[], cardId: string): number {
  return sumUnpaid(transactions.filter((t) => t.cardId === cardId))
}

export interface CardInvoiceGroup {
  cardId: string
  cardName: string
  period: InvoicePeriod
  dueDate: string
  dueMonth: string // 'YYYY-MM' — mês de vencimento, usado pra agrupar no extrato
  periodOffset: number // relativo à fatura aberta de hoje (0), pra linkar direto pra CardInvoicePage
  // Só o que ainda está em aberto (sumUnpaid) — nunca o total histórico.
  // Uma fatura paga já tem sua própria transação "Pagamento fatura X"
  // (vinculada à conta) representando esse valor; somar de novo aqui
  // duplicaria o mesmo dinheiro em dois lugares do extrato.
  unpaidAmount: number
}

// Agrupa transações de cartão por fatura (cartão + período de fechamento)
// — usado no extrato geral (Registros) pra mostrar "Fatura {cartão}" como
// um único registro em vez de uma linha por compra. Cada fatura é alocada
// pelo mês do VENCIMENTO, não da compra: uma compra feita depois do
// fechamento só vira parte da fatura seguinte, que vence no mês seguinte.
export function groupCardTransactionsByInvoice(
  transactions: Transaction[],
  cards: CreditCard[],
): CardInvoiceGroup[] {
  const cardsById = new Map(cards.map((c) => [c.id, c]))
  const groups = new Map<
    string,
    { cardId: string; cardName: string; period: InvoicePeriod; dueDate: string; items: Transaction[] }
  >()

  for (const t of transactions) {
    if (t.cardId === undefined) continue
    const card = cardsById.get(t.cardId)
    if (!card) continue
    const period = getInvoicePeriod(card.closingDay, t.date)
    const key = `${card.id}|${period.end}`
    const existing = groups.get(key)
    if (existing) {
      existing.items.push(t)
    } else {
      groups.set(key, {
        cardId: card.id,
        cardName: card.name,
        period,
        dueDate: getDueDate(period.end, card.dueDay),
        items: [t],
      })
    }
  }

  const today = todayDateString()
  return Array.from(groups.values()).map((g) => {
    const card = cardsById.get(g.cardId)
    const openPeriod = card ? getInvoicePeriod(card.closingDay, today) : g.period
    return {
      cardId: g.cardId,
      cardName: g.cardName,
      period: g.period,
      dueDate: g.dueDate,
      dueMonth: g.dueDate.slice(0, 7),
      periodOffset: monthsBetween(openPeriod.end, g.period.end),
      unpaidAmount: sumUnpaid(g.items),
    }
  })
}

// Mês "efetivo" de uma transação pra agrupar por mês em qualquer tela: uma
// transação de conta usa a própria data (é quando o dinheiro mexeu de
// verdade); uma transação de cartão usa o mês de VENCIMENTO da fatura em
// que ela caiu — pode ser diferente do mês da compra (compra feita depois
// do fechamento só vence no mês seguinte).
export function effectiveMonth(transaction: Transaction, cardsById: Map<string, CreditCard>): string {
  if (transaction.cardId === undefined) return transaction.date.slice(0, 7)
  const card = cardsById.get(transaction.cardId)
  if (!card) return transaction.date.slice(0, 7)
  const period = getInvoicePeriod(card.closingDay, transaction.date)
  return getDueDate(period.end, card.dueDay).slice(0, 7)
}

// steps positivo = avança N faturas (projeção), negativo = volta N faturas.
export function shiftInvoicePeriod(closingDay: number, period: InvoicePeriod, steps: number): InvoicePeriod {
  let result = period
  if (steps > 0) {
    for (let i = 0; i < steps; i++) result = nextInvoicePeriod(closingDay, result)
  } else {
    for (let i = 0; i < -steps; i++) result = previousInvoicePeriod(closingDay, result)
  }
  return result
}

export interface CardInvoiceMonthEntry {
  cardId: string
  cardName: string
  periodEnd: string // 'YYYY-MM-DD' — pro caller formatar o nome do mês
  amount: number
}

export interface CardInvoiceMonth {
  offset: number // relativo a HOJE — -1 é a última fatura fechada, 0 é a aberta
  status: 'closed' | 'open' | null
  entries: CardInvoiceMonthEntry[]
}

// Uma fatura por vez (todos os cartões juntos), no mesmo offset relativo a
// hoje pra cada um — as setas do InvoicesSummaryCard mudam esse offset.
// "Fechada"/"Aberta" vêm do offset em si, não de mês calendário, então
// continuam corretas mesmo que os cartões tenham dia de fechamento
// diferente entre si.
export function computeInvoiceMonth(
  cards: CreditCard[],
  transactions: Transaction[],
  offset: number,
): CardInvoiceMonth {
  const today = todayDateString()
  const entries = cards.map((card) => {
    const openPeriod = getInvoicePeriod(card.closingDay, today)
    const period = shiftInvoicePeriod(card.closingDay, openPeriod, offset)
    return {
      cardId: card.id,
      cardName: card.name,
      periodEnd: period.end,
      amount: sumUnpaid(transactionsInPeriod(transactions, card.id, period)),
    }
  })
  return {
    offset,
    status: offset === -1 ? 'closed' : offset === 0 ? 'open' : null,
    entries,
  }
}

// Chave da linha agregada da fatura no extrato (cartão + fim do período).
export function invoiceKey(group: CardInvoiceGroup): string {
  return `${group.cardId}-${group.period.end}`
}
