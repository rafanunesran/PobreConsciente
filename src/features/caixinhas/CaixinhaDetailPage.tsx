import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowDownCircle, ArrowLeft, ArrowUpCircle, PiggyBank, Settings, TrendingUp } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useCaixinhas } from './useCaixinhas'
import { useCaixinhaMovements } from './useCaixinhaMovements'
import { CAIXINHA_MOVEMENT_LABELS, type CaixinhaMovementType } from './types'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { MonthSelector } from '../../components/ui/MonthSelector'
import { currentYearMonth } from '../transactions/dateUtils'
import { cn, formatBRL } from '../../lib/utils'
import { useUserProfiles } from '../family/useUserProfiles'
import { CaixinhaGoalBar } from './CaixinhaGoalBar'

const MOVEMENT_ICONS: Record<CaixinhaMovementType, typeof ArrowDownCircle> = {
  guardar: ArrowDownCircle,
  resgatar: ArrowUpCircle,
  rendimento: TrendingUp,
  ajuste: Settings,
}

function formatDisplayDate(date: string): string {
  return format(new Date(`${date}T00:00:00`), "d 'de' MMM", { locale: ptBR })
}

export function CaixinhaDetailPage() {
  const navigate = useNavigate()
  const { accountId, caixinhaId } = useParams<{ accountId: string; caixinhaId: string }>()
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const family = useWorkspaceStore((state) => state.family)
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth())

  const { caixinhas, loading: loadingCaixinhas } = useCaixinhas(workspaceId ?? '', accountId ?? '')
  const {
    movements,
    loading: loadingMovements,
    error: movementsError,
  } = useCaixinhaMovements(workspaceId ?? '', caixinhaId ?? '')

  const caixinha = caixinhas.find((c) => c.id === caixinhaId)
  const base = `/contas/${accountId}/caixinhas/${caixinhaId}`
  const profiles = useUserProfiles(family && caixinha ? [caixinha.createdBy] : [])
  const authorName = family && caixinha ? profiles.get(caixinha.createdBy)?.displayName : undefined

  const monthMovements = useMemo(
    () => movements.filter((m) => m.date.startsWith(selectedMonth)),
    [movements, selectedMonth],
  )

  if (!user || !workspaceId || !accountId || !caixinhaId) return null

  if (!loadingCaixinhas && !caixinha) {
    navigate(`/contas/${accountId}`, { replace: true })
    return null
  }

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Voltar"
          onClick={() => navigate(`/contas/${accountId}`)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-light-primary dark:text-dark-primary">
            {caixinha ? caixinha.name : 'Carregando...'}
          </h1>
          {caixinha ? (
            <p className="text-sm text-light-secondary dark:text-dark-secondary">
              {formatBRL(caixinha.balance)}
              {caixinha.yieldLabel ? ` · ${caixinha.yieldLabel}` : ''}
              {authorName ? ` · Adicionado por ${authorName}` : ''}
            </p>
          ) : null}
        </div>
        {caixinha ? (
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
                    to={`${base}/transferir?direction=guardar`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Guardar
                  </Link>
                  <Link
                    to={`${base}/transferir?direction=resgatar`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Resgatar
                  </Link>
                  <Link
                    to={`${base}/rendimento`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Registrar rendimento
                  </Link>
                  <Link
                    to={`${base}/ajustar`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Ajuste de saldo
                  </Link>
                  <Link
                    to={`${base}/editar`}
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2.5 text-left text-sm text-light-primary transition-colors duration-200 hover:bg-border-light dark:text-dark-primary dark:hover:bg-border-dark"
                  >
                    Editar
                  </Link>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {loadingCaixinhas || !caixinha ? (
        <div className="h-40 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
      ) : (
        <>
          {caixinha.goalAmount !== undefined ? (
            <Card>
              <CaixinhaGoalBar caixinha={caixinha} detailed />
            </Card>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Link to={`${base}/transferir?direction=guardar`}>
              <Button type="button" className="w-full gap-2">
                <ArrowDownCircle size={18} />
                Guardar
              </Button>
            </Link>
            <Link to={`${base}/transferir?direction=resgatar`}>
              <Button type="button" variant="secondary" className="w-full gap-2">
                <ArrowUpCircle size={18} />
                Resgatar
              </Button>
            </Link>
          </div>

          <MonthSelector value={selectedMonth} onChange={setSelectedMonth} />

          {movementsError ? (
            <p className="text-sm text-danger">
              Não foi possível carregar as movimentações. Verifique se as regras do Firestore
              foram publicadas.
            </p>
          ) : loadingMovements ? (
            <div className="h-40 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
          ) : monthMovements.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-light py-16 text-center dark:border-border-dark">
              <PiggyBank size={32} className="text-light-secondary dark:text-dark-secondary" />
              <p className="text-sm text-light-secondary dark:text-dark-secondary">
                Nenhuma movimentação neste mês.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {monthMovements.map((movement) => {
                const Icon = MOVEMENT_ICONS[movement.type]
                const positive = movement.amount >= 0
                return (
                  <Card key={movement.id} className="flex items-center gap-3 p-3">
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
                        {CAIXINHA_MOVEMENT_LABELS[movement.type]}
                      </p>
                      <p className="text-xs text-light-secondary dark:text-dark-secondary">
                        {formatDisplayDate(movement.date)}
                      </p>
                    </div>
                    <p
                      className={cn(
                        'shrink-0 text-sm font-semibold',
                        positive ? 'text-brand-500' : 'text-danger',
                      )}
                    >
                      {positive ? '+' : '-'}
                      {formatBRL(Math.abs(movement.amount))}
                    </p>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
