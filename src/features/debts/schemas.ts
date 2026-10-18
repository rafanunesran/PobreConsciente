import { z } from 'zod'
import { DEBT_DIRECTIONS } from './types'

export const debtSchema = z.object({
  direction: z.enum(DEBT_DIRECTIONS),
  person: z.string().trim().min(1, 'Informe a pessoa').max(40, 'Máximo de 40 caracteres'),
  description: z.string().trim().max(60, 'Máximo de 60 caracteres'),
  amount: z.number('Informe um valor válido').positive('Informe um valor maior que zero'),
  dueDate: z.string().optional(), // '' = sem vencimento
})

export type DebtFormData = z.infer<typeof debtSchema>

export const debtPaymentSchema = z.object({
  amount: z.number('Informe um valor válido').positive('Informe um valor maior que zero'),
  date: z.string().min(1, 'Informe a data'),
  accountId: z.string().optional(), // '' = só registra, não mexe em conta
})

export type DebtPaymentFormData = z.infer<typeof debtPaymentSchema>
