import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from '../accounts/useAccounts'
import { useTransactions } from '../transactions/useTransactions'
import { BalanceteCard } from '../transactions/BalanceteCard'
import { currentYearMonth } from '../transactions/dateUtils'
import { useCards } from '../cards/useCards'
import { InvoicesSummaryCard } from '../cards/InvoicesSummaryCard'
import { computeInvoiceMonth, effectiveMonth, todayDateString } from '../cards/invoiceUtils'
import { TransactionCompactCard } from '../transactions/TransactionCompactCard'
import { useCategories } from '../categories/useCategories'
import { CategorySpendingCard } from '../categories/CategorySpendingCard'
import { useBudgets } from '../budgets/useBudgets'
import { BudgetsSummaryCard } from '../budgets/BudgetsSummaryCard'
import { UpcomingBillsCard } from '../reminders/UpcomingBillsCard'
import { MonthSelector } from '../../components/ui/MonthSelector'
import { formatBRL } from '../../lib/utils'

const RECENT_COUNT = 5

export function HomePage() {
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { accounts, loading } = useAccounts(workspaceId ?? '')
  const { transactions } = useTransactions(workspaceId ?? '')
  const { cards } = useCards(workspaceId ?? '')
  const { categories } = useCategories(workspaceId ?? '')
  const { budgets } = useBudgets(workspaceId ?? '')
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth())
  const [invoiceOffset, setInvoiceOffset] = useState(-1)

  const invoiceMonth = useMemo(
    () => computeInvoiceMonth(cards, transactions, invoiceOffset),
    [cards, transactions, invoiceOffset],
  )
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  // Entrou/saiu: o que de fato mexeu nas contas no mês (mesmo critério do
  // balancete — cartão só conta quando a fatura é paga).
  const { entrou, saiu, pending, pendingTotal } = useMemo(() => {
    let entrou = 0
    let saiu = 0
    for (const t of transactions) {
      if (!t.paid || t.accountId === undefined || !t.date.startsWith(selectedMonth)) continue
      if (t.type === 'income') entrou += t.amount
      else saiu += t.amount
    }
    const pending = transactions.filter((t) => !t.paid && effectiveMonth(t, cardsById) === selectedMonth)
    const pendingTotal = pending.reduce((sum, t) => sum + t.amount, 0)
    return { entrou, saiu, pending, pendingTotal }
  }, [transactions, selectedMonth, cardsById])

  // O que acabou de ser lançado (até hoje — ignora parcelas/fixos futuros),
  // compras de cartão incluídas uma a uma: é aqui que a pessoa confere que
  // o registro entrou.
  const recent = useMemo(() => {
    const today = todayDateString()
    return transactions
      .filter((t) => t.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, RECENT_COUNT)
  }, [transactions])

  if (!user || !workspaceId) return null

  const totalBalance = accounts
    .filter((account) => account.includeInTotal)
    .reduce((sum, account) => sum + account.balance, 0)

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <MonthSelector value={selectedMonth} onChange={setSelectedMonth} />

      <Link
        to="/saldo"
        className="block rounded-3xl bg-brand-500 p-5 text-[#062a1e] transition-transform duration-200 active:scale-[0.99]"
      >
        <p className="text-sm opacity-80">Saldo atual</p>
        <p className="tabular mt-1 font-[family-name:var(--font-display)] text-4xl font-bold">
          {loading ? '···' : formatBRL(totalBalance)}
        </p>
        <div className="mt-4 flex gap-6 text-sm">
          <div>
            <p className="opacity-70">Entrou no mês</p>
            <p className="tabular font-semibold">{formatBRL(entrou)}</p>
          </div>
          <div>
            <p className="opacity-70">Saiu no mês</p>
            <p className="tabular font-semibold">{formatBRL(saiu)}</p>
          </div>
        </div>
        <p className="mt-3 text-xs opacity-70">
          {accounts.length === 0 ? 'Nenhuma conta cadastrada ainda' : `${accounts.length} conta(s) · toque para ver a evolução`}
        </p>
      </Link>

      {pending.length > 0 ? (
        <Link
          to="/registros/pendentes"
          className="flex items-center justify-between rounded-2xl border border-warning/30 bg-warning/10 p-4"
        >
          <div>
            <p className="font-semibold text-warning">
              {pending.length} pendente{pending.length > 1 ? 's' : ''} neste mês
            </p>
            <p className="text-sm text-light-secondary dark:text-dark-secondary">
              {formatBRL(pendingTotal)} para pagar ou receber
            </p>
          </div>
          <ChevronRight size={20} className="text-warning" />
        </Link>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-light-primary dark:text-dark-primary">Últimos lançamentos</h2>
          <Link to="/registros" className="text-sm font-medium text-brand-500">
            Ver extrato
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-light py-8 text-center text-sm text-light-secondary dark:border-border-dark dark:text-dark-secondary">
            Nada lançado ainda. Toque em + para registrar uma despesa ou receita.
          </div>
        ) : (
          <div className="divide-y divide-border-light overflow-hidden rounded-2xl border border-border-light bg-surface-light dark:divide-border-dark dark:border-transparent dark:bg-surface-dark-elevated">
            {recent.map((t) => (
              <TransactionCompactCard
                key={t.id}
                transaction={t}
                category={categoriesById.get(t.categoryId)}
                linkedName={
                  t.accountId !== undefined ? accountsById.get(t.accountId)?.name : cardsById.get(t.cardId ?? '')?.name
                }
              />
            ))}
          </div>
        )}
      </section>

      <UpcomingBillsCard transactions={transactions} cards={cards} />


      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BalanceteCard transactions={transactions} selectedMonth={selectedMonth} cardsById={cardsById} />
        <InvoicesSummaryCard offset={invoiceOffset} onOffsetChange={setInvoiceOffset} month={invoiceMonth} />
      </div>

      <CategorySpendingCard
        transactions={transactions}
        categories={categories}
        cardsById={cardsById}
        selectedMonth={selectedMonth}
      />

      <BudgetsSummaryCard
        budgets={budgets}
        transactions={transactions}
        categories={categories}
        cardsById={cardsById}
        selectedMonth={selectedMonth}
      />
    </div>
  )
}
