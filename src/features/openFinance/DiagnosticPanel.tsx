import { useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '../../components/ui/Button'
import { cn, formatBRL } from '../../lib/utils'
import { getInvoicePeriod, todayDateString } from '../cards/invoiceUtils'
import type { CreditCard } from '../cards/types'
import { diagnoseLink, type DiagnosticResult, type DiagnosticVerdict } from './diagnose'
import type { PluggyAccount, PluggyAccountLink, PluggyConfig } from './types'

const VERDICT_LABELS: Record<DiagnosticVerdict, string> = {
  imported: 'No app',
  duplicate: 'Igual a um já lançado',
  beforeStart: 'Antes da data inicial',
  billPayment: 'Pagamento de fatura',
  pending: 'Pendente (conta)',
  zero: 'Valor zero',
  missing: 'Falta importar',
}

const VERDICT_CLASSES: Record<DiagnosticVerdict, string> = {
  imported: 'text-brand-500',
  duplicate: 'text-amber-600 dark:text-amber-400',
  beforeStart: 'text-light-secondary dark:text-dark-secondary',
  billPayment: 'text-light-secondary dark:text-dark-secondary',
  pending: 'text-light-secondary dark:text-dark-secondary',
  zero: 'text-light-secondary dark:text-dark-secondary',
  missing: 'text-danger',
}

function shortDate(date: string): string {
  return format(new Date(`${date.slice(0, 10)}T00:00:00`), 'd MMM', { locale: ptBR })
}

interface DiagnosticPanelProps {
  workspaceId: string
  config: Pick<PluggyConfig, 'clientId' | 'clientSecret' | 'syncFrom'>
  pluggyAccount: PluggyAccount
  link: PluggyAccountLink
  card?: CreditCard
}

// Compara o que a Pluggy devolve com o que está no app, lançamento a
// lançamento — pra descobrir por que uma fatura/saldo não bate sem
// precisar abrir o console.
export function DiagnosticPanel({ workspaceId, config, pluggyAccount, link, card }: DiagnosticPanelProps) {
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      setResult(await diagnoseLink(workspaceId, config, pluggyAccount.id, link))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no diagnóstico.')
    } finally {
      setLoading(false)
    }
  }

  const isCard = 'cardId' in link
  const bankClosingDay = Number(pluggyAccount.creditData?.balanceCloseDate?.slice(8, 10)) || undefined
  const bankDueDay = Number(pluggyAccount.creditData?.balanceDueDate?.slice(8, 10)) || undefined
  const period = card ? getInvoicePeriod(card.closingDay, todayDateString()) : undefined

  // Soma (lado do banco) do que cai na fatura atual do app: compra soma,
  // estorno abate; pagamento de fatura fica de fora, como na sincronização.
  const bankInCurrentInvoice =
    result && period
      ? result.rows
          .filter((r) => r.verdict !== 'billPayment' && r.date >= period.start && r.date <= period.end)
          .reduce((sum, r) => sum + r.amount, 0)
      : undefined

  const counts = result
    ? result.rows.reduce<Partial<Record<DiagnosticVerdict, number>>>((acc, r) => {
        acc[r.verdict] = (acc[r.verdict] ?? 0) + 1
        return acc
      }, {})
    : {}

  return (
    <div className="flex flex-col gap-2 border-t border-border-light pt-2 text-xs dark:border-border-dark">
      {!result ? (
        <Button type="button" variant="secondary" onClick={run} disabled={loading}>
          {loading ? 'Comparando com o banco...' : 'Diagnóstico: comparar com o banco'}
        </Button>
      ) : null}
      {error ? <p className="text-danger">{error}</p> : null}

      {result ? (
        <>
          {isCard && card ? (
            <div className="flex flex-col gap-0.5 text-light-secondary dark:text-dark-secondary">
              <p className={cn(bankClosingDay && bankClosingDay !== card.closingDay && 'text-danger')}>
                Fechamento — banco: {bankClosingDay ? `dia ${bankClosingDay}` : 'não informado'} · app: dia{' '}
                {card.closingDay}
              </p>
              <p className={cn(bankDueDay && bankDueDay !== card.dueDay && 'text-danger')}>
                Vencimento — banco: {bankDueDay ? `dia ${bankDueDay}` : 'não informado'} · app: dia {card.dueDay}
              </p>
              {period && bankInCurrentInvoice !== undefined ? (
                <p>
                  Lançamentos do banco na fatura atual do app ({shortDate(period.start)} a {shortDate(period.end)}
                  ): <strong>{formatBRL(bankInCurrentInvoice)}</strong>
                </p>
              ) : null}
              {typeof pluggyAccount.balance === 'number' ? (
                <p>Saldo do cartão informado pelo banco: {formatBRL(pluggyAccount.balance)}</p>
              ) : null}
              {result.bills.length > 0 ? (
                <p>
                  Faturas fechadas no banco:{' '}
                  {result.bills
                    .slice()
                    .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
                    .slice(0, 3)
                    .map((b) => `vence ${shortDate(b.dueDate)}: ${formatBRL(b.totalAmount)}`)
                    .join(' · ')}
                </p>
              ) : result.billsError ? (
                <p>Faturas fechadas: {result.billsError}</p>
              ) : null}
            </div>
          ) : null}

          <p className="text-light-secondary dark:text-dark-secondary">
            {result.rows.length} lançamento(s) nos últimos 60 dias
            {Object.entries(counts).map(([verdict, n]) => ` · ${VERDICT_LABELS[verdict as DiagnosticVerdict]}: ${n}`)}
          </p>

          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {result.rows.map((row, i) => (
              <div key={i} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-light-primary dark:text-dark-primary">{row.description}</p>
                  <p className="text-light-secondary dark:text-dark-secondary">
                    {shortDate(row.date)}
                    {row.status ? ` · ${row.status === 'PENDING' ? 'pendente' : 'confirmado'}` : ''} ·{' '}
                    <span className={VERDICT_CLASSES[row.verdict]}>{VERDICT_LABELS[row.verdict]}</span>
                  </p>
                </div>
                <p className="shrink-0 text-light-primary dark:text-dark-primary">{formatBRL(row.amount)}</p>
              </div>
            ))}
          </div>

          <Button type="button" variant="secondary" onClick={run} disabled={loading}>
            {loading ? 'Comparando...' : 'Comparar de novo'}
          </Button>
        </>
      ) : null}
    </div>
  )
}
