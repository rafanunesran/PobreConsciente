import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, Calculator, Plus, RefreshCw, X } from 'lucide-react'
import { FloatingCalculator } from './FloatingCalculator'
import { useQuickAddStore } from '../../stores/quickAddStore'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useToastStore } from '../../stores/toastStore'
import { listPluggyConfigs } from '../../features/openFinance/api'
import { syncBankTransactions } from '../../features/openFinance/sync'
import { describeSyncResult } from '../../features/openFinance/syncSummary'
import { cn } from '../../lib/utils'

interface MenuItem {
  title: string
  description: string
  icon: typeof Plus
  className: string
  action: () => void
}

// Bottom sheet com as opções de lançamento. No mobile quem abre é o +
// central da BottomNav; no desktop (sem bottom nav) o botão flutuante.
export function FAB() {
  const navigate = useNavigate()
  const open = useQuickAddStore((state) => state.open)
  const setOpen = useQuickAddStore((state) => state.setOpen)
  const [calcOpen, setCalcOpen] = useState(false)
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const showToast = useToastStore((state) => state.show)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // Mesmo "Sincronizar agora" da tela de Conexão bancária, com o resultado
  // num aviso. Sem conexão configurada, leva pra tela de configurar.
  async function syncAccounts() {
    if (!user || !workspaceId) return
    try {
      const configs = await listPluggyConfigs(workspaceId)
      if (configs.length === 0) {
        navigate('/conexao-bancaria')
        return
      }
      showToast('Sincronizando contas...')
      const result = await syncBankTransactions(workspaceId, user.uid)
      if (result.errors.length > 0)
        showToast(`Sincronização com erro: ${result.errors.join(' ')}`, { label: 'Ver', to: '/conexao-bancaria' })
      else showToast(describeSyncResult(result))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha na sincronização.', {
        label: 'Ver',
        to: '/conexao-bancaria',
      })
    }
  }

  const items: MenuItem[] = [
    {
      title: 'Despesa',
      description: 'Gastos no débito, Pix, dinheiro ou cartão',
      icon: ArrowDownCircle,
      className: 'bg-danger/15 text-danger',
      action: () => navigate('/registros/despesa/nova'),
    },
    {
      title: 'Receita',
      description: 'Salário, freelas, rendimentos',
      icon: ArrowUpCircle,
      className: 'bg-brand-500/15 text-brand-500',
      action: () => navigate('/registros/receita/nova'),
    },
    {
      title: 'Transferência',
      description: 'Mover dinheiro entre suas contas',
      icon: ArrowLeftRight,
      className: 'bg-violet-500/15 text-violet-500',
      action: () => navigate('/contas/transferir'),
    },
    {
      title: 'Sincronizar contas',
      description: 'Buscar agora os lançamentos e saldos do banco',
      icon: RefreshCw,
      className: 'bg-sky-500/15 text-sky-500',
      action: () => void syncAccounts(),
    },
    {
      title: 'Calculadora',
      description: 'Fazer uma conta rápida',
      icon: Calculator,
      className: 'bg-amber-500/15 text-amber-500',
      action: () => setCalcOpen(true),
    },
  ]

  function handleSelect(item: MenuItem) {
    setOpen(false)
    item.action()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Novo lançamento"
        className="fixed bottom-8 right-8 z-30 hidden h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-[0_0_20px_var(--color-brand-glow)] transition-all duration-200 hover:bg-brand-600 lg:flex"
      >
        <Plus size={28} />
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-labelledby="quick-add-title">
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
          />
          <div className="relative w-full max-w-[480px] rounded-t-3xl border-t border-border-light bg-bg-light p-5 pb-8 dark:border-border-dark dark:bg-surface-dark lg:rounded-3xl lg:border">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border-light dark:bg-border-dark lg:hidden" />
            <div className="mb-4 flex items-center justify-between">
              <h2 id="quick-add-title" className="text-lg font-semibold text-light-primary dark:text-dark-primary">
                O que você quer lançar?
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="rounded-full p-2 text-light-secondary hover:bg-border-light dark:text-dark-secondary dark:hover:bg-border-dark"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => handleSelect(item)}
                  className="flex w-full items-center gap-4 rounded-2xl bg-surface-light p-4 text-left transition-colors duration-200 hover:bg-border-light dark:bg-surface-dark-elevated dark:hover:bg-border-dark"
                >
                  <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', item.className)}>
                    <item.icon size={24} />
                  </span>
                  <span>
                    <span className="block font-semibold text-light-primary dark:text-dark-primary">{item.title}</span>
                    <span className="block text-sm text-light-secondary dark:text-dark-secondary">
                      {item.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {calcOpen && <FloatingCalculator onClose={() => setCalcOpen(false)} />}
    </>
  )
}
