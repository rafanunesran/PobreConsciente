import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { cn, formatBRL } from '../../lib/utils'
import type { Account } from '../accounts/types'
import { useCaixinhas } from '../caixinhas/useCaixinhas'
import { categoryOptions } from '../categories/categoryTree'
import type { Category } from '../categories/types'
import { type BankHistoryRow, loadIgnored, saveIgnored } from './bankHistory'
import {
  linkHistoryToTransaction,
  payBillFromHistory,
  registerHistoryCaixinha,
  registerHistoryTransaction,
  registerHistoryTransfer,
} from './bankHistoryActions'

type Tab = 'lancamento' | 'transferencia' | 'caixinha' | 'fatura'

const OUTSIDE = '__fora__'
const NEW_CAIXINHA = '__nova__'

function shortDate(date: string): string {
  return format(new Date(`${date}T00:00:00`), "d 'de' MMM", { locale: ptBR })
}

function initialTab(row: BankHistoryRow): Tab {
  if (row.pending) return 'lancamento'
  if (row.hint === 'caixinha') return 'caixinha'
  if (row.hint === 'transfer') return 'transferencia'
  if (row.hint === 'billPayment') return 'fatura'
  return 'lancamento'
}

interface BankHistorySheetProps {
  workspaceId: string
  createdBy: string
  row: BankHistoryRow
  accounts: Account[]
  categories: Category[]
  onClose: () => void
  onDone: () => void
}

// O que fazer com uma movimentação do banco: vincular ao que já foi
// lançado, lançar como receita/despesa, transferência, caixinha ou
// pagamento de fatura — ou ignorar.
export function BankHistorySheet({
  workspaceId,
  createdBy,
  row,
  accounts,
  categories,
  onClose,
  onDone,
}: BankHistorySheetProps) {
  const [tab, setTab] = useState<Tab>(initialTab(row))
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [description, setDescription] = useState(row.description)
  const options = categoryOptions(categories, row.type)
  const [categoryId, setCategoryId] = useState(row.suggestedCategoryId ?? options[0]?.category.id ?? '')
  const otherAccounts = accounts.filter((a) => a.id !== row.accountId)
  const [otherAccountId, setOtherAccountId] = useState(OUTSIDE)
  const { caixinhas } = useCaixinhas(workspaceId, row.accountId)
  const [caixinhaChoice, setCaixinhaChoice] = useState<string>(row.reserve?.caixinhaId ?? '')
  const [newCaixinhaName, setNewCaixinhaName] = useState(row.reserve?.name ?? '')
  const thisAccount = accounts.find((a) => a.id === row.accountId)
  const kindLabel = row.type === 'income' ? 'receita' : 'despesa'
  const registered =
    row.status.kind === 'transaction' || row.status.kind === 'transfer' || row.status.kind === 'caixinha'
  const effectiveCaixinha =
    caixinhaChoice || (caixinhas.length > 0 ? (caixinhas[0]?.id ?? NEW_CAIXINHA) : NEW_CAIXINHA)

  async function run(action: () => Promise<void>) {
    setWorking(true)
    setError(null)
    try {
      await action()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.')
      setWorking(false)
    }
  }

  function toggleIgnored(ignore: boolean) {
    const ids = loadIgnored(workspaceId)
    if (ignore) ids.add(row.docId)
    else ids.delete(row.docId)
    saveIgnored(workspaceId, ids)
    onDone()
  }

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'lancamento', label: row.type === 'income' ? 'Receita' : 'Despesa', show: true },
    { id: 'transferencia', label: 'Transferência', show: !row.pending },
    { id: 'caixinha', label: 'Caixinha', show: !row.pending },
    { id: 'fatura', label: 'Fatura', show: !row.pending && row.type === 'expense' },
  ]

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <button
        type="button"
        aria-label="Cancelar"
        className="absolute inset-0 cursor-default"
        onClick={working ? undefined : onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Movimentação do banco"
        className="relative flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl border border-border-light bg-surface-light p-4 pb-8 sm:rounded-2xl dark:border-border-dark dark:bg-surface-dark-elevated"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-light-primary dark:text-dark-primary">
              {row.type === 'income' ? '+' : '−'}
              {formatBRL(row.amount)} · {shortDate(row.date)}
            </h2>
            <p className="text-sm text-light-secondary dark:text-dark-secondary">{row.description}</p>
            <p className="text-xs text-light-secondary dark:text-dark-secondary">
              {[thisAccount?.name, row.counterpart, row.pending ? 'pendente no banco' : undefined]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            disabled={working}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-light-secondary hover:text-light-primary dark:text-dark-secondary dark:hover:text-dark-primary"
          >
            <X size={18} />
          </button>
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {registered ? (
          <div className="flex flex-col gap-2 text-sm text-light-primary dark:text-dark-primary">
            {row.status.kind === 'transaction' ? (
              <>
                <p>
                  Já está no controle como “{row.status.transaction.description}” (
                  {formatBRL(row.status.transaction.amount)}, {shortDate(row.status.transaction.date)}).
                </p>
                <Link
                  to={`/registros/${row.status.transaction.type === 'income' ? 'receita' : 'despesa'}/${row.status.transaction.id}/editar`}
                  className="text-sm font-medium text-brand-500"
                >
                  Abrir o lançamento
                </Link>
              </>
            ) : row.status.kind === 'transfer' ? (
              <p>Já está no controle como transferência (aparece no extrato da conta, sem contar).</p>
            ) : (
              <p>Já está no controle no histórico de uma caixinha.</p>
            )}
          </div>
        ) : (
          <>
            {row.status.kind === 'similar' ? (
              <div className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="text-light-primary dark:text-dark-primary">
                  Você já lançou “{row.status.transaction.description}” ({formatBRL(row.status.transaction.amount)},{' '}
                  {shortDate(row.status.transaction.date)}
                  {row.status.transaction.paid ? '' : ', previsto'}). É o mesmo?
                </p>
                <Button
                  type="button"
                  disabled={working}
                  onClick={() => {
                    const manual = row.status.kind === 'similar' ? row.status.transaction : null
                    if (manual) void run(() => linkHistoryToTransaction(workspaceId, row, manual))
                  }}
                >
                  Sim, é esse (usar valor e data do banco)
                </Button>
              </div>
            ) : null}

            <div className="flex gap-1 overflow-x-auto">
              {tabs
                .filter((t) => t.show)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors duration-200',
                      tab === t.id
                        ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                        : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
            </div>

            {tab === 'lancamento' ? (
              <div className="flex flex-col gap-3">
                <Input
                  label="Descrição"
                  name="historyDescription"
                  value={description}
                  maxLength={60}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <Select
                  label="Categoria"
                  name="historyCategory"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  {options.map(({ category, label }) => (
                    <option key={category.id} value={category.id}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  disabled={working || !categoryId}
                  onClick={() =>
                    void run(() =>
                      registerHistoryTransaction({ workspaceId, row, categoryId, description, createdBy }),
                    )
                  }
                >
                  {working ? 'Lançando...' : row.pending ? `Lançar como ${kindLabel} pendente` : `Lançar como ${kindLabel}`}
                </Button>
                {options.length === 0 ? (
                  <p className="text-xs text-danger">Crie uma categoria de {kindLabel} antes.</p>
                ) : null}
              </div>
            ) : null}

            {tab === 'transferencia' ? (
              <div className="flex flex-col gap-3">
                <Select
                  label={row.type === 'expense' ? 'Foi para qual conta?' : 'Veio de qual conta?'}
                  name="historyOtherAccount"
                  value={otherAccountId}
                  onChange={(e) => setOtherAccountId(e.target.value)}
                >
                  <option value={OUTSIDE}>Conta fora do app</option>
                  {otherAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-light-secondary dark:text-dark-secondary">
                  Não conta como receita nem despesa. Aparece no extrato da conta como transferência e mexe no
                  saldo {otherAccountId === OUTSIDE ? 'desta conta' : 'das duas contas'}.
                </p>
                <Button
                  type="button"
                  disabled={working}
                  onClick={() => {
                    const other = otherAccountId === OUTSIDE ? undefined : otherAccounts.find((a) => a.id === otherAccountId)
                    void run(() =>
                      registerHistoryTransfer({
                        workspaceId,
                        row,
                        otherAccountId: other?.id,
                        thisAccountName: thisAccount?.name ?? 'conta',
                        createdBy,
                      }),
                    )
                  }}
                >
                  {working ? 'Lançando...' : 'Lançar como transferência'}
                </Button>
              </div>
            ) : null}

            {tab === 'caixinha' ? (
              <div className="flex flex-col gap-3">
                <Select
                  label={row.type === 'expense' ? 'Guardado em qual caixinha?' : 'Resgatado de qual caixinha?'}
                  name="historyCaixinha"
                  value={effectiveCaixinha}
                  onChange={(e) => setCaixinhaChoice(e.target.value)}
                >
                  {caixinhas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({formatBRL(c.balance)})
                    </option>
                  ))}
                  <option value={NEW_CAIXINHA}>Nova caixinha</option>
                </Select>
                {effectiveCaixinha === NEW_CAIXINHA ? (
                  <Input
                    label="Nome da nova caixinha"
                    name="historyNewCaixinha"
                    value={newCaixinhaName}
                    maxLength={40}
                    placeholder="Reserva"
                    onChange={(e) => setNewCaixinhaName(e.target.value)}
                  />
                ) : null}
                <p className="text-xs text-light-secondary dark:text-dark-secondary">
                  Não conta como receita nem despesa: o dinheiro só muda de lugar entre a conta e a caixinha.
                  {effectiveCaixinha !== NEW_CAIXINHA ? ' Movimentações iguais já vêm com essa caixinha sugerida.' : ''}
                </p>
                <Button
                  type="button"
                  disabled={working}
                  onClick={() =>
                    void run(() =>
                      registerHistoryCaixinha({
                        workspaceId,
                        row,
                        ...(effectiveCaixinha === NEW_CAIXINHA
                          ? { newCaixinhaName }
                          : { caixinhaId: effectiveCaixinha }),
                        createdBy,
                      }),
                    )
                  }
                >
                  {working ? 'Lançando...' : row.type === 'expense' ? 'Guardar na caixinha' : 'Resgatar da caixinha'}
                </Button>
              </div>
            ) : null}

            {tab === 'fatura' ? (
              <div className="flex flex-col gap-3">
                <Select
                  label="Categoria do pagamento"
                  name="historyBillCategory"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  {options.map(({ category, label }) => (
                    <option key={category.id} value={category.id}>
                      {label}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-light-secondary dark:text-dark-secondary">
                  Paga a fatura fechada do cartão que está em aberto com exatamente {formatBRL(row.amount)}, como
                  o “Pagar fatura”.
                </p>
                <Button
                  type="button"
                  disabled={working || !categoryId}
                  onClick={() =>
                    void run(async () => {
                      const paid = await payBillFromHistory({ workspaceId, row, categoryId, createdBy })
                      if (!paid)
                        throw new Error(
                          `Não achei uma fatura fechada em aberto de ${formatBRL(row.amount)}. Pague pelo cartão ou lance como despesa.`,
                        )
                    })
                  }
                >
                  {working ? 'Pagando...' : 'Pagar fatura'}
                </Button>
              </div>
            ) : null}

            {row.status.kind === 'ignored' ? (
              <Button type="button" variant="ghost" disabled={working} onClick={() => toggleIgnored(false)}>
                Voltar a mostrar em “Falta lançar”
              </Button>
            ) : (
              <Button type="button" variant="ghost" disabled={working} onClick={() => toggleIgnored(true)}>
                Ignorar (não vai pro controle)
              </Button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
