import type { Account } from '../accounts/types'
import type { Caixinha } from '../caixinhas/types'
import { cardOccupiedLimit } from '../cards/invoiceUtils'
import type { CreditCard } from '../cards/types'
import { debtRemaining, type Debt } from '../debts/types'
import { lastMonths, monthlyFlow } from '../reports/monthlyFlow'
import type { Transaction } from '../transactions/types'

export interface NetWorth {
  accounts: number
  caixinhas: number
  receivables: number // dívidas "me devem" em aberto
  cardDebt: number // faturas em aberto (todas, não só a do mês)
  payables: number // dívidas "eu devo" em aberto
  assets: number
  liabilities: number
  net: number
}

export function computeNetWorth(
  accounts: Account[],
  caixinhas: Caixinha[],
  cards: CreditCard[],
  transactions: Transaction[],
  debts: Debt[],
): NetWorth {
  // Patrimônio conta todas as contas, inclusive as fora do total do Home
  // (investimentos etc.) — é dinheiro seu do mesmo jeito.
  const accountsTotal = accounts.reduce((sum, a) => sum + a.balance, 0)
  const caixinhasTotal = caixinhas.reduce((sum, c) => sum + c.balance, 0)
  const receivables = debts.filter((d) => d.direction === 'owed').reduce((sum, d) => sum + debtRemaining(d), 0)
  const payables = debts.filter((d) => d.direction === 'owe').reduce((sum, d) => sum + debtRemaining(d), 0)
  const cardDebt = cards.reduce((sum, c) => sum + Math.max(cardOccupiedLimit(transactions, c.id), 0), 0)
  const assets = accountsTotal + caixinhasTotal + receivables
  const liabilities = cardDebt + payables
  return {
    accounts: accountsTotal,
    caixinhas: caixinhasTotal,
    receivables,
    cardDebt,
    payables,
    assets,
    liabilities,
    net: assets - liabilities,
  }
}

export type HealthLevel = 'good' | 'ok' | 'bad'

export interface HealthIndicator {
  key: 'savings' | 'emergency' | 'debt'
  label: string
  value: string
  level: HealthLevel
  points: number // contribuição pro score
  maxPoints: number
  tip: string
}

export interface FinancialHealth {
  score: number // 0-100
  label: string
  indicators: HealthIndicator[]
  hasEnoughData: boolean
}

const MONTHS_FOR_AVERAGE = 3

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

// Três sinais clássicos de finanças pessoais, cada um valendo uma fatia
// do score: quanto sobra da renda, quantos meses a reserva aguenta e o
// tamanho das dívidas perto da renda. Média dos últimos 3 meses FECHADOS
// (o mês corrente ainda está pela metade e distorceria a conta).
export function computeFinancialHealth(
  netWorth: NetWorth,
  transactions: Transaction[],
  cardsById: Map<string, CreditCard>,
  currentMonth: string,
): FinancialHealth {
  const closedMonths = lastMonths(currentMonth, MONTHS_FOR_AVERAGE + 1).slice(0, MONTHS_FOR_AVERAGE)
  const flow = monthlyFlow(transactions, cardsById, closedMonths)
  const avgIncome = flow.reduce((s, f) => s + f.income, 0) / MONTHS_FOR_AVERAGE
  const avgExpense = flow.reduce((s, f) => s + f.expense, 0) / MONTHS_FOR_AVERAGE
  const hasEnoughData = flow.some((f) => f.income > 0 || f.expense > 0)

  // 1. Taxa de economia: 20%+ é a referência comum (regra 50/30/20).
  const savingsRate = avgIncome > 0 ? (avgIncome - avgExpense) / avgIncome : 0
  const savingsPoints = Math.round(clamp01(savingsRate / 0.2) * 35)
  const savings: HealthIndicator = {
    key: 'savings',
    label: 'Taxa de economia',
    value: avgIncome > 0 ? `${(savingsRate * 100).toFixed(0)}%` : '—',
    level: savingsRate >= 0.2 ? 'good' : savingsRate >= 0.05 ? 'ok' : 'bad',
    points: savingsPoints,
    maxPoints: 35,
    tip:
      savingsRate >= 0.2
        ? 'Você guarda 20% ou mais da renda. Excelente.'
        : 'Tente guardar pelo menos 20% do que entra — orçamentos por categoria ajudam a achar onde cortar.',
  }

  // 2. Reserva de emergência: 6 meses de despesas é a referência.
  const liquid = netWorth.accounts + netWorth.caixinhas
  const emergencyMonths = avgExpense > 0 ? liquid / avgExpense : liquid > 0 ? 6 : 0
  const emergencyPoints = Math.round(clamp01(emergencyMonths / 6) * 40)
  const emergency: HealthIndicator = {
    key: 'emergency',
    label: 'Reserva de emergência',
    value: `${Math.max(emergencyMonths, 0).toFixed(1).replace('.', ',')} meses`,
    level: emergencyMonths >= 6 ? 'good' : emergencyMonths >= 3 ? 'ok' : 'bad',
    points: emergencyPoints,
    maxPoints: 40,
    tip:
      emergencyMonths >= 6
        ? 'Sua reserva cobre 6 meses ou mais de despesas.'
        : 'O ideal é ter 6 meses de despesas guardados — uma caixinha com meta ajuda a chegar lá.',
  }

  // 3. Dívidas x renda: até 30% da renda mensal é confortável.
  const debtRatio = avgIncome > 0 ? netWorth.liabilities / avgIncome : netWorth.liabilities > 0 ? 2 : 0
  const debtPoints = Math.round((1 - clamp01((debtRatio - 0.3) / 1.2)) * 25)
  const debt: HealthIndicator = {
    key: 'debt',
    label: 'Dívidas sobre a renda',
    value: avgIncome > 0 ? `${(debtRatio * 100).toFixed(0)}%` : netWorth.liabilities > 0 ? 'sem renda' : '0%',
    level: debtRatio <= 0.3 ? 'good' : debtRatio <= 1 ? 'ok' : 'bad',
    points: debtPoints,
    maxPoints: 25,
    tip:
      debtRatio <= 0.3
        ? 'Faturas e dívidas em aberto estão sob controle.'
        : 'Faturas e dívidas em aberto passam de 30% da renda mensal — priorize quitar as mais caras.',
  }

  const score = savingsPoints + emergencyPoints + debtPoints
  const label = score >= 80 ? 'Ótima' : score >= 60 ? 'Boa' : score >= 40 ? 'Atenção' : 'Crítica'
  return { score, label, indicators: [savings, emergency, debt], hasEnoughData }
}
