import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { cn, formatBRL } from '../../lib/utils'
import { effectiveMonth } from '../cards/invoiceUtils'
import type { CreditCard } from '../cards/types'
import type { Transaction } from './types'

interface BalanceteCardProps {
  transactions: Transaction[]
  selectedMonth: string // 'YYYY-MM'
  cardsById: Map<string, CreditCard>
}

export function BalanceteCard({ transactions, selectedMonth, cardsById }: BalanceteCardProps) {
  const balancete = useMemo(() => {
    // Pago/recebido já são fatos consumados — usam a data real do
    // movimento. A pagar/a receber ainda não aconteceram: pra cartão, só
    // fazem sentido no mês de VENCIMENTO da fatura (pode ser diferente do
    // mês da compra), não na data da compra em si.
    // Cartão pago nunca entra aqui individualmente — pagar a fatura já cria
    // sua própria transação "Pagamento fatura X" vinculada à conta; contar
    // a compra original TAMBÉM duplicaria o valor (mesmo raciocínio de
    // groupCardTransactionsByInvoice: cartão só conta pela fatura/pagamento
    // agregado, nunca compra a compra).
    const paidOfMonth = transactions.filter(
      (t) => t.paid && t.accountId !== undefined && t.date.startsWith(selectedMonth),
    )
    const unpaidOfMonth = transactions.filter(
      (t) => !t.paid && effectiveMonth(t, cardsById) === selectedMonth,
    )

    const recebido = paidOfMonth
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0)
    const pago = paidOfMonth
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0)
    const aReceber = unpaidOfMonth
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0)
    const aPagar = unpaidOfMonth
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0)

    // "Previsto" projeta o mês inteiro, somando o que ainda está pendente —
    // é o resultado final esperado, independente do que já foi pago.
    const previsto = recebido + aReceber - (pago + aPagar)

    return { recebido, pago, aReceber, aPagar, previsto }
  }, [transactions, selectedMonth, cardsById])

  // Mesmo formato da faixa do extrato (TransactionsGrid): Despesas e
  // Receitas do mês inteiro (pago + pendente) e Resultado = previsto.
  const despesas = balancete.pago + balancete.aPagar
  const receitas = balancete.recebido + balancete.aReceber

  return (
    <Link to="/registros" className="block">
      <Card className="grid grid-cols-3 gap-2 p-4 transition-all duration-200 hover:border-brand-500">
        <div className="min-w-0">
          <p className="text-xs text-light-secondary dark:text-dark-secondary">Despesas</p>
          <p className="truncate text-sm font-semibold text-danger">{formatBRL(despesas)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-light-secondary dark:text-dark-secondary">Receitas</p>
          <p className="truncate text-sm font-semibold text-brand-500">{formatBRL(receitas)}</p>
        </div>
        <div className="min-w-0 border-l border-border-light pl-2 dark:border-border-dark">
          <p className="text-xs text-light-secondary dark:text-dark-secondary">Resultado</p>
          <p
            className={cn(
              'truncate text-sm font-semibold',
              balancete.previsto >= 0 ? 'text-brand-500' : 'text-danger',
            )}
          >
            {formatBRL(balancete.previsto)}
          </p>
        </div>
      </Card>
    </Link>
  )
}
