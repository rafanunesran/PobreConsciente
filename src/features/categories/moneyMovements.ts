import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'
import { transferLogsCollection, type AccountTransferLog } from '../accounts/transferLog'
import { caixinhasCollection } from '../caixinhas/api'
import { caixinhaMovementsCollection } from '../caixinhas/movements'
import type { Caixinha, CaixinhaMovement } from '../caixinhas/types'

// Dinheiro que só muda de lugar — transferência entre contas, guardar e
// resgatar caixinha — não é receita nem despesa. No extrato ele aparece
// como linha à parte, só pra conferência: nunca entra nos totais de
// receitas/despesas/saldo do mês (senão o valor contaria duas vezes).
export interface MoneyMovementRow {
  key: string
  kind: 'transfer' | 'reserve'
  date: string // 'YYYY-MM-DD'
  direction: 'in' | 'out' // entrou na conta / saiu dela
  amount: number // sempre positivo
  description: string
  accountId?: string
  caixinhaId?: string
}

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

// Linhas do mês: transferências enviadas/recebidas e guardar/resgatar
// caixinha. Com `accountId`, só o que é dessa conta (caixinha conta pela
// conta a que pertence). Rendimento e ajuste ficam de fora — rendimento já
// é receita de verdade.
export function moneyMovementRows(
  movements: MoneyMovements,
  selectedMonth: string,
  accountId?: string,
): MoneyMovementRow[] {
  const caixinhasById = new Map(movements.caixinhas.map((c) => [c.id, c]))
  const rows: MoneyMovementRow[] = []

  for (const t of movements.transfers) {
    if (!t.date.startsWith(selectedMonth)) continue
    if (accountId !== undefined && t.accountId !== accountId) continue
    rows.push({
      key: `transfer-${t.id}`,
      kind: 'transfer',
      date: t.date,
      direction: t.type === 'expense' ? 'out' : 'in',
      amount: t.amount,
      description: t.description || 'Transferência',
      accountId: t.accountId,
    })
  }
  for (const m of movements.caixinhaMovements) {
    if (m.type !== 'guardar' && m.type !== 'resgatar') continue
    if (!m.date.startsWith(selectedMonth)) continue
    const caixinha = caixinhasById.get(m.caixinhaId)
    // caixinha encerrada: não dá mais pra saber a conta, só entra no geral
    if (accountId !== undefined && caixinha?.accountId !== accountId) continue
    const name = caixinha?.name ?? 'caixinha encerrada'
    rows.push({
      key: `reserve-${m.id}`,
      kind: 'reserve',
      date: m.date,
      direction: m.type === 'guardar' ? 'out' : 'in',
      amount: Math.abs(m.amount),
      description: m.type === 'guardar' ? `Guardado — ${name}` : `Resgatado — ${name}`,
      accountId: caixinha?.accountId,
      caixinhaId: caixinha?.id,
    })
  }
  return rows
}
