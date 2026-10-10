export interface Caixinha {
  id: string
  accountId: string
  name: string
  balance: number
  yieldLabel?: string // só rótulo informativo, ex: "110% do CDI" — nunca calculado
  goalAmount?: number // meta de valor a juntar (> 0) — opcional
  goalDate?: string // 'YYYY-MM-DD' — prazo da meta, opcional mesmo com meta de valor
  createdBy: string // uid de quem criou — nunca alterado em updates
}

export const CAIXINHA_MOVEMENT_TYPES = ['guardar', 'resgatar', 'rendimento', 'ajuste'] as const
export type CaixinhaMovementType = (typeof CAIXINHA_MOVEMENT_TYPES)[number]

export const CAIXINHA_MOVEMENT_LABELS: Record<CaixinhaMovementType, string> = {
  guardar: 'Guardado',
  resgatar: 'Resgatado',
  rendimento: 'Rendimento',
  ajuste: 'Ajuste de saldo',
}

// Log de histórico só pra exibição (extrato da caixinha) — nunca vira
// Transaction, então não afeta despesas/receitas.
export interface CaixinhaMovement {
  id: string
  caixinhaId: string
  type: CaixinhaMovementType
  amount: number // efeito assinado no saldo da caixinha: positivo aumenta, negativo diminui
  date: string // 'YYYY-MM-DD'
  createdBy: string // uid de quem fez a movimentação
}
