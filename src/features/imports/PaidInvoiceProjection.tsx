import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '../../components/ui/Button'
import { cn, formatBRL } from '../../lib/utils'
import { categoryOptions } from '../categories/categoryTree'
import type { Category } from '../categories/types'
import { getDueDate, getInvoicePeriod, nextInvoicePeriod, previousInvoicePeriod, todayDateString, type InvoicePeriod } from '../cards/invoiceUtils'
import type { CreditCard } from '../cards/types'
import type { Transaction } from '../transactions/types'
import { inferPaidPeriod, projectInstallments, type ProjectedInstallment } from './projectInstallments'
import type { ParsedEntry, ReviewedEntry } from './types'

export interface ProjectionRow extends ParsedEntry {
  selected: boolean
  categoryId: string
}

interface Props {
  card: CreditCard
  rows: ProjectionRow[]
  categories: Category[]
  cardTransactions: Transaction[]
  importing: boolean
  importError: string | null
  onUpdateRow: (index: number, patch: Partial<ProjectionRow>) => void
  onConfirm: (entries: ReviewedEntry[]) => void
  onReset: () => void
}

function monthLabel(date: string): string {
  return format(new Date(`${date}T00:00:00`), 'MMM/yyyy', { locale: ptBR })
}

function periodLabel(card: CreditCard, period: InvoicePeriod): string {
  return `Fatura que venceu/vence em ${format(new Date(`${getDueDate(period.end, card.dueDay)}T00:00:00`), "d 'de' MMM yyyy", { locale: ptBR })}`
}

// Opções de "qual fatura é este arquivo": 12 faturas pra trás da aberta
// hoje, mais a deduzida do arquivo se estiver fora dessa janela.
function periodOptions(card: CreditCard, inferred: InvoicePeriod | null): InvoicePeriod[] {
  const options: InvoicePeriod[] = []
  let p = getInvoicePeriod(card.closingDay, todayDateString())
  for (let i = 0; i < 13; i++) {
    options.push(p)
    p = previousInvoicePeriod(card.closingDay, p)
  }
  if (inferred && !options.some((o) => o.end === inferred.end)) options.push(inferred)
  options.push(nextInvoicePeriod(card.closingDay, options[0] as InvoicePeriod))
  return options.sort((a, b) => b.end.localeCompare(a.end))
}

export function PaidInvoiceProjection({
  card,
  rows,
  categories,
  cardTransactions,
  importing,
  importError,
  onUpdateRow,
  onConfirm,
  onReset,
}: Props) {
  const inferred = useMemo(() => inferPaidPeriod(rows, card.closingDay), [rows, card.closingDay])
  const options = useMemo(() => periodOptions(card, inferred), [card, inferred])
  const [periodEnd, setPeriodEnd] = useState(inferred?.end ?? options[0]?.end ?? '')
  const paidPeriod = options.find((o) => o.end === periodEnd) ?? options[0]

  // só linhas parceladas que ainda têm parcela pela frente
  const candidates = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.installmentIndex !== undefined && row.installmentTotal !== undefined && row.installmentIndex < row.installmentTotal)
  const ignoredCount = rows.length - candidates.length

  // projeção de todas as linhas juntas: duas compras iguais parceladas não
  // podem "casar" com o mesmo lançamento que já existe
  const projections = useMemo(() => {
    const used = new Set<string>()
    const map = new Map<number, ProjectedInstallment[]>()
    if (!paidPeriod) return map
    for (const { row, index } of candidates) {
      if (!row.selected) continue
      map.set(index, projectInstallments(row, paidPeriod, card.closingDay, cardTransactions, used))
    }
    for (const { row, index } of candidates) {
      if (row.selected) continue
      map.set(index, projectInstallments(row, paidPeriod, card.closingDay, cardTransactions, new Set(used)))
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, paidPeriod, card.closingDay, cardTransactions])

  const toCreate: ReviewedEntry[] = candidates.flatMap(({ row, index }) => {
    if (!row.selected) return []
    return (projections.get(index) ?? [])
      .filter((p) => !p.existing)
      .map((p) => ({
        date: p.date,
        description: row.description,
        amount: row.amount,
        type: row.type,
        categoryId: row.categoryId,
        installmentIndex: p.installmentIndex,
        installmentTotal: p.installmentTotal,
      }))
  })
  const total = toCreate.reduce((sum, e) => sum + (e.type === 'expense' ? e.amount : -e.amount), 0)
  const canConfirm =
    !importing &&
    toCreate.length > 0 &&
    candidates.every(({ row }) => !row.selected || row.categoryId)

  return (
    <>
      <div className="flex flex-col gap-2 rounded-2xl border border-border-light bg-surface-light p-3 text-sm dark:border-border-dark dark:bg-surface-dark-elevated">
        <p className="text-light-secondary dark:text-dark-secondary">
          Nada desta fatura é lançado e nenhum saldo muda. O app só lê as compras parceladas e cria
          as parcelas que ainda vão cair nas próximas faturas, em aberto. Parcela que já existe no
          cartão (do banco ou lançada antes) não é criada de novo.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-light-secondary dark:text-dark-secondary">
            Este arquivo é a
          </span>
          <select
            value={paidPeriod?.end ?? ''}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="w-full rounded-lg border border-border-light bg-transparent px-2 py-1.5 text-sm text-light-primary outline-none dark:border-border-dark dark:text-dark-primary"
          >
            {options.map((o) => (
              <option key={o.end} value={o.end}>
                {periodLabel(card, o)}
                {o.end === inferred?.end ? ' (pelo arquivo)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {candidates.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-light p-4 text-center text-sm text-light-secondary dark:border-border-dark dark:text-dark-secondary">
          Não achei compra parcelada com parcelas pela frente neste arquivo. O app reconhece
          parcelas pelo "3/10" no fim da descrição.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {candidates.map(({ row, index }) => {
            const projected = projections.get(index) ?? []
            const fresh = projected.filter((p) => !p.existing)
            const already = projected.length - fresh.length
            const first = projected[0]
            const last = projected[projected.length - 1]
            return (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-2xl border border-border-light bg-surface-light p-3 dark:border-border-dark dark:bg-surface-dark-elevated"
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    aria-label="Selecionar"
                    checked={row.selected}
                    onChange={(e) => onUpdateRow(index, { selected: e.target.checked })}
                    className="mt-1.5 h-4 w-4 shrink-0 accent-brand-500"
                  />
                  <div className="min-w-0 flex-1">
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) => onUpdateRow(index, { description: e.target.value })}
                      className="w-full truncate bg-transparent text-sm font-medium text-light-primary outline-none dark:text-dark-primary"
                    />
                    <p className="text-xs text-light-secondary dark:text-dark-secondary">
                      Paga nesta fatura: {row.installmentIndex}/{row.installmentTotal}
                      {first && last
                        ? ` · faltam ${projected.length}: ${first.installmentIndex}/${row.installmentTotal} em ${monthLabel(getDueDate(first.period.end, card.dueDay))}${projected.length > 1 ? ` até ${last.installmentIndex}/${row.installmentTotal} em ${monthLabel(getDueDate(last.period.end, card.dueDay))}` : ''}`
                        : ''}
                    </p>
                    {row.selected ? (
                      <p className="text-xs text-light-secondary dark:text-dark-secondary">
                        {fresh.length > 0
                          ? `Cria ${fresh.length} parcela(s), ${formatBRL(fresh.length * row.amount)} no total`
                          : 'Nada a criar'}
                        {already > 0 ? (
                          <span className="text-amber-600 dark:text-amber-400">
                            {' '}
                            · {already} já está(ão) no cartão
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                  <p
                    className={cn(
                      'shrink-0 text-sm font-semibold',
                      row.type === 'expense' ? 'text-danger' : 'text-brand-500',
                    )}
                  >
                    {formatBRL(row.amount)}
                    <span className="block text-right text-[10px] font-normal text-light-secondary dark:text-dark-secondary">
                      por parcela
                    </span>
                  </p>
                </div>

                {row.selected ? (
                  <select
                    value={row.categoryId}
                    onChange={(e) => onUpdateRow(index, { categoryId: e.target.value })}
                    className={cn(
                      'w-full rounded-lg border bg-transparent px-2 py-1.5 text-xs text-light-primary outline-none dark:text-dark-primary',
                      row.categoryId ? 'border-border-light dark:border-border-dark' : 'border-danger',
                    )}
                  >
                    <option value="">Selecione a categoria</option>
                    {categoryOptions(categories, row.type).map(({ category, label }) => (
                      <option key={category.id} value={category.id}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-border-light bg-surface-light p-4 dark:border-border-dark dark:bg-surface-dark-elevated">
        {ignoredCount > 0 ? (
          <p className="text-xs text-light-secondary dark:text-dark-secondary">
            {ignoredCount} lançamento(s) à vista ou na última parcela ficaram de fora (já pagos).
          </p>
        ) : null}
        <div className="flex items-center justify-between text-sm">
          <span className="text-light-secondary dark:text-dark-secondary">
            {toCreate.length} parcela(s) futura(s)
          </span>
          <span className="font-semibold text-danger">{formatBRL(total)}</span>
        </div>
        {importError ? <p className="text-sm text-danger">{importError}</p> : null}
        <Button type="button" onClick={() => onConfirm(toCreate)} disabled={!canConfirm}>
          {importing ? 'Criando...' : `Criar ${toCreate.length} parcela(s) futura(s)`}
        </Button>
        <Button type="button" variant="secondary" onClick={onReset} disabled={importing}>
          Escolher outro arquivo
        </Button>
      </div>
    </>
  )
}
