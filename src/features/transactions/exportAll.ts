import { getDocs } from 'firebase/firestore'
import { accountsCollection } from '../accounts/api'
import { cardsCollection } from '../cards/api'
import { categoriesCollection } from '../categories/api'
import { transactionsCollection } from './api'
import { downloadCsv, transactionsToCsv } from './exportCsv'

// Leitura única (getDocs, não onSnapshot) — o Perfil não precisa manter
// todas as coleções escutando só por causa de um botão.
export async function exportAllTransactionsCsv(uid: string): Promise<void> {
  const [transactions, categories, accounts, cards] = await Promise.all([
    getDocs(transactionsCollection(uid)),
    getDocs(categoriesCollection(uid)),
    getDocs(accountsCollection(uid)),
    getDocs(cardsCollection(uid)),
  ])
  const csv = transactionsToCsv(
    transactions.docs.map((d) => d.data()),
    {
      categoriesById: new Map(categories.docs.map((d) => [d.id, d.data()])),
      accountsById: new Map(accounts.docs.map((d) => [d.id, d.data()])),
      cardsById: new Map(cards.docs.map((d) => [d.id, d.data()])),
    },
  )
  const today = new Date().toISOString().slice(0, 10)
  downloadCsv(`pobreconsciente-lancamentos-${today}.csv`, csv)
}
