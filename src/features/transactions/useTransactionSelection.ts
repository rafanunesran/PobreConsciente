import { useEffect, useMemo, useState } from 'react'
import type { Transaction } from './types'

// Seleção múltipla do extrato (segurar uma linha ou "Selecionar"). Só vale
// o que está na tela: trocar de mês/filtro limpa, e um id que saiu da lista
// nunca recebe ação em massa.
export function useTransactionSelection(visible: Transaction[], resetKey: string) {
  const [active, setActive] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setActive(false)
    setSelectedIds(new Set())
  }, [resetKey])

  const selected = useMemo(() => visible.filter((t) => selectedIds.has(t.id)), [visible, selectedIds])
  const allSelected = visible.length > 0 && selected.length === visible.length

  return {
    active,
    selectedIds,
    selected,
    allSelected,
    // segurar uma linha: entra no modo seleção já com ela marcada
    start: (id?: string) => {
      setActive(true)
      setSelectedIds(new Set(id ? [id] : []))
    },
    toggle: (id: string) =>
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    toggleAll: () => setSelectedIds(allSelected ? new Set() : new Set(visible.map((t) => t.id))),
    exit: () => {
      setActive(false)
      setSelectedIds(new Set())
    },
  }
}

export type TransactionSelection = ReturnType<typeof useTransactionSelection>
