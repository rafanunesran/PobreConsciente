import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, Pencil, QrCode, Trash2 } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from '../accounts/useAccounts'
import { useCategories } from '../categories/useCategories'
import { todayDateString } from '../cards/invoiceUtils'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { cn, formatBRL } from '../../lib/utils'
import { useDebts } from './useDebts'
import { addDebtPayment, removeDebtPayment } from './api'
import { debtPaymentSchema, type DebtPaymentFormData } from './schemas'
import { DEBT_DIRECTION_LABELS, debtPaid, debtRemaining } from './types'
import { PixCharge } from './PixCharge'

function displayDate(date: string): string {
  return format(new Date(`${date}T00:00:00`), "d 'de' MMM 'de' yyyy", { locale: ptBR })
}

export function DebtDetailPage() {
  const navigate = useNavigate()
  const { debtId } = useParams<{ debtId: string }>()
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const { debts, loading } = useDebts(workspaceId ?? '')
  const { accounts } = useAccounts(workspaceId ?? '')
  const { categories } = useCategories(workspaceId ?? '')
  const [showPix, setShowPix] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const debt = debts.find((d) => d.id === debtId)
  const remaining = debt ? debtRemaining(debt) : 0

  const form = useForm<DebtPaymentFormData>({
    resolver: zodResolver(debtPaymentSchema),
    values: { amount: remaining, date: todayDateString(), accountId: '' },
  })

  if (!user || !workspaceId) return null

  if (loading) {
    return <div className="px-6 pt-4 text-sm text-light-secondary dark:text-dark-secondary">Carregando...</div>
  }
  if (!debt) {
    return (
      <div className="flex flex-col gap-3 px-6 pt-4">
        <p className="text-sm text-light-secondary dark:text-dark-secondary">Essa dívida não existe mais.</p>
        <Button type="button" variant="secondary" onClick={() => navigate('/dividas')}>
          Voltar
        </Button>
      </div>
    )
  }
  const current = debt

  async function onPayment(data: DebtPaymentFormData) {
    if (!user || !workspaceId) return
    setPaymentError(null)
    if (data.amount > remaining + 0.001) {
      setPaymentError(`O valor passa do que falta (${formatBRL(remaining)}).`)
      return
    }
    try {
      await addDebtPayment(workspaceId, current, data, categories, user.uid)
    } catch {
      setPaymentError('Não foi possível registrar. Tente novamente.')
    }
  }

  async function handleRemove(paymentId: string) {
    if (!workspaceId) return
    setRemovingId(paymentId)
    try {
      await removeDebtPayment(workspaceId, current, paymentId)
    } finally {
      setRemovingId(null)
    }
  }

  const percent = debt.amount > 0 ? Math.min((debtPaid(debt) / debt.amount) * 100, 100) : 0
  const owed = debt.direction === 'owed'

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Voltar"
          onClick={() => navigate('/dividas')}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-light-primary dark:text-dark-primary">{debt.person}</h1>
          <p className="truncate text-sm text-light-secondary dark:text-dark-secondary">
            {DEBT_DIRECTION_LABELS[debt.direction]}
            {debt.description ? ` · ${debt.description}` : ''}
          </p>
        </div>
        <Link
          to={`/dividas/${debt.id}/editar`}
          aria-label="Editar"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
        >
          <Pencil size={16} />
        </Link>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-sm text-light-secondary dark:text-dark-secondary">{remaining === 0 ? 'Quitada' : 'Falta'}</p>
            <p className={cn('text-2xl font-semibold', owed ? 'text-brand-500' : 'text-danger')}>
              {formatBRL(remaining)}
            </p>
          </div>
          <p className="text-sm text-light-secondary dark:text-dark-secondary">de {formatBRL(debt.amount)}</p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-border-light dark:bg-border-dark">
          <div className={cn('h-full rounded-full', owed ? 'bg-brand-500' : 'bg-danger')} style={{ width: `${percent}%` }} />
        </div>
        {debt.dueDate ? (
          <p className="text-xs text-light-secondary dark:text-dark-secondary">Vencimento: {displayDate(debt.dueDate)}</p>
        ) : null}
      </Card>

      {owed && remaining > 0 ? (
        <Card className="flex flex-col gap-3">
          {showPix ? (
            <PixCharge amount={remaining} person={debt.person} description={debt.description} />
          ) : (
            <Button type="button" variant="secondary" onClick={() => setShowPix(true)}>
              <QrCode size={18} />
              Cobrar {formatBRL(remaining)} por Pix
            </Button>
          )}
        </Card>
      ) : null}

      {remaining > 0 ? (
        <Card>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onPayment)} noValidate>
            <p className="text-sm font-medium text-light-primary dark:text-dark-primary">
              {owed ? 'Registrar recebimento' : 'Registrar pagamento'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Valor"
                type="number"
                step="0.01"
                error={form.formState.errors.amount?.message}
                {...form.register('amount', { valueAsNumber: true })}
              />
              <Input label="Data" type="date" {...form.register('date')} />
            </div>
            <Select label={owed ? 'Entrou na conta' : 'Saiu da conta'} {...form.register('accountId')}>
              <option value="">Não movimentar conta (só anotar)</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
            {paymentError ? <p className="text-sm text-danger">{paymentError}</p> : null}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Registrando...' : 'Registrar'}
            </Button>
          </form>
        </Card>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-light-secondary dark:text-dark-secondary">Histórico</h2>
        {debt.payments.length === 0 ? (
          <p className="text-sm text-light-secondary dark:text-dark-secondary">Nenhum pagamento ainda.</p>
        ) : (
          [...debt.payments]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((payment) => (
              <Card key={payment.id} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-semibold text-light-primary dark:text-dark-primary">
                    {formatBRL(payment.amount)}
                  </p>
                  <p className="text-xs text-light-secondary dark:text-dark-secondary">
                    {displayDate(payment.date)}
                    {payment.transactionId ? ' · lançado na conta' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Desfazer pagamento"
                  disabled={removingId === payment.id}
                  onClick={() => void handleRemove(payment.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-light-secondary hover:text-danger disabled:opacity-50 dark:text-dark-secondary"
                >
                  <Trash2 size={16} />
                </button>
              </Card>
            ))
        )}
        {debt.payments.some((p) => p.transactionId) ? (
          <p className="text-xs text-light-secondary dark:text-dark-secondary">
            Desfazer um pagamento lançado na conta também apaga o lançamento e devolve o saldo.
          </p>
        ) : null}
      </section>
    </div>
  )
}
