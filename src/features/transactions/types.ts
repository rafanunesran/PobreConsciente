export const TRANSACTION_TYPES = ['expense', 'income'] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

export interface Transaction {
  id: string
  type: TransactionType
  amount: number // sempre positivo; o sinal do efeito no saldo vem de `type`
  date: string // 'YYYY-MM-DD', de <input type="date">
  description: string
  categoryId: string
  paid: boolean // controla se a transação afeta o saldo da conta vinculada
  accountId?: string // presente sse account-linked
  cardId?: string // presente sse card-linked (despesa normal ou receita como crédito/ajuste de fatura)
  recurringRuleId?: string // presente sse gerada por uma regra de recorrência fixa
  installmentGroupId?: string // presente sse parte de um parcelamento
  installmentIndex?: number // 1-based
  installmentTotal?: number
  // presente sse esta é a transação "Pagamento fatura X" criada por
  // payCardInvoice — guarda os ids das transações de cartão que ela fechou.
  // Se esta transação for editada de volta pra não-paga (ou apagada), essas
  // voltam a não-pagas junto — ver updateTransaction/deleteTransaction.
  paidTransactionIds?: string[]
  tags?: string[] // marcadores livres (ex: "viagem", "reforma"), já normalizados — ver tags.ts
  createdBy: string // uid de quem criou — nunca alterado em updates
}

export interface TransactionFormData {
  type: TransactionType
  amount: number
  date: string
  description: string
  categoryId: string
  paid: boolean
  accountId?: string
  cardId?: string
  recurringRuleId?: string
  installmentGroupId?: string
  installmentIndex?: number
  installmentTotal?: number
  // undefined = "não mexer" (updateTransaction preserva as tags gravadas);
  // [] = remover todas. Só o form de lançamento manda esse campo.
  tags?: string[]
}
