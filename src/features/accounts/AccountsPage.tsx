import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Wallet } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from './useAccounts'
import { AccountTile } from './AccountTile'
import { QuickTransferDialog } from './QuickTransferDialog'
import type { Account } from './types'
import { Button } from '../../components/ui/Button'

export function AccountsPage() {
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  // NOTE: hooks não podem ser condicionais — chama useAccounts sempre, com
  // uid vazio se `user`/workspace ainda não resolveu, e só corta a
  // renderização depois.
  const { accounts, loading, error } = useAccounts(workspaceId ?? '')
  const [transferFrom, setTransferFrom] = useState<Account | null>(null)

  // Só renderiza atrás de <ProtectedRoute>, `user` nunca deveria ser null
  // aqui de verdade — o guard é só pro TS não reclamar.
  if (!user || !workspaceId) return null

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">
          Contas
        </h1>
        <Link to="/contas/nova">
          <Button type="button" className="gap-1.5">
            <Plus size={18} />
            Nova conta
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated"
            />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-danger">
          Não foi possível carregar suas contas. Verifique sua conexão ou tente novamente mais
          tarde.
        </p>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-light py-16 text-center dark:border-border-dark">
          <Wallet size={32} className="text-light-secondary dark:text-dark-secondary" />
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Nenhuma conta ainda.
          </p>
          <Link to="/contas/nova">
            <Button type="button" variant="secondary">
              Criar a primeira conta
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <AccountTile key={account.id} account={account} onTransfer={setTransferFrom} />
          ))}
        </div>
      )}

      {transferFrom ? (
        <QuickTransferDialog
          workspaceId={workspaceId}
          from={accounts.find((a) => a.id === transferFrom.id) ?? transferFrom}
          accounts={accounts}
          onClose={() => setTransferFrom(null)}
        />
      ) : null}
    </div>
  )
}
