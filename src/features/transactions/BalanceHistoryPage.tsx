import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowDownCircle, ArrowLeft, ArrowUpCircle, LineChart } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from '../accounts/useAccounts'
import { useTransactions } from './useTransactions'
import { buildBalanceHistory } from './balanceHistory'
import { BalanceChart } from './BalanceChart'
import { Card } from '../../components/ui/Card'
import { cn, formatBRL } from '../../lib/utils'
import { MonthSelector } from '../../components/ui/MonthSelector'
import { currentYearMonth } from './dateUtils'
import { FilterStatCards, type FilterStat } from './FilterStatCards'
import { MoneyMovementRowCard } from './MoneyMovementRowCard'
import { moneyMovementRows, useMoneyMovements, type MoneyMovementRow } from '../categories/moneyMovements'
import type { BalanceMovement } from './balanceHistory'

// Mesmos cards-filtro do extrato: Saldo lista tudo (transferências e
// reservas só pra conferência, sem somar), Reserva só guardar/resgatar.
type Filter = 'income' | 'expense' | 'all' | 'reserve'

type ListItem =
  | { kind: 'balance'; key: string; date: string; movement: BalanceMovement }
  | { kind: 'money'; key: string; date: string; row: MoneyMovementRow }

function displayDate(date: string): string {
  return format(new Date(`${date}T00:00:00`), "d 'de' MMM, yyyy", { locale: ptBR })
}

export function BalanceHistoryPage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { accounts, loading } = useAccounts(workspaceId ?? '')
  const { transactions } = useTransactions(workspaceId ?? '')

  const history = useMemo(() => buildBalanceHistory(transactions, accounts), [transactions, accounts])
  const moneyMovements = useMoneyMovements(workspaceId ?? '')
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth())
  const [filter, setFilter] = useState<Filter>('all')

  const { stats, items } = useMemo(() => {
    const includedIds = new Set(accounts.filter((a) => a.includeInTotal).map((a) => a.id))
    const ofMonth = history.movements.filter((m) => m.date.startsWith(selectedMonth))
    const rows = moneyMovementRows(moneyMovements, selectedMonth).filter(
      (r) => r.accountId !== undefined && includedIds.has(r.accountId),
    )
    const incomes = ofMonth.filter((m) => m.type === 'income').reduce((sum, m) => sum + m.amount, 0)
    const expenses = ofMonth.filter((m) => m.type === 'expense').reduce((sum, m) => sum + m.amount, 0)
    const reserves = rows.filter((r) => r.kind === 'reserve')
    const reserved = reserves.reduce((sum, r) => sum + (r.direction === 'out' ? r.amount : -r.amount), 0)
    const resultado = incomes - expenses
    const stats: FilterStat<Filter>[] = [
      { value: 'income', label: 'Receitas', amount: incomes, tone: 'text-brand-500' },
      { value: 'expense', label: 'Despesas', amount: expenses, tone: 'text-danger' },
      { value: 'all', label: 'Saldo', amount: resultado, tone: resultado >= 0 ? 'text-brand-500' : 'text-danger' },
      { value: 'reserve', label: 'Reserva', amount: reserved, tone: 'text-light-primary dark:text-dark-primary' },
    ]

    const balanceItems: ListItem[] = ofMonth
      .filter((m) => filter === 'all' || m.type === filter)
      .map((m) => ({ kind: 'balance', key: m.id, date: m.date, movement: m }))
    const moneyItems: ListItem[] = (filter === 'all' ? rows : filter === 'reserve' ? reserves : []).map((r) => ({
      kind: 'money',
      key: r.key,
      date: r.date,
      row: r,
    }))
    // ordem estável: dentro do mesmo dia, mantém a ordem do histórico
    const items = [...balanceItems, ...moneyItems].sort((a, b) => b.date.localeCompare(a.date))
    return { stats, items }
  }, [accounts, history.movements, moneyMovements, selectedMonth, filter])
  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])

  if (!user || !workspaceId) return null

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Voltar"
          onClick={() => navigate('/')}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">Saldo atual</h1>
      </div>

      <section className="rounded-2xl border border-border-light bg-surface-light p-6 dark:border-border-dark dark:bg-gradient-to-b dark:from-surface-dark dark:to-surface-dark-elevated">
        <p className="text-sm text-light-secondary dark:text-dark-secondary">Saldo atual</p>
        <p className="mt-2 text-3xl font-semibold text-light-primary dark:text-dark-primary">
          {loading ? '···' : formatBRL(history.currentTotal)}
        </p>
        <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">
          Soma das contas que entram no total
        </p>
      </section>

      {history.series.length >= 2 ? (
        <Card className="flex flex-col gap-3">
          <p className="text-sm font-medium text-light-primary dark:text-dark-primary">
            Evolução do saldo
          </p>
          <BalanceChart series={history.series} />
        </Card>
      ) : null}

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-light-primary dark:text-dark-primary">Movimentações</p>
        <MonthSelector value={selectedMonth} onChange={setSelectedMonth} />
        <FilterStatCards stats={stats} selected={filter} onSelect={setFilter} />
        {history.movements.length === 0 && items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-light py-16 text-center dark:border-border-dark">
            <LineChart size={32} className="text-light-secondary dark:text-dark-secondary" />
            <p className="text-sm text-light-secondary dark:text-dark-secondary">
              Nenhuma movimentação registrada ainda.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-light py-10 text-center text-sm text-light-secondary dark:border-border-dark dark:text-dark-secondary">
            Nada neste mês.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              if (item.kind === 'money') {
                return (
                  <Card key={item.key} className="overflow-hidden p-0">
                    <MoneyMovementRowCard row={item.row} linkedName={accountNames.get(item.row.accountId ?? '')} />
                  </Card>
                )
              }
              const m = item.movement
              const positive = m.effect >= 0
              const Icon = positive ? ArrowUpCircle : ArrowDownCircle
              return (
                <Card key={m.id} className="flex items-center gap-3 p-3">
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      positive ? 'bg-brand-500/10 text-brand-500' : 'bg-danger/10 text-danger',
                    )}
                  >
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-light-primary dark:text-dark-primary">
                      {m.description}
                    </p>
                    <p className="truncate text-xs text-light-secondary dark:text-dark-secondary">
                      {displayDate(m.date)}
                      {m.accountName ? ` · ${m.accountName}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn('text-sm font-semibold', positive ? 'text-brand-500' : 'text-danger')}>
                      {positive ? '+' : '-'}
                      {formatBRL(m.amount)}
                    </p>
                    <p className="text-xs text-light-secondary dark:text-dark-secondary">
                      Saldo: {formatBRL(m.balanceAfter)}
                    </p>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
