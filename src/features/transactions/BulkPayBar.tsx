import { useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { cn, formatBRL } from '../../lib/utils'
import type { Account } from '../accounts/types'
import type { BulkPay } from './useBulkPay'

interface BulkPayBarProps {
  bulk: BulkPay
  accounts: Account[]
}

// Barra que aparece (grudada no topo ao rolar) quando há itens marcados —
// um único "Pagar selecionados" pra despesas, receitas e faturas juntas.
export function BulkPayBar({ bulk, accounts }: BulkPayBarProps) {
  const [invoiceAccountId, setInvoiceAccountId] = useState('')

  if (bulk.selectedCount === 0) return null

  return (
    <div className="sticky top-2 z-20 flex flex-col gap-2 rounded-2xl border border-brand-500 bg-surface-light p-3 shadow-lg dark:bg-surface-dark-elevated">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-light-secondary dark:text-dark-secondary">
            {bulk.selectedCount} selecionado{bulk.selectedCount > 1 ? 's' : ''}
          </p>
          <p
            className={cn(
              'truncate text-sm font-semibold',
              bulk.selectedTotal < 0 ? 'text-danger' : 'text-brand-500',
            )}
          >
            {formatBRL(bulk.selectedTotal)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="secondary"
            className="px-2 py-1.5"
            aria-label="Limpar seleção"
            onClick={bulk.clear}
            disabled={bulk.paying}
          >
            <X size={16} />
          </Button>
          <Button
            type="button"
            className="gap-1 px-3 py-1.5 text-sm"
            disabled={bulk.paying}
            onClick={() => void bulk.paySelected(invoiceAccountId || null)}
          >
            <CheckCircle2 size={16} />
            {bulk.paying ? 'Pagando...' : 'Pagar selecionados'}
          </Button>
        </div>
      </div>
      {bulk.hasInvoicesSelected ? (
        <select
          aria-label="Conta para pagar as faturas"
          value={invoiceAccountId}
          onChange={(e) => setInvoiceAccountId(e.target.value)}
          className="w-full rounded-xl border border-border-light bg-surface-light px-3 py-2 text-sm text-light-primary outline-none focus:border-brand-500 dark:border-border-dark dark:bg-surface-dark dark:text-dark-primary"
        >
          <option value="">Pagar faturas com qual conta?</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({formatBRL(account.balance)})
            </option>
          ))}
        </select>
      ) : null}
      {bulk.error ? <p className="text-xs text-danger">{bulk.error}</p> : null}
    </div>
  )
}
