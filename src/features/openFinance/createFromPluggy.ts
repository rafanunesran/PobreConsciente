import type { AccountFormData } from '../accounts/schemas'
import type { CardFormData } from '../cards/schemas'
import type { CardBrand } from '../cards/types'
import type { PluggyAccount } from './types'

const NAME_MAX = 40 // mesmo teto dos forms de conta e cartão

// "Nubank" + "Ultravioleta" → "Nubank Ultravioleta"; sem repetir quando o
// nome da conta já traz a instituição ("Mercado Pago" + "Conta Mercado Pago").
function displayName(account: PluggyAccount, institution: string): string {
  const base = (account.marketingName || account.name).replace(/\s+/g, ' ').trim()
  const name = base.toLowerCase().includes(institution.toLowerCase()) ? base : `${institution} ${base}`
  return name.slice(0, NAME_MAX).trim()
}

function brandFrom(raw: string | null | undefined): CardBrand {
  const brand = (raw ?? '').toUpperCase()
  if (brand.includes('VISA')) return 'visa'
  if (brand.includes('MASTER')) return 'mastercard'
  if (brand.includes('ELO')) return 'elo'
  if (brand.includes('AMEX') || brand.includes('AMERICAN')) return 'amex'
  return 'outro'
}

// Só o dia de 'YYYY-MM-DD' — a fatura fecha/vence nesse dia todo mês.
function dayOf(date: string | null | undefined, fallback: number): number {
  const day = Number(date?.slice(8, 10))
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : fallback
}

// Cartão novo no app com o que a Pluggy sabe do cartão (creditData) — a
// pessoa pode corrigir depois em "Editar cartão".
export function cardDataFromPluggy(account: PluggyAccount, institution: string): CardFormData {
  const credit = account.creditData
  return {
    name: displayName(account, institution),
    brand: brandFrom(credit?.brand),
    limit: typeof credit?.creditLimit === 'number' && credit.creditLimit >= 0 ? credit.creditLimit : 0,
    closingDay: dayOf(credit?.balanceCloseDate, 1),
    dueDay: dayOf(credit?.balanceDueDate, 10),
  }
}

// Conta nova já com o saldo atual do banco — a partir daí os lançamentos
// importados mantêm o saldo andando junto.
export function accountDataFromPluggy(account: PluggyAccount, institution: string): AccountFormData {
  return {
    name: displayName(account, institution),
    type: account.subtype === 'SAVINGS_ACCOUNT' ? 'poupanca' : 'corrente',
    balance: typeof account.balance === 'number' ? account.balance : 0,
    includeInTotal: true,
  }
}
