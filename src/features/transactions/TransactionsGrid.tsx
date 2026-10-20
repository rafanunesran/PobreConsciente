import { useEffect, useMemo, useState } from 'react'
import { format, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { TransactionCompactCard } from './TransactionCompactCard'
import { CardInvoiceRowCard } from '../cards/CardInvoiceRowCard'
import { groupCardTransactionsByInvoice, type CardInvoiceGroup } from '../cards/invoiceUtils'
import { cn, formatBRL } from '../../lib/utils'
import type { Transaction } from './types'
import type { Category } from '../categories/types'
import type { Account } from '../accounts/types'
import type { CreditCard } from '../cards/types'
import { useBulkPay, invoiceKey } from './useBulkPay'
import { BulkPayBar } from './BulkPayBar'
import { MoneyMovementRowCard } from './MoneyMovementRowCard'
import { FilterStatCards, type FilterStat } from './FilterStatCards'
import type { MoneyMovementRow } from '../categories/moneyMovements'

interface TransactionsGridProps {
  workspaceId: string
  transactions: Transaction[]
  categoriesById: Map<string, Category>
  accountsById: Map<string, Account>
  cardsById: Map<string, CreditCard>
  selectedMonth: string // 'YYYY-MM'
  // Tela de pendentes: só o que falta pagar/receber, sem o resumo do mês.
  pendingOnly?: boolean
  // id do lançamento (ou invoiceKey da fatura) recém-salvo — rola até ele e
  // destaca a linha, pra pessoa ver que o registro entrou.
  highlightKey?: string | null
  // Transferências e reservas do mês (ver categories/moneyMovements.ts) —
  // com elas, aparece o card "Reserva" e o "Saldo" lista também essas
  // linhas, só pra conferência: nunca somam em nenhum total.
  moneyMovements?: MoneyMovementRow[]
}

// Os cards do resumo são o filtro: Saldo = tudo, Reserva = só caixinha.
type TypeFilter = 'all' | 'expense' | 'income' | 'reserve' | 'pending'

type Row =
  | { kind: 'transaction'; key: string; date: string; signed: number; transaction: Transaction }
  | { kind: 'invoice'; key: string; date: string; signed: number; group: CardInvoiceGroup }
  | { kind: 'movement'; key: string; date: string; signed: number; movement: MoneyMovementRow }

function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (isToday(d)) return 'Hoje'
  if (isYesterday(d)) return 'Ontem'
  return format(d, "EEE, d 'de' MMM", { locale: ptBR })
}

export function TransactionsGrid({
  workspaceId,
  transactions,
  categoriesById,
  accountsById,
  cardsById,
  selectedMonth,
  pendingOnly = false,
  highlightKey = null,
  moneyMovements,
}: TransactionsGridProps) {
  const [filter, setFilter] = useState<TypeFilter>('all')
  const cards = useMemo(() => Array.from(cardsById.values()), [cardsById])
  const accounts = useMemo(() => Array.from(accountsById.values()), [accountsById])
  const categories = useMemo(() => Array.from(categoriesById.values()), [categoriesById])

  const { expenses, incomes, expenseGroups, incomeGroups, totalExpenses, totalIncomes } = useMemo(() => {
    // Cartão é representado pela fatura agregada (ver abaixo), nunca linha a
    // linha — só transações de conta entram na listagem individual, e essas
    // sim usam a data da própria movimentação pro filtro de mês.
    const accountTransactions = transactions.filter((t) => t.accountId !== undefined)
    const ofMonth = accountTransactions.filter(
      (t) => t.date.startsWith(selectedMonth) && (!pendingOnly || !t.paid),
    )

    // Agrupa TODAS as transações de cartão primeiro (sem filtrar por mês da
    // compra) e só então filtra pelo mês de VENCIMENTO — uma compra feita
    // depois do fechamento vence no mês seguinte, não no mês da compra.
    // Só o que ainda está em aberto (unpaidAmount) entra aqui: uma fatura
    // já paga tem sua própria transação "Pagamento fatura X" (vinculada à
    // conta, aparece na listagem individual abaixo) — mostrar o total
    // histórico aqui TAMBÉM duplicaria esse valor no extrato.
    const allGroups = groupCardTransactionsByInvoice(transactions, cards)
    // Pendentes: só fatura com valor devido (>0) — um saldo credor sem
    // cobrança pra abater não é "a pagar" (payCardInvoice exige owed > 0).
    const groupsOfMonth = allGroups.filter(
      (g) => g.dueMonth === selectedMonth && (pendingOnly ? g.unpaidAmount > 0 : g.unpaidAmount !== 0),
    )

    const expenses = ofMonth.filter((t) => t.type === 'expense')
    const incomes = ofMonth.filter((t) => t.type === 'income')
    const expenseGroups = groupsOfMonth.filter((g) => g.unpaidAmount > 0)
    const incomeGroups = groupsOfMonth.filter((g) => g.unpaidAmount < 0)

    const totalExpenses =
      expenses.reduce((sum, t) => sum + t.amount, 0) + expenseGroups.reduce((sum, g) => sum + g.unpaidAmount, 0)
    const totalIncomes =
      incomes.reduce((sum, t) => sum + t.amount, 0) +
      incomeGroups.reduce((sum, g) => sum + Math.abs(g.unpaidAmount), 0)

    return { expenses, incomes, expenseGroups, incomeGroups, totalExpenses, totalIncomes }
  }, [transactions, selectedMonth, cards, pendingOnly])

  // Despesas e receitas numa lista só, em ordem cronológica (mais recente
  // primeiro) — o filtro decide o que aparece; os totais do resumo não mudam.
  const { visibleTransactions, visibleInvoices } = useMemo(() => {
    const wantExpense = filter !== 'income' && filter !== 'reserve'
    const wantIncome = filter !== 'expense' && filter !== 'reserve'
    const onlyPending = filter === 'pending'
    return {
      visibleTransactions: [...(wantExpense ? expenses : []), ...(wantIncome ? incomes : [])].filter(
        (t) => !onlyPending || !t.paid,
      ),
      // fatura listada aqui sempre tem algo em aberto — conta como pendente
      visibleInvoices: [...(wantExpense ? expenseGroups : []), ...(wantIncome ? incomeGroups : [])],
    }
  }, [filter, expenses, incomes, expenseGroups, incomeGroups])

  const visibleMovements = useMemo(
    () =>
      filter === 'all'
        ? (moneyMovements ?? [])
        : filter === 'reserve'
          ? (moneyMovements ?? []).filter((m) => m.kind === 'reserve')
          : [],
    [filter, moneyMovements],
  )

  const days = useMemo(() => {
    const rows: Row[] = [
      ...visibleTransactions.map(
        (t): Row => ({
          kind: 'transaction',
          key: t.id,
          date: t.date,
          signed: t.type === 'expense' ? -t.amount : t.amount,
          transaction: t,
        }),
      ),
      ...visibleInvoices.map(
        (g): Row => ({ kind: 'invoice', key: invoiceKey(g), date: g.dueDate, signed: -g.unpaidAmount, group: g }),
      ),
      // signed 0: transferência/reserva não muda o total do dia
      ...visibleMovements.map((m): Row => ({ kind: 'movement', key: m.key, date: m.date, signed: 0, movement: m })),
    ].sort((a, b) => b.date.localeCompare(a.date))

    const byDay: { date: string; rows: Row[]; total: number; counted: number }[] = []
    for (const row of rows) {
      const counted = row.kind === 'movement' ? 0 : 1
      const last = byDay[byDay.length - 1]
      if (last && last.date === row.date) {
        last.rows.push(row)
        last.total += row.signed
        last.counted += counted
      } else {
        byDay.push({ date: row.date, rows: [row], total: row.signed, counted })
      }
    }
    return byDay
  }, [visibleTransactions, visibleInvoices, visibleMovements])

  useEffect(() => {
    if (!highlightKey) return
    const el = document.getElementById(`row-${highlightKey}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightKey, days])
  const bulk = useBulkPay({
    workspaceId,
    transactions,
    cards,
    categories,
    visibleTransactions,
    visibleInvoices,
    resetKey: `${selectedMonth}|${filter}`,
  })

  const resultado = totalIncomes - totalExpenses
  // guardado menos resgatado no mês
  const reservaLiquida = (moneyMovements ?? [])
    .filter((m) => m.kind === 'reserve')
    .reduce((sum, m) => sum + (m.direction === 'out' ? m.amount : -m.amount), 0)

  const stats: FilterStat<TypeFilter>[] = [
    { value: 'income', label: 'Receitas', amount: totalIncomes, tone: 'text-brand-500' },
    { value: 'expense', label: 'Despesas', amount: totalExpenses, tone: 'text-danger' },
    {
      value: 'all',
      label: 'Saldo',
      amount: resultado,
      tone: resultado >= 0 ? 'text-brand-500' : 'text-danger',
    },
    ...(moneyMovements
      ? [{ value: 'reserve' as const, label: 'Reserva', amount: reservaLiquida, tone: 'text-light-primary dark:text-dark-primary' }]
      : []),
  ]

  return (
    <div className="flex flex-col gap-4">
      <BulkPayBar bulk={bulk} accounts={accounts} />

      {pendingOnly ? null : (
        <FilterStatCards stats={stats} selected={filter} onSelect={setFilter} />
      )}

      {pendingOnly ? null : (
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={filter === 'pending'}
            onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
            className={cn(
              'shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors duration-200',
              filter === 'pending'
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-border-light text-light-secondary hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary',
            )}
          >
            Só pendentes
          </button>
        </div>
      )}

      {days.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-light py-10 text-center text-sm text-light-secondary dark:border-border-dark dark:text-dark-secondary">
          {pendingOnly || filter === 'pending'
            ? 'Nada pendente neste mês.'
            : filter === 'expense'
              ? 'Nenhuma despesa neste mês.'
              : filter === 'income'
                ? 'Nenhuma receita neste mês.'
                : filter === 'reserve'
                  ? 'Nada guardado nem resgatado neste mês.'
                  : 'Nenhum lançamento neste mês. Toque em + para adicionar.'}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {days.map((day) => (
            <section key={day.date} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between px-1">
                <h3 className="text-sm font-semibold text-light-secondary first-letter:uppercase dark:text-dark-secondary">
                  {dayLabel(day.date)}
                </h3>
                {day.counted > 0 ? (
                  <span
                    className={cn(
                      'tabular text-xs font-medium',
                      day.total >= 0 ? 'text-brand-500' : 'text-light-secondary dark:text-dark-secondary',
                    )}
                  >
                    {day.total >= 0 ? '+ ' : '− '}
                    {formatBRL(Math.abs(day.total))}
                  </span>
                ) : null}
              </div>
              <div className="rounded-2xl border border-border-light bg-surface-light divide-y divide-border-light overflow-hidden dark:border-transparent dark:bg-surface-dark-elevated dark:divide-border-dark">
              {day.rows.map((row) => (
                <div key={row.key} id={`row-${row.key}`} className="scroll-mt-24">
                  {row.kind === 'movement' ? (
                    <MoneyMovementRowCard
                      row={row.movement}
                      linkedName={accountsById.get(row.movement.accountId ?? '')?.name}
                    />
                  ) : row.kind === 'invoice' ? (
                    <CardInvoiceRowCard
                      group={row.group}
                      selected={bulk.selectedInvoiceKeys.has(row.key)}
                      onToggleSelect={() => bulk.toggleInvoice(row.key)}
                      highlighted={highlightKey === row.key}
                    />
                  ) : (
                    // Cartão nunca chega aqui — sempre representado pelo
                    // CardInvoiceRowCard agregado (ver groupCardTransactionsByInvoice).
                    <TransactionCompactCard
                      transaction={row.transaction}
                      category={categoriesById.get(row.transaction.categoryId)}
                      linkedName={accountsById.get(row.transaction.accountId ?? '')?.name}
                      selected={bulk.selectedIds.has(row.key)}
                      onToggleSelect={() => bulk.toggle(row.key)}
                      onConfirm={() => void bulk.confirmOne(row.transaction)}
                      confirming={bulk.confirmingIds.has(row.key)}
                      showDate={false}
                      highlighted={highlightKey === row.key}
                    />
                  )}
                </div>
              ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
