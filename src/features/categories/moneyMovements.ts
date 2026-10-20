import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'
import { transferLogsCollection, type AccountTransferLog } from '../accounts/transferLog'
import { caixinhasCollection } from '../caixinhas/api'
import { caixinhaMovementsCollection } from '../caixinhas/movements'
import type { Caixinha, CaixinhaMovement } from '../caixinhas/types'
import type { TransactionType } from '../transactions/types'
import type { CategoryTotal } from './categoryTotals'

// Dinheiro que só muda de lugar — transferência entre contas, guardar e
// resgatar caixinha — não é receita nem despesa, então não tem categoria
// de verdade. Na divisão por categoria do extrato ele aparece em
// "categorias" fixas próprias, pra pessoa ver tudo o que entrou e saiu da
// conta no mês, sem mexer nos totais de receitas/despesas.
export const TRANSFER_SLICE = { categoryId: '__transfers__', name: 'Transferências', color: '#3b82f6' }
export const RESERVE_SLICE = { categoryId: '__reserves__', name: 'Reservas', color: '#a855f7' }
export const REDEEM_SLICE = { categoryId: '__redeems__', name: 'Resgates', color: '#14b8a6' }

export interface MoneyMovements {
  transfers: AccountTransferLog[]
  caixinhaMovements: CaixinhaMovement[]
  caixinhas: Caixinha[]
}

// Coleção ainda sem regra publicada no Firestore (ou sem permissão) só
// deixa a parte dela vazia — a tela continua funcionando.
export function useMoneyMovements(uid: string): MoneyMovements {
  const [transfers, setTransfers] = useState<AccountTransferLog[]>([])
  const [caixinhaMovements, setCaixinhaMovements] = useState<CaixinhaMovement[]>([])
  const [caixinhas, setCaixinhas] = useState<Caixinha[]>([])

  useEffect(() => {
    if (!uid) return
    const unsubscribers = [
      onSnapshot(
        transferLogsCollection(uid),
        (snapshot) => setTransfers(snapshot.docs.map((d) => d.data())),
        () => setTransfers([]),
      ),
      onSnapshot(
        caixinhaMovementsCollection(uid),
        (snapshot) => setCaixinhaMovements(snapshot.docs.map((d) => d.data())),
        () => setCaixinhaMovements([]),
      ),
      onSnapshot(
        caixinhasCollection(uid),
        (snapshot) => setCaixinhas(snapshot.docs.map((d) => d.data())),
        () => setCaixinhas([]),
      ),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [uid])

  return { transfers, caixinhaMovements, caixinhas }
}

// Totais do mês por sentido: saída = transferência enviada + guardado na
// caixinha; entrada = transferência recebida + resgatado. Com `accountId`,
// só o que é dessa conta (caixinha conta pela conta a que pertence).
// Rendimento e ajuste ficam de fora — rendimento já é receita de verdade.
export function moneyMovementTotals(
  movements: MoneyMovements,
  selectedMonth: string,
  accountId?: string,
): Record<TransactionType, CategoryTotal[]> {
  const caixinhaAccount = new Map(movements.caixinhas.map((c) => [c.id, c.accountId]))
  let transfersOut = 0
  let transfersIn = 0
  let reserved = 0
  let redeemed = 0

  for (const t of movements.transfers) {
    if (!t.date.startsWith(selectedMonth)) continue
    if (accountId !== undefined && t.accountId !== accountId) continue
    if (t.type === 'expense') transfersOut += t.amount
    else transfersIn += t.amount
  }
  for (const m of movements.caixinhaMovements) {
    if (m.type !== 'guardar' && m.type !== 'resgatar') continue
    if (!m.date.startsWith(selectedMonth)) continue
    // caixinha encerrada: não dá mais pra saber a conta, só entra no geral
    if (accountId !== undefined && caixinhaAccount.get(m.caixinhaId) !== accountId) continue
    if (m.type === 'guardar') reserved += Math.abs(m.amount)
    else redeemed += Math.abs(m.amount)
  }

  const slice = (base: typeof TRANSFER_SLICE, value: number): CategoryTotal[] =>
    value > 0 ? [{ ...base, value }] : []
  return {
    expense: [...slice(TRANSFER_SLICE, transfersOut), ...slice(RESERVE_SLICE, reserved)],
    income: [...slice(TRANSFER_SLICE, transfersIn), ...slice(REDEEM_SLICE, redeemed)],
  }
}
