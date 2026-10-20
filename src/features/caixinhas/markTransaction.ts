import { getDocs } from 'firebase/firestore'
import { applyBankReserves, type ReserveItem } from '../openFinance/caixinhaSync'
import { transactionsCollection } from '../transactions/api'
import type { Transaction } from '../transactions/types'
import { descriptionPattern, saveCaixinhaRule } from './rules'

// Movimentação da conta que pode ser marcada como caixinha: já paga (o
// dinheiro saiu/entrou de verdade) e avulsa — recorrência e parcelamento
// são gasto/receita de fato.
export function canMarkAsCaixinha(t: Transaction): t is Transaction & { accountId: string } {
  return (
    t.accountId !== undefined &&
    t.paid &&
    t.recurringRuleId === undefined &&
    t.installmentGroupId === undefined &&
    t.paidTransactionIds === undefined
  )
}

// As outras movimentações já lançadas que a mesma regra pegaria: mesma
// conta, mesmo sentido, mesma descrição.
export function similarTransactions(transaction: Transaction, all: Transaction[]): Transaction[] {
  const pattern = descriptionPattern(transaction.description)
  if (!pattern || transaction.accountId === undefined) return []
  return all.filter(
    (t) =>
      t.id !== transaction.id &&
      canMarkAsCaixinha(t) &&
      t.accountId === transaction.accountId &&
      t.type === transaction.type &&
      descriptionPattern(t.description) === pattern,
  )
}

// "Esta movimentação é a caixinha X": grava a regra (as próximas iguais
// vindas do banco já vão direto pra caixinha) e converte esta e as iguais
// já lançadas — saem do extrato e dos totais do mês, o valor entra (ou
// sai) da caixinha. O saldo da conta não muda: o dinheiro já tinha saído
// (ou entrado) nela. Mesmo caminho da conexão bancária pra lançamentos
// importados antes de caixinha virar reserva (caixinhaSync.ts).
// Devolve quantas movimentações foram convertidas.
export async function markTransactionAsCaixinha(
  workspaceId: string,
  transaction: Transaction & { accountId: string },
  caixinhaId: string,
  createdBy: string,
): Promise<number> {
  // descrição só de números/pontuação não dá regra — converte só esta
  if (descriptionPattern(transaction.description)) {
    await saveCaixinhaRule(workspaceId, transaction.accountId, transaction, caixinhaId, createdBy)
  }
  const all = (await getDocs(transactionsCollection(workspaceId))).docs.map((d) => d.data())
  const targets = [transaction, ...similarTransactions(transaction, all)]
  const items: ReserveItem[] = targets.map((t) => ({
    key: t.id,
    accountId: transaction.accountId,
    date: t.date,
    amount: t.amount,
    movement: { kind: t.type === 'expense' ? 'guardar' : 'resgatar', caixinhaId },
    legacyTransactionId: t.id,
  }))
  await applyBankReserves(workspaceId, items, createdBy)
  return targets.length
}
