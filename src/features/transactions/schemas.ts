import { z } from 'zod'

export const expenseSchema = z
  .object({
    amount: z.number('Informe um valor válido').positive('Informe um valor maior que zero'),
    date: z.string().min(1, 'Informe a data'),
    description: z.string().trim().min(1, 'Descrição obrigatória').max(60, 'Máximo de 60 caracteres'),
    categoryId: z.string().min(1, 'Selecione uma categoria'),
    linkedType: z.enum(['account', 'card'], 'Selecione conta ou cartão'),
    accountId: z.string().optional(),
    cardId: z.string().optional(),
    paid: z.boolean(),
    recurrence: z.enum(['none', 'fixed', 'installments']),
    installmentsCount: z.number().int().min(2, 'Mínimo de 2 parcelas').max(48, 'Máximo de 48 parcelas').optional(),
    installmentAmountMode: z.enum(['perInstallment', 'total']).optional(),
    tags: z.array(z.string()).optional(),
  })
  .refine((data) => (data.linkedType === 'account' ? Boolean(data.accountId) : Boolean(data.cardId)), {
    message: 'Selecione uma conta ou cartão',
    path: ['linkedType'],
  })
  .refine(
    (data) => data.recurrence !== 'installments' || (data.installmentsCount ?? 0) >= 2,
    { message: 'Informe o número de parcelas (mínimo 2)', path: ['installmentsCount'] },
  )

export type ExpenseFormData = z.infer<typeof expenseSchema>

export const incomeSchema = z
  .object({
    amount: z.number('Informe um valor válido').positive('Informe um valor maior que zero'),
    date: z.string().min(1, 'Informe a data'),
    description: z.string().trim().min(1, 'Descrição obrigatória').max(60, 'Máximo de 60 caracteres'),
    categoryId: z.string().min(1, 'Selecione uma categoria'),
    accountId: z.string().min(1, 'Selecione uma conta'),
    paid: z.boolean(),
    recurrence: z.enum(['none', 'fixed', 'installments']),
    installmentsCount: z.number().int().min(2, 'Mínimo de 2 parcelas').max(48, 'Máximo de 48 parcelas').optional(),
    installmentAmountMode: z.enum(['perInstallment', 'total']).optional(),
    tags: z.array(z.string()).optional(),
  })
  .refine(
    (data) => data.recurrence !== 'installments' || (data.installmentsCount ?? 0) >= 2,
    { message: 'Informe o número de parcelas (mínimo 2)', path: ['installmentsCount'] },
  )

export type IncomeFormData = z.infer<typeof incomeSchema>
