import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, ChevronLeft, ChevronRight, ListChecks, Receipt, Settings } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useCards } from './useCards'
import { useTransactions } from '../transactions/useTransactions'
import { useCategories } from '../categories/useCategories'
import { TransactionCompactCard } from '../transactions/TransactionCompactCard'
import { SelectionActionsBar } from '../transactions/SelectionActionsBar'
import { useTransactionSelection } from '../transactions/useTransactionSelection'
import { collectTags } from '../transactions/tags'
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

  // Segurar uma compra (ou "Selecionar") entra no modo seleção, com as
  // ações em massa — sem Pago/Pendente: no cartão quem paga é a fatura.
  const selection = useTransactionSelection(periodTransactions, String(periodOffset))
  const knownTags = useMemo(() => collectTags(transactions), [transactions])

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
              {selection.active ? (
                <SelectionActionsBar
                  workspaceId={workspaceId}
                  selection={selection}
                  categories={categories}
                  knownTags={knownTags}
                  allowPayment={false}
                />
              ) : (
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => selection.start()}
                    className="flex items-center gap-1.5 text-xs text-light-secondary transition-colors duration-200 hover:text-light-primary dark:text-dark-secondary dark:hover:text-dark-primary"
                  >
                    <ListChecks size={14} />
                    Selecionar
                  </button>
                </div>
              )}

              <div className="rounded-2xl border border-border-light bg-surface-light divide-y divide-border-light overflow-hidden dark:border-transparent dark:bg-surface-dark-elevated dark:divide-border-dark">
                {periodTransactions.map((transaction) => (
                  <TransactionCompactCard
                    key={transaction.id}
                    transaction={transaction}
                    category={categoriesById.get(transaction.categoryId)}
                    linkedName={undefined}
                    selectMode={selection.active}
                    selected={selection.selectedIds.has(transaction.id)}
                    onToggleSelect={() => selection.toggle(transaction.id)}
                    onLongPress={() => selection.start(transaction.id)}
                    categories={categories}
                  />
                ))}
              </div>

            </>
          )}
        </>
      )}
    </div>
  )
}
