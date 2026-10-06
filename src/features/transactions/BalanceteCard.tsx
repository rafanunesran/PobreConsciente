import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { cn, formatBRL } from '../../lib/utils'
import { groupCardTransactionsByInvoice } from '../cards/invoiceUtils'
import type { CreditCard } from '../cards/types'
import type { Transaction } from './types'

interface BalanceteCardProps {
  transactions: Transaction[]
  selectedMonth: string // 'YYYY-MM'
  cardsById: Map<string, CreditCard>
}

export function BalanceteCard({ transactions, selectedMonth, cardsById }: BalanceteCardProps) {
  const balancete = useMemo(() => {
    // Valores cheios do mês (pagos + pendentes), com as mesmas regras do
    // extrato/pendentes pra que os números batam:
    // - transações de conta contam pela data do movimento;
    // - cartão nunca conta compra a compra: só pela fatura agregada, no mês
    //   de VENCIMENTO, já netando créditos/ajustes (receita de cartão abate
    //   a fatura, não é receita). Fatura já paga entra pela transação
    //   "Pagamento fatura X", que é de conta — por isso só o saldo em aberto
    //   (>0) da fatura entra aqui, senão duplicaria.
    const accountOfMonth = transactions.filter(
      (t) => t.accountId !== undefined && t.date.startsWith(selectedMonth),
    )
    const receitas = accountOfMonth
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0)
    const despesasConta = accountOfMonth
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0)
    const faturasAbertas = groupCardTransactionsByInvoice(transactions, [...cardsById.values()])
      .filter((g) => g.dueMonth === selectedMonth && g.unpaidAmount > 0)
      .reduce((sum, g) => sum + g.unpaidAmount, 0)
    const despesas = despesasConta + faturasAbertas

    return { receitas, despesas, resultado: receitas - despesas }
  }, [transactions, selectedMonth, cardsById])

  return (
    <Link to="/registros" className="block">
      <Card className="flex flex-col gap-3 transition-all duration-200 hover:border-brand-500">
        <p className="text-sm font-medium text-light-primary dark:text-dark-primary">
          Balancete do mês
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="min-w-0">
            <p className="text-light-secondary dark:text-dark-secondary">Receitas</p>
            <p className="truncate font-semibold text-brand-500">{formatBRL(balancete.receitas)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-light-secondary dark:text-dark-secondary">Despesas</p>
            <p className="truncate font-semibold text-danger">{formatBRL(balancete.despesas)}</p>
          </div>
        </div>
        <div className="border-t border-border-light pt-3 dark:border-border-dark">
          <p className="text-light-secondary dark:text-dark-secondary">Resultado</p>
          <p
            className={cn(
              'truncate text-lg font-semibold',
              balancete.resultado >= 0 ? 'text-brand-500' : 'text-danger',
            )}
          >
            {formatBRL(balancete.resultado)}
          </p>
        </div>
      </Card>
    </Link>
  )
}
