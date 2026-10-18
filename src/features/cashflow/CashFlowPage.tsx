import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertTriangle } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from '../accounts/useAccounts'
import { useCards } from '../cards/useCards'
import { useTransactions } from '../transactions/useTransactions'
import { currentYearMonth } from '../transactions/dateUtils'
import { BalanceChart } from '../transactions/BalanceChart'
import { MonthSelector } from '../../components/ui/MonthSelector'
import { Card } from '../../components/ui/Card'
import { cn, formatBRL } from '../../lib/utils'
import { cashFlowEvents, projectCashFlow } from './cashFlowEvents'
import { FinancialCalendar } from './FinancialCalendar'

const HORIZONS = [30, 90, 180] as const
type Horizon = (typeof HORIZONS)[number]
type Tab = 'projecao' | 'calendario'

function displayDate(date: string): string {
  return format(new Date(`${date}T00:00:00`), "d 'de' MMM", { locale: ptBR })
}

export function CashFlowPage() {
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { accounts, loading: loadingAccounts } = useAccounts(workspaceId ?? '')
  const { cards } = useCards(workspaceId ?? '')
  const { transactions, loading } = useTransactions(workspaceId ?? '')
  const [tab, setTab] = useState<Tab>('projecao')
  const [horizon, setHorizon] = useState<Horizon>(90)
  const [month, setMonth] = useState(currentYearMonth())

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const events = useMemo(
    () => cashFlowEvents(transactions, cards, accountsById),
    [transactions, cards, accountsById],
  )
  const projection = useMemo(() => projectCashFlow(accounts, events, horizon), [accounts, events, horizon])

  if (!user || !workspaceId) return null

  const segmented = (active: boolean) =>
    cn(
      'flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-200',
      active
        ? 'border-brand-500 bg-brand-500/10 text-brand-500'
        : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
    )

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">Fluxo de caixa</h1>

      <div className="flex gap-2">
        <button type="button" className={segmented(tab === 'projecao')} onClick={() => setTab('projecao')}>
          Projeção
        </button>
        <button type="button" className={segmented(tab === 'calendario')} onClick={() => setTab('calendario')}>
          Calendário
        </button>
      </div>

      {loading || loadingAccounts ? (
        <div className="h-48 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
      ) : tab === 'calendario' ? (
        <>
          <MonthSelector value={month} onChange={setMonth} />
          <FinancialCalendar events={events} month={month} />
        </>
      ) : (
        <>
          <div className="flex gap-2">
            {HORIZONS.map((h) => (
              <button key={h} type="button" className={segmented(horizon === h)} onClick={() => setHorizon(h)}>
                {h} dias
              </button>
            ))}
          </div>

          {projection.firstNegative ? (
            <div className="flex items-start gap-2 rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <p>
                Pelas contas pendentes, o saldo fica negativo em {displayDate(projection.firstNegative.date)} (
                {formatBRL(projection.firstNegative.balance)}). Dá tempo de ajustar antes.
              </p>
            </div>
          ) : null}

          <Card className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="min-w-0">
                <p className="text-light-secondary dark:text-dark-secondary">Saldo hoje</p>
                <p className="truncate font-semibold text-light-primary dark:text-dark-primary">
                  {formatBRL(projection.startBalance)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-light-secondary dark:text-dark-secondary">Em {horizon} dias</p>
                <p
                  className={cn(
                    'truncate font-semibold',
                    projection.endBalance >= 0 ? 'text-brand-500' : 'text-danger',
                  )}
                >
                  {formatBRL(projection.endBalance)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-light-secondary dark:text-dark-secondary">Ponto mais baixo</p>
                <p
                  className={cn(
                    'truncate font-semibold',
                    projection.lowest.balance >= 0 ? 'text-light-primary dark:text-dark-primary' : 'text-danger',
                  )}
                >
                  {formatBRL(projection.lowest.balance)}
                </p>
                <p className="text-xs text-light-secondary dark:text-dark-secondary">
                  {displayDate(projection.lowest.date)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-light-secondary dark:text-dark-secondary">Atrasados</p>
                <p
                  className={cn(
                    'truncate font-semibold',
                    projection.overdueTotal < 0 ? 'text-danger' : 'text-light-primary dark:text-dark-primary',
                  )}
                >
                  {formatBRL(projection.overdueTotal)}
                </p>
                <p className="text-xs text-light-secondary dark:text-dark-secondary">considerados hoje</p>
              </div>
            </div>
            <BalanceChart series={projection.points} />
            <p className="text-xs text-light-secondary dark:text-dark-secondary">
              Considera o saldo das contas que entram no total, os lançamentos pendentes (inclusive fixos
              e parcelas futuras) e as faturas de cartão em aberto no dia do vencimento.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
