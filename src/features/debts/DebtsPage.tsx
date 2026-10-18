import { useState } from 'react'
import { Link } from 'react-router-dom'
import { HandCoins, Plus } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { Button } from '../../components/ui/Button'
import { formatBRL } from '../../lib/utils'
import { useDebts } from './useDebts'
import { DebtCard } from './DebtCard'
import { DEBT_DIRECTION_LABELS, DEBT_DIRECTIONS, debtRemaining } from './types'

export function DebtsPage() {
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { debts, loading, error } = useDebts(workspaceId ?? '')
  const [showSettled, setShowSettled] = useState(false)

  if (!user || !workspaceId) return null

  const open = debts.filter((d) => debtRemaining(d) > 0)
  const settled = debts.filter((d) => debtRemaining(d) === 0)
  const totalOwed = open.filter((d) => d.direction === 'owed').reduce((s, d) => s + debtRemaining(d), 0)
  const totalOwe = open.filter((d) => d.direction === 'owe').reduce((s, d) => s + debtRemaining(d), 0)

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">Dívidas e empréstimos</h1>
        <Link to="/dividas/nova">
          <Button type="button" className="gap-1.5">
            <Plus size={18} />
            Nova
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="h-24 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
      ) : error ? (
        <p className="text-sm text-danger">
          Não foi possível carregar. Verifique se as regras do Firestore foram publicadas.
        </p>
      ) : debts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-light px-6 py-16 text-center dark:border-border-dark">
          <HandCoins size={32} className="text-light-secondary dark:text-dark-secondary" />
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Anote quem te deve e para quem você deve — com pagamentos parciais e cobrança por Pix.
          </p>
          <Link to="/dividas/nova">
            <Button type="button" variant="secondary">
              Registrar a primeira
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-border-light bg-surface-light p-4 dark:border-border-dark dark:bg-surface-dark-elevated">
            <div className="min-w-0">
              <p className="text-xs text-light-secondary dark:text-dark-secondary">Me devem</p>
              <p className="truncate text-sm font-semibold text-brand-500">{formatBRL(totalOwed)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-light-secondary dark:text-dark-secondary">Eu devo</p>
              <p className="truncate text-sm font-semibold text-danger">{formatBRL(totalOwe)}</p>
            </div>
            <div className="min-w-0 border-l border-border-light pl-2 dark:border-border-dark">
              <p className="text-xs text-light-secondary dark:text-dark-secondary">Saldo</p>
              <p className={`truncate text-sm font-semibold ${totalOwed - totalOwe >= 0 ? 'text-brand-500' : 'text-danger'}`}>
                {formatBRL(totalOwed - totalOwe)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {DEBT_DIRECTIONS.map((direction) => {
              const items = open.filter((d) => d.direction === direction)
              return (
                <section key={direction} className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium text-light-secondary dark:text-dark-secondary">
                    {DEBT_DIRECTION_LABELS[direction]}
                  </h2>
                  {items.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-border-light py-6 text-center text-xs text-light-secondary dark:border-border-dark dark:text-dark-secondary">
                      Nada em aberto
                    </p>
                  ) : (
                    items.map((debt) => <DebtCard key={debt.id} debt={debt} />)
                  )}
                </section>
              )
            })}
          </div>

          {settled.length > 0 ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowSettled((v) => !v)}
                className="self-start text-sm text-brand-500"
              >
                {showSettled ? 'Esconder quitadas' : `Ver quitadas (${settled.length})`}
              </button>
              {showSettled ? settled.map((debt) => <DebtCard key={debt.id} debt={debt} />) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
