import { useMemo } from 'react'
import { CheckCircle2, AlertCircle, XCircle } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from '../accounts/useAccounts'
import { useAllCaixinhas } from '../caixinhas/useCaixinhas'
import { useCards } from '../cards/useCards'
import { useDebts } from '../debts/useDebts'
import { useTransactions } from '../transactions/useTransactions'
import { currentYearMonth } from '../transactions/dateUtils'
import { Card } from '../../components/ui/Card'
import { cn, formatBRL } from '../../lib/utils'
import { computeFinancialHealth, computeNetWorth, type HealthLevel } from './financialHealth'

const LEVEL_STYLES: Record<HealthLevel, { icon: typeof CheckCircle2; className: string }> = {
  good: { icon: CheckCircle2, className: 'text-brand-500' },
  ok: { icon: AlertCircle, className: 'text-warning' },
  bad: { icon: XCircle, className: 'text-danger' },
}

function Row({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-light-secondary dark:text-dark-secondary">{label}</span>
      <span className={cn('font-medium', negative ? 'text-danger' : 'text-light-primary dark:text-dark-primary')}>
        {negative && value > 0 ? '-' : ''}
        {formatBRL(value)}
      </span>
    </div>
  )
}

// Medidor semicircular do score (0-100), SVG inline.
function ScoreGauge({ score, label }: { score: number; label: string }) {
  const radius = 70
  const circumference = Math.PI * radius
  const filled = (score / 100) * circumference
  const color = score >= 60 ? 'stroke-brand-500' : score >= 40 ? 'stroke-warning' : 'stroke-danger'
  return (
    <svg viewBox="0 0 180 105" className="mx-auto w-52" role="img" aria-label={`Saúde financeira ${score} de 100`}>
      <path
        d="M 20 95 A 70 70 0 0 1 160 95"
        fill="none"
        strokeWidth={14}
        strokeLinecap="round"
        className="stroke-border-light dark:stroke-border-dark"
      />
      <path
        d="M 20 95 A 70 70 0 0 1 160 95"
        fill="none"
        strokeWidth={14}
        strokeLinecap="round"
        className={color}
        strokeDasharray={`${filled} ${circumference}`}
      />
      <text x={90} y={80} textAnchor="middle" className="fill-light-primary text-[28px] font-semibold dark:fill-dark-primary">
        {score}
      </text>
      <text x={90} y={100} textAnchor="middle" className="fill-light-secondary text-[11px] dark:fill-dark-secondary">
        {label}
      </text>
    </svg>
  )
}

export function NetWorthPage() {
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { accounts, loading: l1 } = useAccounts(workspaceId ?? '')
  const { caixinhas, loading: l2 } = useAllCaixinhas(workspaceId ?? '')
  const { cards } = useCards(workspaceId ?? '')
  const { debts } = useDebts(workspaceId ?? '')
  const { transactions, loading: l3 } = useTransactions(workspaceId ?? '')

  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const netWorth = useMemo(
    () => computeNetWorth(accounts, caixinhas, cards, transactions, debts),
    [accounts, caixinhas, cards, transactions, debts],
  )
  const health = useMemo(
    () => computeFinancialHealth(netWorth, transactions, cardsById, currentYearMonth()),
    [netWorth, transactions, cardsById],
  )

  if (!user || !workspaceId) return null

  if (l1 || l2 || l3) {
    return (
      <div className="flex flex-col gap-6 px-6 pt-4">
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">Patrimônio</h1>
        <div className="h-48 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">Patrimônio</h1>

      <section className="rounded-2xl border border-border-light bg-surface-light p-6 dark:border-border-dark dark:bg-gradient-to-b dark:from-surface-dark dark:to-surface-dark-elevated">
        <p className="text-sm text-light-secondary dark:text-dark-secondary">Patrimônio líquido</p>
        <p className={cn('mt-2 text-3xl font-semibold', netWorth.net >= 0 ? 'text-light-primary dark:text-dark-primary' : 'text-danger')}>
          {formatBRL(netWorth.net)}
        </p>
        <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">Tudo o que você tem menos tudo o que deve</p>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-light-primary dark:text-dark-primary">Você tem</p>
            <p className="text-sm font-semibold text-brand-500">{formatBRL(netWorth.assets)}</p>
          </div>
          <Row label="Contas" value={netWorth.accounts} />
          <Row label="Caixinhas" value={netWorth.caixinhas} />
          <Row label="Te devem" value={netWorth.receivables} />
          <div className="mt-1 flex items-center justify-between border-t border-border-light pt-3 dark:border-border-dark">
            <p className="text-sm font-medium text-light-primary dark:text-dark-primary">Você deve</p>
            <p className="text-sm font-semibold text-danger">{formatBRL(netWorth.liabilities)}</p>
          </div>
          <Row label="Faturas em aberto" value={netWorth.cardDebt} negative />
          <Row label="Dívidas" value={netWorth.payables} negative />
        </Card>

        <Card className="flex flex-col gap-4">
          <p className="text-sm font-medium text-light-primary dark:text-dark-primary">Saúde financeira</p>
          {health.hasEnoughData ? (
            <>
              <ScoreGauge score={health.score} label={health.label} />
              <div className="flex flex-col gap-3">
                {health.indicators.map((indicator) => {
                  const { icon: Icon, className } = LEVEL_STYLES[indicator.level]
                  return (
                    <div key={indicator.key} className="flex gap-2">
                      <Icon size={18} className={cn('mt-0.5 shrink-0', className)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-light-primary dark:text-dark-primary">{indicator.label}</span>
                          <span className={cn('font-semibold', className)}>{indicator.value}</span>
                        </div>
                        <p className="text-xs text-light-secondary dark:text-dark-secondary">{indicator.tip}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-light-secondary dark:text-dark-secondary">
                Calculado com a média dos últimos 3 meses fechados.
              </p>
            </>
          ) : (
            <p className="text-sm text-light-secondary dark:text-dark-secondary">
              Registre receitas e despesas por pelo menos um mês completo para calcular sua saúde financeira.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
