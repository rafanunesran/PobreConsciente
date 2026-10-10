import { z } from 'zod'

export const caixinhaSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(40, 'Máximo de 40 caracteres'),
  yieldLabel: z.string().trim().max(30, 'Máximo de 30 caracteres').optional(),
  // Campo em branco chega como undefined (ver setValueAs no form).
  goalAmount: z.number('Informe um valor válido').positive('Informe um valor maior que zero').optional(),
  goalDate: z.string().optional(),
})

export type CaixinhaFormData = z.infer<typeof caixinhaSchema>

// Guardar e resgatar reaproveitam o mesmo schema — só o teto de validação
// muda por tela (definido no componente, não aqui), não o formato do campo.
export const caixinhaTransferSchema = z.object({
  amount: z.number('Informe um valor válido').positive('Informe um valor maior que zero'),
})

export type CaixinhaTransferFormData = z.infer<typeof caixinhaTransferSchema>

export const caixinhaYieldSchema = z.object({
  amount: z.number('Informe um valor válido').positive('Informe um valor maior que zero'),
})

export type CaixinhaYieldFormData = z.infer<typeof caixinhaYieldSchema>

export const caixinhaAdjustSchema = z.object({
  realBalance: z.number('Informe um valor válido').nonnegative('Informe um valor válido'),
})

export type CaixinhaAdjustFormData = z.infer<typeof caixinhaAdjustSchema>
