// 'owe'  -> eu devo a alguém (empréstimo que peguei, conta dividida a pagar)
// 'owed' -> alguém me deve (emprestei, paguei a parte de outra pessoa)
export const DEBT_DIRECTIONS = ['owe', 'owed'] as const
export type DebtDirection = (typeof DEBT_DIRECTIONS)[number]

export const DEBT_DIRECTION_LABELS: Record<DebtDirection, string> = {
  owe: 'Eu devo',
  owed: 'Me devem',
}

// Pagamento parcial (ou total) registrado na dívida. `transactionId` existe
// quando o pagamento também movimentou uma conta (virou lançamento).
export interface DebtPayment {
  id: string
  date: string // 'YYYY-MM-DD'
  amount: number
  transactionId?: string
}

export interface Debt {
  id: string
  direction: DebtDirection
  person: string
  description: string
  amount: number // valor total combinado
  dueDate?: string // 'YYYY-MM-DD'
  payments: DebtPayment[]
  createdAt: string // ISO
  createdBy: string
}

export function debtPaid(debt: Debt): number {
  return debt.payments.reduce((sum, p) => sum + p.amount, 0)
}

export function debtRemaining(debt: Debt): number {
  return Math.max(Math.round((debt.amount - debtPaid(debt)) * 100) / 100, 0)
}
