import { useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '../../components/ui/Button'
import { cn, formatBRL } from '../../lib/utils'
import { updateCard } from '../cards/api'
import { getInvoicePeriod, todayDateString } from '../cards/invoiceUtils'
import { nonBankOpenCardTransactions, switchCardToBankSource } from './api'
import type { CreditCard } from '../cards/types'
import { diagnoseLink, type DiagnosticResult, type DiagnosticVerdict } from './diagnose'
import type { PluggyAccount, PluggyAccountLink, PluggyConfig } from './types'

const VERDICT_LABELS: Record<DiagnosticVerdict, string> = {
  caixinha: 'Caixinha (não é gasto)',
  imported: 'No app',
  duplicate: 'Conciliado com um lançamento do app',
  beforeStart: 'Antes da data inicial',
  billPayment: 'Pagamento de fatura',
  pending: 'Pendente (conta)',
  zero: 'Valor zero',
  missing: 'Falta importar',
}

const VERDICT_CLASSES: Record<DiagnosticVerdict, string> = {
  caixinha: 'text-brand-500',
  imported: 'text-brand-500',
  duplicate: 'text-amber-600 dark:text-amber-400',
  beforeStart: 'text-light-secondary dark:text-dark-secondary',
  billPayment: 'text-light-secondary dark:text-dark-secondary',
  pending: 'text-light-secondary dark:text-dark-secondary',
  zero: 'text-light-secondary dark:text-dark-secondary',
  missing: 'text-danger',
}

function shortDate(date: string): string {
  return format(new Date(`${date.slice(0, 10)}T00:00:00`), 'd MMM', {
    locale: ptBR,
  })
}

interface DiagnosticPanelProps {
  workspaceId: string
  ownerUid: string
  config: Pick<PluggyConfig, 'clientId' | 'clientSecret' | 'syncFrom' | 'linkSince'>
  pluggyAccount: PluggyAccount
  link: PluggyAccountLink
  card?: CreditCard
  // roda a sincronização depois de trocar a fonte do cartão
  onSourceChanged: () => Promise<void>
}

// Compara o que a Pluggy devolve com o que está no app, lançamento a
// lançamento — pra descobrir por que uma fatura/saldo não bate sem
// precisar abrir o console.
export function DiagnosticPanel({
  workspaceId,
  ownerUid,
  config,
  pluggyAccount,
  link,
  card,
  onSourceChanged,
}: DiagnosticPanelProps) {
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

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

  async function handleUseBankAsSource() {
    if (!card || !period) return
    setWorking(true)
    setError(null)
    try {
      const replaced = await nonBankOpenCardTransactions(workspaceId, card.id, period.start)
      const total = replaced.reduce((sum, t) => sum + (t.type === 'expense' ? t.amount : -t.amount), 0)
      const ok = window.confirm(
        `O banco passa a ser a fonte do cartão ${card.name} a partir de ${shortDate(period.start)}.\n\n` +
          `Serão apagados ${replaced.length} lançamento(s) em aberto que não vieram do banco ` +
          `(importação de arquivo, ajuste de fatura, lançados à mão), somando ${formatBRL(total)}, ` +
          'e no lugar entram os lançamentos do banco. Faturas já pagas não mudam.\n\nContinuar?',
      )
      if (!ok) return
      await switchCardToBankSource(workspaceId, ownerUid, pluggyAccount.id, card.id, period.start)
      await onSourceChanged()
      setResult(
        await diagnoseLink(
          workspaceId,
          {
            ...config,
            linkSince: {
              ...config.linkSince,
              [pluggyAccount.id]: period.start,
            },
          },
          pluggyAccount.id,
          link,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível trocar a fonte do cartão.')
    } finally {
      setWorking(false)
    }
  }

  async function handleFixDueDay(dueDay: number) {
    if (!card) return
    setWorking(true)
    try {
      await updateCard(workspaceId, card.id, {
        name: card.name,
        brand: card.brand,
        limit: card.limit,
        closingDay: card.closingDay,
        dueDay,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível corrigir o vencimento.')
    } finally {
      setWorking(false)
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
                Vencimento — banco: {bankDueDay ? `dia ${bankDueDay}` : 'não informado'} · app: dia{' '}
                {card.dueDay}
                {bankDueDay && bankDueDay !== card.dueDay ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void handleFixDueDay(bankDueDay)}
                      className="font-medium text-brand-500 underline"
                    >
                      usar dia {bankDueDay} no app
                    </button>
                  </>
                ) : null}
              </p>
              {period && bankInCurrentInvoice !== undefined ? (
                <p>
                  Lançamentos do banco na fatura atual do app ({shortDate(period.start)} a{' '}
                  {shortDate(period.end)}
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
            {Object.entries(counts).map(
              ([verdict, n]) => ` · ${VERDICT_LABELS[verdict as DiagnosticVerdict]}: ${n}`,
            )}
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

          {isCard && card && period ? (
            <div className="flex flex-col gap-1">
              <Button type="button" onClick={handleUseBankAsSource} disabled={working || loading}>
                {working
                  ? 'Trocando...'
                  : `Usar o banco como fonte deste cartão desde ${shortDate(period.start)}`}
              </Button>
              <p className="text-light-secondary dark:text-dark-secondary">
                Troca os lançamentos em aberto deste cartão (importação de arquivo, ajustes, lançados à mão)
                pelos do banco, a partir do início da fatura atual. Pede confirmação antes.
              </p>
            </div>
          ) : null}

          <Button type="button" variant="secondary" onClick={run} disabled={loading || working}>
            {loading ? 'Comparando...' : 'Comparar de novo'}
          </Button>
        </>
      ) : null}
    </div>
  )
}
