import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Settings } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from './useAccounts'
import { useTransactions } from '../transactions/useTransactions'
import { useCategories } from '../categories/useCategories'
import { useCards } from '../cards/useCards'
import { useCaixinhas } from '../caixinhas/useCaixinhas'
import { CaixinhaCard } from '../caixinhas/CaixinhaCard'
import { TransactionsGrid } from '../transactions/TransactionsGrid'
import { MonthSelector } from '../../components/ui/MonthSelector'
import { currentYearMonth } from '../transactions/dateUtils'
import { ACCOUNT_TYPE_LABELS } from './types'
import { Button } from '../../components/ui/Button'
import { formatBRL } from '../../lib/utils'
import { useUserProfiles } from '../family/useUserProfiles'

export function AccountDetailPage() {
  const navigate = useNavigate()
  const { accountId } = useParams<{ accountId: string }>()
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const family = useWorkspaceStore((state) => state.family)
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth())

  const { accounts, loading: loadingAccounts } = useAccounts(workspaceId ?? '')
  const { transactions } = useTransactions(workspaceId ?? '')
  const { categories } = useCategories(workspaceId ?? '')
  const { cards } = useCards(workspaceId ?? '')
  const {
    caixinhas,
    loading: loadingCaixinhas,
    error: caixinhasError,
  } = useCaixinhas(workspaceId ?? '', accountId ?? '')

  const account = accounts.find((a) => a.id === accountId)
  const profiles = useUserProfiles(family && account ? [account.createdBy] : [])
  const authorName = family && account ? profiles.get(account.createdBy)?.displayName : undefined

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  const accountTransactions = useMemo(
    () => transactions.filter((t) => t.accountId === accountId),
    [transactions, accountId],
  )

  if (!user || !workspaceId) return null

  if (!loadingAccounts && !account) {
    navigate('/contas', { replace: true })
    return null
  }

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Voltar"
          onClick={() => navigate('/contas')}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-light-primary dark:text-dark-primary">
            {account ? account.name : 'Carregando...'}
          </h1>
          {account ? (
            <p className="text-sm text-light-secondary dark:text-dark-secondary">
              {ACCOUNT_TYPE_LABELS[account.type]} · {formatBRL(account.balance)}
              {authorName ? ` · Adicionado por ${authorName}` : ''}
            </p>
          ) : null}
        </div>
        {account ? (
          <div className="relative">
            <button
              type="button"
              aria-label="Mais opções"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
            >
              <Settings size={16} />
            </button>
            {menuOpen ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-11 z-20 flex w-48 flex-col overflow-hidden rounded-xl border border-border-light bg-surface-light shadow-lg dark:border-border-dark dark:bg-surface-dark-elevated">
                  <Link
                    to={`/contas/${account.id}/editar`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Editar conta
                  </Link>
                  <Link
                    to={`/contas/${account.id}/ajustar`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Ajuste de saldo
                  </Link>
                  <Link
                    to={`/contas/transferir?from=${account.id}`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Transferir para outra conta
                  </Link>
                  <Link
                    to={`/contas/${account.id}/importar`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Importar extrato
                  </Link>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {loadingAccounts || !account ? (
        <div className="h-40 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex flex-col gap-4 lg:w-2/3">
            <MonthSelector value={selectedMonth} onChange={setSelectedMonth} />
            <TransactionsGrid
              workspaceId={workspaceId ?? ''}
              transactions={accountTransactions}
              categoriesById={categoriesById}
              accountsById={accountsById}
              cardsById={cardsById}
              selectedMonth={selectedMonth}
            />
          </div>

          <div className="flex flex-col gap-3 lg:w-1/3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-light-primary dark:text-dark-primary">
                Caixinhas
              </h2>
              <Link to={`/contas/${account.id}/caixinhas/nova`}>
                <Button type="button" variant="secondary" className="gap-1 px-2 py-1 text-xs">
                  <Plus size={14} />
                  Nova caixinha
                </Button>
              </Link>
            </div>

            {caixinhasError ? (
              <p className="text-sm text-danger">
                Não foi possível carregar as caixinhas. Verifique se as regras do Firestore foram
                publicadas.
              </p>
            ) : loadingCaixinhas ? (
              <div className="h-24 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
            ) : caixinhas.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border-light py-6 text-center text-xs text-light-secondary dark:border-border-dark dark:text-dark-secondary">
                Nenhuma caixinha nesta conta.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {caixinhas.map((caixinha) => (
                  <CaixinhaCard key={caixinha.id} caixinha={caixinha} accountId={account.id} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
