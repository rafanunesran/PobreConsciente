import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PiggyBank, Settings } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { formatBRL } from '../../lib/utils'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUserProfiles } from '../family/useUserProfiles'
import type { Caixinha } from './types'
import { CaixinhaGoalBar } from './CaixinhaGoalBar'

interface CaixinhaCardProps {
  caixinha: Caixinha
  accountId: string
}

export function CaixinhaCard({ caixinha, accountId }: CaixinhaCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const family = useWorkspaceStore((state) => state.family)
  const profiles = useUserProfiles(family ? [caixinha.createdBy] : [])
  const authorName = family ? profiles.get(caixinha.createdBy)?.displayName : undefined
  const base = `/contas/${accountId}/caixinhas/${caixinha.id}`

  return (
    <div className="relative">
      <div className="absolute right-3 top-3 z-10">
        <button
          type="button"
          aria-label="Mais opções"
          onClick={() => setMenuOpen((open) => !open)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-light-secondary transition-colors duration-200 hover:text-light-primary dark:text-dark-secondary dark:hover:text-dark-primary"
        >
          <Settings size={16} />
        </button>
        {menuOpen ? (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-9 z-20 flex w-44 flex-col overflow-hidden rounded-xl border border-border-light bg-surface-light shadow-lg dark:border-border-dark dark:bg-surface-dark-elevated">
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

      <Link to={base} className="block">
        <Card className="flex flex-col gap-2 p-3 transition-colors duration-200 hover:border-brand-500">
          <div className="flex min-w-0 items-center gap-2 pr-8">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-500">
              <PiggyBank size={14} />
            </span>
            <p className="truncate text-sm font-medium text-light-primary dark:text-dark-primary">
              {caixinha.name}
            </p>
          </div>

          <p className="text-lg font-semibold text-light-primary dark:text-dark-primary">
            {formatBRL(caixinha.balance)}
          </p>

          {caixinha.yieldLabel ? (
            <p className="text-xs text-light-secondary dark:text-dark-secondary">{caixinha.yieldLabel}</p>
          ) : null}
          <CaixinhaGoalBar caixinha={caixinha} />
          {authorName ? (
            <p className="text-xs text-light-secondary dark:text-dark-secondary">
              Adicionado por {authorName}
            </p>
          ) : null}
        </Card>
      </Link>
    </div>
  )
}
