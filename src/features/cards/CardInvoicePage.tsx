import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, ChevronLeft, ChevronRight, ListChecks, Receipt, Settings, X } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useCards } from './useCards'
import { useTransactions } from '../transactions/useTransactions'
import { useCategories } from '../categories/useCategories'
import { deleteManyTransactions } from '../transactions/api'
import { TransactionCompactCard } from '../transactions/TransactionCompactCard'
import {
  getDueDate,
  getInvoicePeriod,
  shiftInvoicePeriod,
  sumUnpaid,
  todayDateString,
  transactionsInPeriod,
} from './invoiceUtils'
import { CARD_BRAND_LABELS } from './types'
import { Button } from '../../components/ui/Button'
import { formatBRL } from '../../lib/utils'
import { useUserProfiles } from '../family/useUserProfiles'

function formatDisplayDate(date: string): string {
  return format(new Date(`${date}T00:00:00`), "d 'de' MMM", { locale: ptBR })
}

export function CardInvoicePage() {
  const navigate = useNavigate()
  const { cardId } = useParams<{ cardId: string }>()
  const [searchParams] = useSearchParams()
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const family = useWorkspaceStore((state) => state.family)
  const { cards, loading: loadingCards } = useCards(workspaceId ?? '')
  const { transactions, loading: loadingTransactions } = useTransactions(workspaceId ?? '')
  const { categories } = useCategories(workspaceId ?? '')
  // Lê o offset inicial da URL (ex: link vindo do extrato agregado por
  // fatura) — depois disso o estado local assume, os chevrons continuam
  // navegando normalmente a partir daqui.
  const [periodOffset, setPeriodOffset] = useState(() => Number(searchParams.get('offset')) || 0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const card = cards.find((c) => c.id === cardId)
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const profiles = useUserProfiles(family && card ? [card.createdBy] : [])
  const authorName = family && card ? profiles.get(card.createdBy)?.displayName : undefined

  const period = useMemo(() => {
    if (!card) return null
    const openPeriod = getInvoicePeriod(card.closingDay, todayDateString())
    return shiftInvoicePeriod(card.closingDay, openPeriod, periodOffset)
  }, [card, periodOffset])

  const periodTransactions = useMemo(() => {
    if (!card || !period) return []
    return transactionsInPeriod(transactions, card.id, period).sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [card, period, transactions])

  const owed = useMemo(() => sumUnpaid(periodTransactions), [periodTransactions])
  const dueDate = card && period ? getDueDate(period.end, card.dueDay) : null

  function toggleSelectMode() {
    setSelectMode((mode) => !mode)
    setSelectedIds(new Set())
    setDeleteError(null)
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDeleteSelected() {
    if (!workspaceId || selectedIds.size === 0) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteManyTransactions(workspaceId, Array.from(selectedIds))
      setSelectMode(false)
      setSelectedIds(new Set())
    } catch {
      setDeleteError('Não foi possível apagar tudo. O que já foi apagado continua apagado — tente de novo.')
    } finally {
      setDeleting(false)
    }
  }

  if (!user || !workspaceId) return null

  if (!loadingCards && !card) {
    navigate('/cartoes', { replace: true })
    return null
  }

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Voltar"
          onClick={() => navigate('/cartoes')}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-light-primary dark:text-dark-primary">
            {card ? card.name : 'Carregando...'}
          </h1>
          {card ? (
            <p className="text-sm text-light-secondary dark:text-dark-secondary">
              {CARD_BRAND_LABELS[card.brand]}
              {authorName ? ` · Adicionado por ${authorName}` : ''}
            </p>
          ) : null}
        </div>
        {card ? (
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
                    to={`/cartoes/${card.id}/editar`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Editar cartão
                  </Link>
                  <Link
                    to={`/cartoes/${card.id}/fatura/ajustar?offset=${periodOffset}`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Ajuste de fatura
                  </Link>
                  <Link
                    to={`/cartoes/${card.id}/importar`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Importar fatura
                  </Link>
                  <Link
                    to={`/cartoes/${card.id}/corrigir-importacao?offset=${periodOffset}`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Corrigir cobranças pagas por engano
                  </Link>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {loadingCards || loadingTransactions || !card || !period ? (
        <div className="h-40 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
      ) : (
        <>
          <div className="flex flex-col gap-4 rounded-2xl border border-border-light bg-surface-light p-4 dark:border-border-dark dark:bg-gradient-to-b dark:from-surface-dark dark:to-surface-dark-elevated">
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                aria-label="Fatura anterior"
                onClick={() => setPeriodOffset((offset) => offset - 1)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
              >
                <ChevronLeft size={18} />
              </button>
              <p className="text-sm text-light-secondary dark:text-dark-secondary">
                {formatDisplayDate(period.start)} até {formatDisplayDate(period.end)}
                {dueDate ? ` · vence ${formatDisplayDate(dueDate)}` : ''}
              </p>
              <button
                type="button"
                aria-label="Próxima fatura"
                onClick={() => setPeriodOffset((offset) => offset + 1)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div>
              <p className="text-sm text-light-secondary dark:text-dark-secondary">Valor da fatura</p>
              <p className="text-2xl font-semibold text-light-primary dark:text-dark-primary">
                {formatBRL(owed)}
              </p>
            </div>

            {periodOffset <= 0 && owed > 0 ? (
              <Link to={`/cartoes/${card.id}/fatura/pagar?offset=${periodOffset}`}>
                <Button type="button" className="w-full">
                  Pagar
                </Button>
              </Link>
            ) : null}
          </div>

          {periodTransactions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-light py-16 text-center dark:border-border-dark">
              <Receipt size={32} className="text-light-secondary dark:text-dark-secondary" />
              <p className="text-sm text-light-secondary dark:text-dark-secondary">
                Nenhuma movimentação nesta fatura.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={toggleSelectMode}
                  className="flex items-center gap-1.5 text-xs text-light-secondary transition-colors duration-200 hover:text-light-primary dark:text-dark-secondary dark:hover:text-dark-primary"
                >
                  {selectMode ? <X size={14} /> : <ListChecks size={14} />}
                  {selectMode ? 'Cancelar seleção' : 'Selecionar'}
                </button>
              </div>

              <div className="rounded-2xl border border-border-light bg-surface-light divide-y divide-border-light overflow-hidden dark:border-transparent dark:bg-surface-dark-elevated dark:divide-border-dark">
                {periodTransactions.map((transaction) => (
                  <TransactionCompactCard
                    key={transaction.id}
                    transaction={transaction}
                    category={categoriesById.get(transaction.categoryId)}
                    linkedName={undefined}
                    selectMode={selectMode}
                    selected={selectedIds.has(transaction.id)}
                    onToggleSelect={() => toggleSelected(transaction.id)}
                  />
                ))}
              </div>

              {selectMode ? (
                <div className="flex flex-col gap-2 rounded-2xl border border-border-light bg-surface-light p-3 dark:border-border-dark dark:bg-surface-dark-elevated">
                  {deleteError ? <p className="text-sm text-danger">{deleteError}</p> : null}
                  <Button
                    type="button"
                    className="w-full bg-danger hover:bg-danger hover:shadow-none"
                    disabled={selectedIds.size === 0 || deleting}
                    onClick={handleDeleteSelected}
                  >
                    {deleting ? 'Apagando...' : `Apagar ${selectedIds.size} selecionado(s)`}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  )
}
