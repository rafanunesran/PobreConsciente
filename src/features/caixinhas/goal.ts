import { monthsBetween } from '../transactions/dateUtils'
import { todayDateString } from '../cards/invoiceUtils'
import type { Caixinha } from './types'

export interface CaixinhaGoalProgress {
  goalAmount: number
  percent: number // 0-100 (travado em 100 quando bate a meta)
  remaining: number // >= 0
  reached: boolean
  // Quanto guardar por mês pra chegar no prazo — só existe com prazo
  // definido, ainda no futuro, e meta não batida.
  monthlyNeeded: number | null
  overdue: boolean // prazo passou sem bater a meta
}

export function caixinhaGoalProgress(caixinha: Caixinha, today: string = todayDateString()): CaixinhaGoalProgress | null {
  if (caixinha.goalAmount === undefined) return null
  const remaining = Math.max(caixinha.goalAmount - caixinha.balance, 0)
  const reached = remaining === 0
  const percent = Math.min((caixinha.balance / caixinha.goalAmount) * 100, 100)
  let monthlyNeeded: number | null = null
  let overdue = false
  if (caixinha.goalDate !== undefined && !reached) {
    if (caixinha.goalDate < today) {
      overdue = true
    } else {
      // Inclui o mês corrente: com prazo pro mês que vem, ainda dá pra
      // guardar neste e no próximo.
      const months = Math.max(monthsBetween(today, caixinha.goalDate), 0) + 1
      monthlyNeeded = remaining / months
    }
  }
  return { goalAmount: caixinha.goalAmount, percent: Math.max(percent, 0), remaining, reached, monthlyNeeded, overdue }
}
