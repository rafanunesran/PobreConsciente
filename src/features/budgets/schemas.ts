import { z } from 'zod'

export const budgetSchema = z.object({
  categoryId: z.string().min(1, 'Selecione uma categoria'),
  amount: z.number('Informe um valor válido').positive('Informe um valor maior que zero'),
})

export type BudgetFormData = z.infer<typeof budgetSchema>
