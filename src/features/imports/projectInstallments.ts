import { getInvoicePeriod, nextInvoicePeriod, type InvoicePeriod } from '../cards/invoiceUtils'
import { sharesWord } from '../openFinance/matching'
import { addMonthsClamped, formatDate, parseDate } from '../transactions/dateUtils'
import type { Transaction } from '../transactions/types'
import type { ParsedEntry } from './types'

// "Fatura já paga": a pessoa importa a fatura de um mês que já foi pago só
// pra o app descobrir o que está parcelado e prever as parcelas que ainda
// vão cair. Nada daquele mês é lançado (já está pago e já saiu da conta);
// só as parcelas seguintes viram lançamentos em aberto nas próximas faturas.
//
// Diferente de expandInstallments.ts (importação normal), a parcela futura
// não é "data da linha + N meses": muita fatura lista a parcela com a data
// da COMPRA original (ex: "AMAZON 3/10" datada de 3 meses atrás). Por isso
// a projeção se ancora na fatura escolhida: a parcela k+j cai j faturas
// depois da fatura paga, no mesmo dia do mês da compra, dentro do período
// dessa fatura.

const AMOUNT_EPSILON = 0.015

export interface ProjectedInstallment {
  date: string
  installmentIndex: number
  installmentTotal: number
  period: InvoicePeriod
  // já existe no cartão (veio da sincronização, de outra importação ou foi
  // lançada à mão) — não é criada de novo
  existing?: Transaction
}

// Fatura mais provável do arquivo: a que contém a data mais recente dele
// (fatura lista compras até o fechamento; as parceladas podem vir com a
// data antiga da compra, então a mais recente é a melhor pista).
export function inferPaidPeriod(entries: ParsedEntry[], closingDay: number): InvoicePeriod | null {
  let latest: string | undefined
  for (const e of entries) if (latest === undefined || e.date > latest) latest = e.date
  return latest ? getInvoicePeriod(closingDay, latest) : null
}

// Dia do mês da compra, levado pra dentro do período da fatura alvo.
export function dateInPeriod(lineDate: string, period: InvoicePeriod): string {
  const { day } = parseDate(lineDate)
  const end = parseDate(period.end)
  for (const offset of [0, -1]) {
    const c = addMonthsClamped(end.year, end.month1based, day, offset)
    const candidate = formatDate(c.year, c.month1based, c.day)
    if (candidate >= period.start && candidate <= period.end) return candidate
  }
  return period.end
}

function isSameInstallment(
  entry: ParsedEntry,
  index: number,
  total: number,
  t: Transaction,
  period: InvoicePeriod,
): boolean {
  if (t.type !== entry.type || Math.abs(t.amount - entry.amount) >= AMOUNT_EPSILON) return false
  const inPeriod = t.date >= period.start && t.date <= period.end
  if (t.installmentIndex !== undefined && t.installmentTotal !== undefined) {
    if (t.installmentIndex !== index || t.installmentTotal !== total) return false
    // mesma parcela vinda do banco pode estar com a data da compra original
    return inPeriod || sharesWord(entry.description, t.description)
  }
  if (!inPeriod) return false
  // sem número de parcela (lançado à mão ou banco que não informa): mesmo
  // valor na mesma fatura e descrição parecida
  return sharesWord(entry.description, t.description)
}

// Parcelas que faltam depois da que está na fatura paga, cada uma marcada
// com o lançamento do cartão que já a representa (se houver). `used`
// guarda os lançamentos já "consumidos" por outras linhas do mesmo arquivo
// (duas compras iguais parceladas não podem casar com o mesmo lançamento).
export function projectInstallments(
  entry: ParsedEntry,
  paidPeriod: InvoicePeriod,
  closingDay: number,
  cardTransactions: Transaction[],
  used: Set<string> = new Set(),
): ProjectedInstallment[] {
  const { installmentIndex, installmentTotal } = entry
  if (installmentIndex === undefined || installmentTotal === undefined) return []

  const result: ProjectedInstallment[] = []
  let period = paidPeriod
  for (let index = installmentIndex + 1; index <= installmentTotal; index++) {
    period = nextInvoicePeriod(closingDay, period)
    const existing = cardTransactions.find(
      (t) => !used.has(t.id) && isSameInstallment(entry, index, installmentTotal, t, period),
    )
    if (existing) used.add(existing.id)
    result.push({
      date: dateInPeriod(entry.date, period),
      installmentIndex: index,
      installmentTotal,
      period,
      ...(existing ? { existing } : {}),
    })
  }
  return result
}
