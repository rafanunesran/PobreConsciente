import { z } from 'zod'
import { TRANSACTION_TYPES } from '../transactions/types'

export const categoryRuleSchema = z.object({
  pattern: z.string().trim().min(2, 'Mínimo de 2 caracteres').max(40, 'Máximo de 40 caracteres'),
  type: z.enum(TRANSACTION_TYPES),
  categoryId: z.string().min(1, 'Selecione uma categoria'),
  tags: z.array(z.string()).optional(),
})

export type CategoryRuleFormData = z.infer<typeof categoryRuleSchema>
