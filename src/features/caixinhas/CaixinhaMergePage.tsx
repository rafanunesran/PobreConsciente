import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useCaixinhas } from './useCaixinhas'
import { mergeCaixinhas } from './merge'
import { Button } from '../../components/ui/Button'
import { cn, formatBRL } from '../../lib/utils'

// Juntar caixinhas repetidas numa só (ex.: as várias que a sincronização
// do Nubank criava, uma por aplicação). Saldo, histórico e marcações das
// escolhidas passam pra esta; a conta não muda.
export function CaixinhaMergePage() {
  const navigate = useNavigate()
  const { accountId, caixinhaId } = useParams<{ accountId: string; caixinhaId: string }>()
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { caixinhas, loading } = useCaixinhas(workspaceId ?? '', accountId ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user || !workspaceId || !accountId || !caixinhaId) return null
  const target = caixinhas.find((c) => c.id === caixinhaId)
  const others = caixinhas.filter((c) => c.id !== caixinhaId)
  const chosen = others.filter((c) => selected.has(c.id))
  const total = chosen.reduce((sum, c) => sum + c.balance, 0)
  const back = `/contas/${accountId}/caixinhas/${caixinhaId}`

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleMerge() {
    if (!workspaceId || !target || chosen.length === 0) return
    setSaving(true)
    setError(null)
    try {
      await mergeCaixinhas(workspaceId, { ...target }, chosen)
      navigate(back, { replace: true })
    } catch {
      setError('Não foi possível juntar as caixinhas. Tente novamente.')
      setSaving(false)
    }
  }

  if (!loading && !target) {
    navigate(`/contas/${accountId}`, { replace: true })
    return null
  }

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div>
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">Juntar caixinhas</h1>
        <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">
          Escolha as caixinhas repetidas. O saldo e o histórico delas passam para{' '}
          <strong>{target?.name ?? '...'}</strong> e elas deixam de existir. O saldo da conta não muda.
        </p>
      </div>

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
      ) : others.length === 0 ? (
        <p className="text-sm text-light-secondary dark:text-dark-secondary">
          Esta conta não tem outras caixinhas.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {others.map((c) => {
            const on = selected.has(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors duration-200',
                  on
                    ? 'border-brand-500 bg-brand-500/10'
                    : 'border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                    on ? 'border-brand-500 bg-brand-500 text-white' : 'border-border-light dark:border-border-dark',
                  )}
                >
                  {on ? <Check size={14} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-light-primary dark:text-dark-primary">
                  {c.name}
                </span>
                <span className="shrink-0 text-sm text-light-secondary dark:text-dark-secondary">
                  {formatBRL(c.balance)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex flex-col gap-2">
        <Button type="button" onClick={handleMerge} disabled={saving || chosen.length === 0 || !target}>
          {saving
            ? 'Juntando...'
            : chosen.length === 0
              ? 'Escolha as caixinhas'
              : `Juntar ${chosen.length} (${formatBRL(total)}) em ${target?.name ?? ''}`}
        </Button>
        <Button type="button" variant="secondary" onClick={() => navigate(back)} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
