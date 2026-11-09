import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, Landmark, RefreshCw } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from '../accounts/useAccounts'
import { useCategories } from '../categories/useCategories'
import { Button } from '../../components/ui/Button'
import { cn, formatBRL } from '../../lib/utils'
import { type BankHistory, type BankHistoryRow, HISTORY_DAYS_BACK, loadBankHistory } from './bankHistory'
import { BankHistorySheet } from './BankHistorySheet'
import { linkHistoryToTransaction } from './bankHistoryActions'

type Show = 'open' | 'all'

const HINT_LABELS: Record<NonNullable<BankHistoryRow['hint']>, string> = {
  caixinha: 'Parece caixinha',
  transfer: 'Parece transferência',
  billPayment: 'Parece pagamento de fatura',
  creditTopUp: 'Pix no crédito (só passagem)',
}

function statusLabel(row: BankHistoryRow): { text: string; className: string } {
  switch (row.status.kind) {
    case 'transaction':
      return { text: 'No controle', className: 'text-brand-500' }
    case 'transfer':
      return { text: 'Lançada como transferência', className: 'text-brand-500' }
    case 'caixinha':
      return { text: 'Lançada na caixinha', className: 'text-brand-500' }
    case 'similar':
      return {
        text: `Parece com "${row.status.transaction.description}"`,
        className: 'text-amber-600 dark:text-amber-400',
      }
    case 'ignored':
      return { text: 'Ignorada', className: 'text-light-secondary dark:text-dark-secondary' }
    case 'new':
      return { text: 'Falta lançar', className: 'text-danger' }
  }
}

function isOpen(row: BankHistoryRow): boolean {
  return row.status.kind === 'new' || row.status.kind === 'similar'
}

function dayLabel(date: string): string {
  return format(new Date(`${date}T00:00:00`), "EEEE, d 'de' MMMM", { locale: ptBR })
}

// Aba "Histórico do banco": o que as contas conectadas mostram no banco,
// pra escolher o que vira lançamento no controle. Cartão continua entrando
// sozinho pela sincronização.
export function BankHistoryPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { accounts } = useAccounts(workspaceId ?? '')
  const { categories } = useCategories(workspaceId ?? '')
  const [history, setHistory] = useState<BankHistory | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState<Show>('open')
  const [active, setActive] = useState<BankHistoryRow | null>(null)
  const [linking, setLinking] = useState(false)
  const accountFilter = params.get('conta') ?? 'all'

  const reload = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    try {
      setHistory(await loadBankHistory(workspaceId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível ler o banco.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void reload()
  }, [reload])

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

  const visible = useMemo(() => {
    if (!history) return []
    return history.rows.filter(
      (r) => (accountFilter === 'all' || r.accountId === accountFilter) && (show === 'all' || isOpen(r)),
    )
  }, [history, accountFilter, show])

  const openCount = useMemo(
    () =>
      history?.rows.filter((r) => isOpen(r) && (accountFilter === 'all' || r.accountId === accountFilter))
        .length ?? 0,
    [history, accountFilter],
  )

  const similar = useMemo(
    () =>
      history?.rows.filter(
        (r) => r.status.kind === 'similar' && (accountFilter === 'all' || r.accountId === accountFilter),
      ) ?? [],
    [history, accountFilter],
  )

  const byDay = useMemo(() => {
    const groups: { date: string; rows: BankHistoryRow[] }[] = []
    for (const row of visible) {
      const last = groups[groups.length - 1]
      if (last && last.date === row.date) last.rows.push(row)
      else groups.push({ date: row.date, rows: [row] })
    }
    return groups
  }, [visible])

  if (!user || !workspaceId) return null

  const linkedAccounts = history?.accounts ?? []
  const shownAccounts =
    accountFilter === 'all' ? linkedAccounts : linkedAccounts.filter((a) => a.accountId === accountFilter)

  // "Parece com" em lote: cada um vira o lançamento que você já tinha feito
  async function linkAllSimilar() {
    if (!workspaceId) return
    setLinking(true)
    setError(null)
    try {
      for (const row of similar)
        if (row.status.kind === 'similar') await linkHistoryToTransaction(workspaceId, row, row.status.transaction)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível vincular.')
    } finally {
      setLinking(false)
    }
  }

  function setAccountFilter(value: string) {
    const next = new URLSearchParams(params)
    if (value === 'all') next.delete('conta')
    else next.set('conta', value)
    setParams(next, { replace: true })
  }

  return (
    <div className="flex flex-col gap-5 px-6 pt-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Voltar"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-light-primary dark:text-dark-primary">
            Histórico do banco
          </h1>
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Toque numa movimentação pra trazer pro controle
          </p>
        </div>
        <button
          type="button"
          aria-label="Atualizar"
          disabled={loading}
          onClick={() => void reload()}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary disabled:opacity-60 dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
        >
          <RefreshCw size={16} className={cn(loading && 'animate-spin')} />
        </button>
      </div>

      <p className="rounded-2xl border border-border-light p-3 text-xs text-light-secondary dark:border-border-dark dark:text-dark-secondary">
        O banco manda as movimentações da conta com até 1 dia de atraso, então nada daqui entra sozinho no
        controle: lance na hora pelo app e use esta lista pra conferir o que faltou. Os cartões continuam
        entrando automaticamente. Mostra os últimos {HISTORY_DAYS_BACK} dias.
      </p>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {history?.errors.map((e) => (
        <p key={e} className="text-sm text-danger">
          {e}
        </p>
      ))}

      {history && linkedAccounts.length === 0 && !loading ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-light py-12 text-center dark:border-border-dark">
          <Landmark size={28} className="text-light-secondary dark:text-dark-secondary" />
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Nenhuma conta corrente vinculada na conexão bancária.
          </p>
          <Link to="/conexao-bancaria">
            <Button type="button" variant="secondary">
              Abrir conexão bancária
            </Button>
          </Link>
        </div>
      ) : null}

      {linkedAccounts.length > 1 ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1">
          {[{ accountId: 'all', label: 'Todas' }, ...linkedAccounts.map((a) => ({
            accountId: a.accountId,
            label: accountsById.get(a.accountId)?.name ?? a.bankName,
          }))].map((chip) => (
            <button
              key={chip.accountId}
              type="button"
              onClick={() => setAccountFilter(chip.accountId)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors duration-200',
                accountFilter === chip.accountId
                  ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                  : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}

      {shownAccounts.map((a) => {
        const account = accountsById.get(a.accountId)
        if (!account || typeof a.bankBalance !== 'number') return null
        const diff = Math.round((a.bankBalance - account.balance) * 100) / 100
        return (
          <div
            key={a.accountId}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border-light bg-surface-light p-3 text-sm dark:border-border-dark dark:bg-surface-dark-elevated"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-light-primary dark:text-dark-primary">{account.name}</p>
              <p className="text-xs text-light-secondary dark:text-dark-secondary">
                Banco: {formatBRL(a.bankBalance)} · App: {formatBRL(account.balance)}
              </p>
              {diff !== 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Diferença de {formatBRL(diff)} (pode ser algo que o banco ainda não mandou)
                </p>
              ) : (
                <p className="text-xs text-brand-500">Saldo igual ao do banco</p>
              )}
            </div>
            {diff !== 0 ? (
              <Link to={`/contas/${account.id}/ajustar`} className="shrink-0 text-xs font-medium text-brand-500">
                Ajustar saldo
              </Link>
            ) : null}
          </div>
        )
      })}

      {history && linkedAccounts.length > 0 ? (
        <div className="flex items-center gap-2">
          {(['open', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setShow(value)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors duration-200',
                show === value
                  ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                  : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
              )}
            >
              {value === 'open' ? `Falta lançar (${openCount})` : 'Tudo'}
            </button>
          ))}
        </div>
      ) : null}

      {similar.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="text-light-primary dark:text-dark-primary">
            {similar.length === 1
              ? '1 movimentação parece com algo que você já lançou.'
              : `${similar.length} movimentações parecem com algo que você já lançou.`}{' '}
            Confira na lista (“Parece com…”) ou vincule todas de uma vez: cada lançamento fica com o valor e a
            data do banco.
          </p>
          <Button type="button" variant="secondary" disabled={linking || loading} onClick={() => void linkAllSimilar()}>
            {linking ? 'Vinculando...' : `Vincular ${similar.length === 1 ? 'a parecida' : `as ${similar.length} parecidas`}`}
          </Button>
        </div>
      ) : null}

      {loading && !history ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated"
            />
          ))}
        </div>
      ) : null}

      {history && linkedAccounts.length > 0 && visible.length === 0 && !loading ? (
        <p className="rounded-2xl border border-dashed border-border-light py-10 text-center text-sm text-light-secondary dark:border-border-dark dark:text-dark-secondary">
          {show === 'open' ? 'Tudo do banco já está no controle.' : 'Nenhuma movimentação no período.'}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 pb-6">
        {byDay.map((group) => (
          <section key={group.date} className="flex flex-col gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-light-secondary dark:text-dark-secondary">
              {dayLabel(group.date)}
            </h2>
            <ul className="flex flex-col overflow-hidden rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated">
              {group.rows.map((row) => {
                const status = statusLabel(row)
                const account = accountsById.get(row.accountId)
                return (
                  <li key={row.docId} className="border-b border-border-light last:border-b-0 dark:border-border-dark">
                    <button
                      type="button"
                      onClick={() => setActive(row)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-border-light dark:hover:bg-border-dark"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-light-primary dark:text-dark-primary">
                          {row.description}
                        </p>
                        <p className="truncate text-xs text-light-secondary dark:text-dark-secondary">
                          {[
                            linkedAccounts.length > 1 ? account?.name : undefined,
                            row.counterpart,
                            row.pending ? 'Pendente no banco' : undefined,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        <p className="truncate text-xs">
                          <span className={status.className}>{status.text}</span>
                          {row.hint && isOpen(row) ? (
                            <span className="text-light-secondary dark:text-dark-secondary">
                              {' · '}
                              {HINT_LABELS[row.hint]}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <p
                        className={cn(
                          'shrink-0 text-sm font-semibold',
                          row.type === 'income' ? 'text-brand-500' : 'text-light-primary dark:text-dark-primary',
                        )}
                      >
                        {row.type === 'income' ? '+' : '−'}
                        {formatBRL(row.amount)}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {active ? (
        <BankHistorySheet
          workspaceId={workspaceId}
          createdBy={user.uid}
          row={active}
          accounts={accounts}
          categories={categories}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null)
            void reload()
          }}
        />
      ) : null}
    </div>
  )
}
