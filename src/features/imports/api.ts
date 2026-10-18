import { doc, increment, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { accountDoc } from '../accounts/api'
import { transactionsCollection, signedEffect } from '../transactions/api'
import { roundToCents } from '../transactions/dateUtils'
import type { ImportTarget, ReviewedEntry } from './types'

// Mesmo limite de operações por writeBatch já respeitado em resetUserData.ts.
const BATCH_LIMIT = 500

// `paid` significa coisas diferentes pra conta e pra cartão (mesma
// distinção de transactions/types.ts e invoiceUtils.ts/sumUnpaid): numa
// conta, `paid: true` é o normal — o extrato importado já afetou o saldo
// de verdade, então precisa entrar já refletido. Num cartão, `paid` só
// vira `true` quando a fatura daquele período é PAGA (payCardInvoice) —
// uma fatura importada representa cobranças ainda em aberto, então tem
// que nascer `paid: false`, senão sumUnpaid() (o que soma o valor da
// fatura) ignora essas linhas e a fatura não bate.
//
// Cria uma Transaction por entrada revisada e, se o alvo for uma conta,
// aplica o saldo resultante num único `increment()` atômico (soma de
// todos os efeitos assinados) — não precisa de runTransaction/leitura
// prévia porque é um delta simples, sem depender do saldo atual pra
// decidir o que escrever (diferente de createTransaction, que decide com
// base em estado lido).
export async function importTransactions(
  uid: string,
  entries: ReviewedEntry[],
  target: ImportTarget,
  createdBy: string,
): Promise<void> {
  if (entries.length === 0) return

  const accountId = 'accountId' in target ? target.accountId : undefined
  const cardId = 'cardId' in target ? target.cardId : undefined

  const totalDelta = accountId
    ? roundToCents(entries.reduce((sum, entry) => sum + signedEffect(entry.type, entry.amount), 0))
    : 0

  for (let start = 0; start < entries.length; start += BATCH_LIMIT) {
    const batch = writeBatch(db)
    const chunk = entries.slice(start, start + BATCH_LIMIT)

    for (const entry of chunk) {
      const ref = doc(transactionsCollection(uid))
      batch.set(ref, {
        id: ref.id,
        type: entry.type,
        amount: entry.amount,
        date: entry.date,
        description: entry.description,
        categoryId: entry.categoryId,
        paid: accountId !== undefined,
        createdBy,
        ...(entry.installmentIndex !== undefined
          ? { installmentIndex: entry.installmentIndex, installmentTotal: entry.installmentTotal }
          : {}),
        ...(entry.tags !== undefined && entry.tags.length > 0 ? { tags: entry.tags } : {}),
        ...(accountId !== undefined ? { accountId } : { cardId }),
      })
    }

    // saldo só precisa do incremento uma vez — aplicado junto do 1º chunk.
    if (start === 0 && accountId !== undefined && totalDelta !== 0) {
      batch.update(accountDoc(uid, accountId), { balance: increment(totalDelta) })
    }

    await batch.commit()
  }
}
