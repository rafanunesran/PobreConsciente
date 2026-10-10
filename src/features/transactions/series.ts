import { getDocs, query, where } from 'firebase/firestore'
import {
  deleteManyTransactions,
  deleteTransaction,
  transactionsCollection,
  updateTransaction,
} from './api'
import { addMonthsClamped, formatDate, parseDate } from './dateUtils'
import { deleteRecurringRule, updateRecurringRuleFromOccurrence } from './recurring'
import type { Transaction, TransactionFormData } from './types'

// Uma "série" é o conjunto de lançamentos irmãos gerados de uma vez só:
// as ocorrências de uma despesa/receita fixa (mesmo `recurringRuleId`) ou
// as parcelas de um parcelamento (mesmo `installmentGroupId`). Editar ou
// excluir um lançamento desses é ambíguo — daí o escopo perguntado ao
// usuário antes de gravar.
export type SeriesKind = 'recurring' | 'installment'

// 'one'     -> só o lançamento em questão (comportamento antigo)
// 'pending' -> ele + os irmãos ainda não pagos/recebidos (o histórico já
//              pago fica intacto)
// 'all'     -> a série inteira, incluindo o que já foi pago
export type SeriesScope = 'one' | 'pending' | 'all'

export function seriesKindOf(
  transaction: Pick<Transaction, 'recurringRuleId' | 'installmentGroupId'>,
): SeriesKind | null {
  if (transaction.recurringRuleId !== undefined) return 'recurring'
  if (transaction.installmentGroupId !== undefined) return 'installment'
  return null
}

// Parcelas carregam "(3/12)" no fim da descrição — o form mostra a
// descrição do jeito que está gravada, então ao propagar pra série é
// preciso tirar o sufixo antigo e recolocar o índice de CADA parcela.
const INSTALLMENT_SUFFIX = /\s*\(\d+\s*\/\s*\d+\)\s*$/

export function stripInstallmentSuffix(description: string): string {
  return description.replace(INSTALLMENT_SUFFIX, '').trim()
}

// Equality simples num campo só — não precisa de índice composto.
export async function fetchSeriesTransactions(
  uid: string,
  transaction: Pick<Transaction, 'recurringRuleId' | 'installmentGroupId'>,
): Promise<Transaction[]> {
  const kind = seriesKindOf(transaction)
  if (kind === null) return []
  const seriesQuery =
    kind === 'recurring'
      ? query(transactionsCollection(uid), where('recurringRuleId', '==', transaction.recurringRuleId))
      : query(transactionsCollection(uid), where('installmentGroupId', '==', transaction.installmentGroupId))
  const snapshot = await getDocs(seriesQuery)
  return snapshot.docs.map((docSnapshot) => docSnapshot.data())
}

// O lançamento onde a ação começou está sempre no escopo — mesmo em
// 'pending' com ele já pago, já que foi nele que o usuário clicou.
function isInScope(candidate: Transaction, originalId: string, scope: SeriesScope): boolean {
  if (candidate.id === originalId) return true
  return scope === 'all' || !candidate.paid
}

// O que é propagado pros irmãos: valor, tipo, categoria, descrição e o
// vínculo (conta/cartão). O que NÃO é: a data cheia — cada ocorrência
// mantém o próprio mês, só o dia-do-mês passa a ser o novo (com clamp: dia
// 31 vira 28/29 em fevereiro) — e o `paid`, que é o estado individual de
// cada uma (confirmar um mês não confirma o ano inteiro).
function siblingPayload(
  sibling: Transaction,
  data: TransactionFormData,
  kind: SeriesKind,
): TransactionFormData {
  const { day: newDay } = parseDate(data.date)
  const { year, month1based } = parseDate(sibling.date)
  const shifted = addMonthsClamped(year, month1based, newDay, 0)
  return {
    type: data.type,
    amount: data.amount,
    date: formatDate(shifted.year, shifted.month1based, shifted.day),
    description: describeFor(sibling, data, kind),
    categoryId: data.categoryId,
    paid: sibling.paid,
    ...(data.tags !== undefined ? { tags: data.tags } : {}),
    ...(data.accountId !== undefined ? { accountId: data.accountId } : { cardId: data.cardId }),
  }
}

function describeFor(
  occurrence: Pick<Transaction, 'installmentIndex' | 'installmentTotal'>,
  data: TransactionFormData,
  kind: SeriesKind,
): string {
  if (kind !== 'installment') return data.description
  const base = stripInstallmentSuffix(data.description)
  return `${base} (${occurrence.installmentIndex ?? 1}/${occurrence.installmentTotal ?? 1})`
}

// Sequencial, não Promise.all — mesmo motivo de deleteManyTransactions e
// confirmMany: cada updateTransaction abre sua própria runTransaction, e em
// paralelo elas disputariam o doc da conta vinculada (retries do Firestore).
export async function updateTransactionSeries(
  uid: string,
  original: Transaction,
  data: TransactionFormData,
  scope: SeriesScope,
): Promise<void> {
  const kind = seriesKindOf(original)
  if (kind === null || scope === 'one') {
    await updateTransaction(uid, original.id, data)
    return
  }

  const series = await fetchSeriesTransactions(uid, original)

  // A ocorrência editada usa a data exatamente como o usuário digitou (os
  // irmãos é que só herdam o dia-do-mês) e o `paid` que ele escolheu.
  await updateTransaction(uid, original.id, {
    ...data,
    description: describeFor(original, data, kind),
  })

  for (const sibling of series) {
    if (sibling.id === original.id) continue
    if (!isInScope(sibling, original.id, scope)) continue
    await updateTransaction(uid, sibling.id, siblingPayload(sibling, data, kind))
  }

  // As ocorrências ainda não geradas nascem da regra — sem atualizá-la, o
  // próximo topUpRecurringRules traria os valores antigos de volta. Vale
  // pros dois escopos: o que ainda vai ser gerado é futuro, logo pendente.
  if (kind === 'recurring' && original.recurringRuleId !== undefined) {
    await updateRecurringRuleFromOccurrence(uid, original.recurringRuleId, {
      type: data.type,
      amount: data.amount,
      description: data.description,
      categoryId: data.categoryId,
      dayOfMonth: parseDate(data.date).day,
      ...(data.tags !== undefined ? { tags: data.tags } : {}),
      ...(data.accountId !== undefined ? { accountId: data.accountId } : { cardId: data.cardId }),
    })
  }
}

export async function deleteTransactionSeries(
  uid: string,
  original: Transaction,
  scope: SeriesScope,
): Promise<void> {
  const kind = seriesKindOf(original)
  if (kind === null || scope === 'one') {
    await deleteTransaction(uid, original.id)
    return
  }

  const series = await fetchSeriesTransactions(uid, original)
  const ids = series.filter((t) => isInScope(t, original.id, scope)).map((t) => t.id)
  if (!ids.includes(original.id)) ids.push(original.id)

  // A regra sai ANTES das ocorrências: se algo falhar no meio, o pior caso
  // é sobrar lançamento pra apagar na mão — na ordem inversa, um erro
  // deixaria a regra viva e o topUp geraria tudo de novo no próximo acesso.
  if (kind === 'recurring' && original.recurringRuleId !== undefined) {
    await deleteRecurringRule(uid, original.recurringRuleId)
  }
  await deleteManyTransactions(uid, ids)
}
