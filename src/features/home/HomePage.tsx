import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, MoreHorizontal, Plus, Receipt } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from '../accounts/useAccounts'
import { useTransactions } from '../transactions/useTransactions'
import { BalanceteCard } from '../transactions/BalanceteCard'
import { currentYearMonth } from '../transactions/dateUtils'
import { useCards } from '../cards/useCards'
import { InvoicesSummaryCard } from '../cards/InvoicesSummaryCard'
import { computeInvoiceMonth } from '../cards/invoiceUtils'
import { useCategories } from '../categories/useCategories'
import { CategorySpendingCard } from '../categories/CategorySpendingCard'
import { useBudgets } from '../budgets/useBudgets'
import { BudgetsSummaryCard } from '../budgets/BudgetsSummaryCard'
import { UpcomingBillsCard } from '../reminders/UpcomingBillsCard'
import { MonthSelector } from '../../components/ui/MonthSelector'
import { formatBRL } from '../../lib/utils'

const quickActions = [
  { label: 'Adicionar', icon: Plus, to: '/registros/novo' },
  { label: 'Fatura', icon: FileText, to: '/cartoes' },
  { label: 'Extrato', icon: Receipt, to: '/registros' },
  { label: 'Mais', icon: MoreHorizontal, to: '/perfil' },
] as const

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

  if (!user || !workspaceId) return null

  const totalBalance = accounts
    .filter((account) => account.includeInTotal)
    .reduce((sum, account) => sum + account.balance, 0)

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <Link
        to="/saldo"
        className="block rounded-2xl border border-border-light bg-surface-light p-6 transition-all duration-200 hover:border-brand-500 dark:border-border-dark dark:bg-gradient-to-b dark:from-surface-dark dark:to-surface-dark-elevated"
      >
        <p className="text-sm text-light-secondary dark:text-dark-secondary">Saldo atual</p>
        <p className="mt-2 text-3xl font-semibold text-light-primary dark:text-dark-primary">
          {loading ? '···' : formatBRL(totalBalance)}
        </p>
        <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">
          {accounts.length === 0 ? 'Nenhuma conta conectada ainda' : `${accounts.length} conta(s)`}
        </p>
      </Link>

      <section className="flex justify-between">
        {quickActions.map(({ label, icon: Icon, to }) => (
          <Link key={label} to={to} className="flex flex-col items-center gap-2">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-border-light bg-surface-light text-brand-500 transition-all duration-200 hover:shadow-[0_0_20px_var(--color-brand-glow)] dark:border-border-dark dark:bg-surface-dark-elevated">
              <Icon size={24} />
            </span>
            <span className="text-xs text-light-secondary dark:text-dark-secondary">{label}</span>
          </Link>
        ))}
      </section>

      <UpcomingBillsCard transactions={transactions} cards={cards} />

      <MonthSelector value={selectedMonth} onChange={setSelectedMonth} />

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
