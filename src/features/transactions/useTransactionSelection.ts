import { useEffect, useMemo, useRef, useState } from 'react'
import type { Transaction } from './types'

// Marca da entrada de histórico criada ao entrar no modo seleção: o botão/
// gesto de voltar (Android, navegador) desfaz essa entrada e sai da seleção,
// em vez de sair da tela.
const HISTORY_MARK = 'pcSelection'
let nextToken = 1

function currentMark(): unknown {
  const state: unknown = window.history.state
  return state && typeof state === 'object' ? (state as Record<string, unknown>)[HISTORY_MARK] : undefined
}

// Seleção múltipla do extrato (segurar uma linha ou "Selecionar"). Só vale
// o que está na tela: trocar de mês/filtro limpa, e um id que saiu da lista
// nunca recebe ação em massa.
export function useTransactionSelection(visible: Transaction[], resetKey: string) {
  const [active, setActive] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const token = useRef<number | null>(null)

  function clear() {
    setActive(false)
    setSelectedIds(new Set())
  }

  // Sair pelos botões da tela: tira também a entrada do histórico, senão o
  // próximo voltar não faria nada visível.
  function exit() {
    const mine = token.current
    token.current = null
    clear()
    if (mine !== null && currentMark() === mine) window.history.back()
  }

  useEffect(() => {
    exit()
  }, [resetKey])

  useEffect(() => {
    if (!active) return
    const onPopState = () => {
      if (token.current !== null && currentMark() === token.current) return
      token.current = null
      clear()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [active])

  const selected = useMemo(() => visible.filter((t) => selectedIds.has(t.id)), [visible, selectedIds])
  const allSelected = visible.length > 0 && selected.length === visible.length

  return {
    active,
    selectedIds,
    selected,
    allSelected,
    // segurar uma linha: entra no modo seleção já com ela marcada
    start: (id?: string) => {
      if (token.current === null) {
        const mine = nextToken++
        token.current = mine
        const state: unknown = window.history.state
        window.history.pushState({ ...(state && typeof state === 'object' ? state : {}), [HISTORY_MARK]: mine }, '')
      }
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
    exit,
  }
}

export type TransactionSelection = ReturnType<typeof useTransactionSelection>
