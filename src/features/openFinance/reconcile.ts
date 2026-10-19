import { doc, increment, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { accountDoc } from '../accounts/api'
import { caixinhaDoc } from '../caixinhas/api'
import { caixinhaMovementDoc } from '../caixinhas/movements'
import type { CaixinhaMovement } from '../caixinhas/types'
import { payCardInvoice } from '../cards/invoicePayment'
import { getInvoicePeriod, nextInvoicePeriod, sumUnpaid } from '../cards/invoiceUtils'
import type { CreditCard } from '../cards/types'
import { signedEffect, transactionDoc } from '../transactions/api'
import { roundToCents } from '../transactions/dateUtils'
import type { Transaction } from '../transactions/types'
import type { MatchPair, BankSide } from './matching'

// Grava o resultado da conciliação (matching.ts decide quem casa com quem).
// Tudo aqui também atualiza os objetos em memória que recebeu — a
// sincronização segue usando a mesma lista pras próximas contas/cartões.

const BATCH_LIMIT = 450 // folga sob o limite de 500 operações do writeBatch

// O lançamento do app vira "o" lançamento do banco: ganha o vínculo
// (bankRef), passa pra data em que o banco registrou e, numa conta, fica
// pago — se estava pendente, só agora mexe no saldo.
function linkUpdates(manual: Transaction, bank: BankSide, isAccount: boolean) {
  const becomesPaid = isAccount && !manual.paid
  return {
    patch: {
      bankRef: bank.key,
      date: bank.date,
      ...(becomesPaid ? { paid: true } : {}),
    },
    balanceDelta: becomesPaid ? signedEffect(manual.type, manual.amount) : 0,
  }
}

function applyInMemory(manual: Transaction, patch: { bankRef: string; date: string; paid?: boolean }) {
  manual.bankRef = patch.bankRef
  manual.date = patch.date
  if (patch.paid) manual.paid = true
}

// Lançamento novo do banco que já existe no app → só vincula, não importa.
export async function linkManualToBank(
  workspaceId: string,
  pairs: MatchPair<BankSide>[],
  accountId: string | undefined,
): Promise<void> {
  for (let start = 0; start < pairs.length; start += BATCH_LIMIT) {
    const batch = writeBatch(db)
    let balanceDelta = 0
    for (const { bank, manual } of pairs.slice(start, start + BATCH_LIMIT)) {
      const update = linkUpdates(manual, bank, accountId !== undefined)
      batch.update(transactionDoc(workspaceId, manual.id), update.patch)
      balanceDelta += update.balanceDelta
      applyInMemory(manual, update.patch)
    }
    if (accountId !== undefined && balanceDelta !== 0) {
      batch.update(accountDoc(workspaceId, accountId), {
        balance: increment(roundToCents(balanceDelta)),
      })
    }
    await batch.commit()
  }
}

// Duplicata que já entrou (importada do banco E lançada no app): fica o
// lançamento do app (categoria/descrição que a pessoa escolheu), vinculado
// ao do banco; o importado sai, devolvendo o efeito dele no saldo e na
// caixinha (reserva do Mercado Pago — ver caixinhaSync.ts).
export async function mergeImportedDuplicates(
  workspaceId: string,
  pairs: MatchPair<BankSide & { imported: Transaction }>[],
  accountId: string | undefined,
  movementsById: Map<string, CaixinhaMovement>,
  transactions: Transaction[],
): Promise<void> {
  for (let start = 0; start < pairs.length; start += BATCH_LIMIT / 3) {
    const batch = writeBatch(db)
    let balanceDelta = 0
    for (const { bank, manual } of pairs.slice(start, start + BATCH_LIMIT / 3)) {
      const imported = bank.imported
      batch.delete(transactionDoc(workspaceId, imported.id))
      if (accountId !== undefined && imported.paid)
        balanceDelta -= signedEffect(imported.type, imported.amount)

      const movement = movementsById.get(`bank_${imported.id}`)
      if (movement) {
        batch.update(caixinhaDoc(workspaceId, movement.caixinhaId), {
          balance: increment(-movement.amount),
        })
        batch.delete(caixinhaMovementDoc(workspaceId, movement.id))
        movementsById.delete(movement.id)
      }

      const update = linkUpdates(manual, bank, accountId !== undefined)
      // cartão: se o importado já estava numa fatura paga, o do app que
      // fica no lugar dele também está — senão a fatura reabriria.
      const patch = accountId === undefined && imported.paid ? { ...update.patch, paid: true } : update.patch
      batch.update(transactionDoc(workspaceId, manual.id), patch)
      balanceDelta += update.balanceDelta
      applyInMemory(manual, patch)

      const index = transactions.indexOf(imported)
      if (index >= 0) transactions.splice(index, 1)
    }
    if (accountId !== undefined && balanceDelta !== 0) {
      batch.update(accountDoc(workspaceId, accountId), {
        balance: increment(roundToCents(balanceDelta)),
      })
    }
    await batch.commit()
  }
}

// Débito de "pagamento de fatura" na conta sem nenhum "Pagar fatura" no
// app: paga sozinho a fatura (já fechada) de cartão cujo valor em aberto é
// exatamente esse — o mesmo que a pessoa faria em "Pagar fatura". Só age
// quando há exatamente uma fatura com esse valor; senão não arrisca.
export async function autoPayCardBill(params: {
  workspaceId: string
  bank: BankSide
  accountId: string
  cards: CreditCard[]
  transactions: Transaction[]
  categoryId: string
  createdBy: string
}): Promise<boolean> {
  const { bank, cards, transactions } = params
  const candidates: {
    card: CreditCard
    items: Transaction[]
    periodEnd: string
  }[] = []

  for (const card of cards) {
    const byPeriod = new Map<string, Transaction[]>()
    for (const t of transactions) {
      if (t.cardId !== card.id || t.paid) continue
      const period = getInvoicePeriod(card.closingDay, t.date)
      // só fatura já fechada até o dia do pagamento
      if (period.end >= bank.date) continue
      const items = byPeriod.get(period.end) ?? []
      items.push(t)
      byPeriod.set(period.end, items)
    }
    for (const [periodEnd, items] of byPeriod) {
      if (Math.abs(sumUnpaid(items) - bank.amount) < 0.01) candidates.push({ card, items, periodEnd })
    }
  }
  if (candidates.length !== 1) return false

  const [{ card, items, periodEnd }] = candidates as [(typeof candidates)[number]]
  const { paymentTransactionId } = await payCardInvoice(params.workspaceId, {
    cardId: card.id,
    cardName: card.name,
    accountId: params.accountId,
    categoryId: params.categoryId,
    amountPaid: roundToCents(bank.amount),
    paymentDate: bank.date,
    unpaidTransactionIds: items.map((t) => t.id),
    nextPeriodStart: nextInvoicePeriod(card.closingDay, getInvoicePeriod(card.closingDay, periodEnd)).start,
    createdBy: params.createdBy,
  })

  const batch = writeBatch(db)
  batch.update(doc(db, 'users', params.workspaceId, 'transactions', paymentTransactionId), {
    bankRef: bank.key,
  })
  await batch.commit()

  for (const t of items) t.paid = true
  transactions.push({
    id: paymentTransactionId,
    type: 'expense',
    amount: roundToCents(bank.amount),
    date: bank.date,
    description: `Pagamento fatura ${card.name}`,
    categoryId: params.categoryId,
    paid: true,
    accountId: params.accountId,
    paidTransactionIds: items.map((t) => t.id),
    bankRef: bank.key,
    createdBy: params.createdBy,
  })
  return true
}
