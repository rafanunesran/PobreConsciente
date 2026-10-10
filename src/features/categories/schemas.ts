import { z } from 'zod'
import { CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_TYPES } from './types'

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(30, 'Máximo de 30 caracteres'),
  type: z.enum(CATEGORY_TYPES, 'Selecione um tipo'),
  icon: z.enum(CATEGORY_ICONS, 'Selecione um ícone'),
  color: z.enum(CATEGORY_COLORS, 'Selecione uma cor'),
  parentId: z.string().optional(), // '' ou ausente = categoria principal
})

export type CategoryFormData = z.infer<typeof categorySchema>
