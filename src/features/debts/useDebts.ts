import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'
import { debtsCollection } from './api'
import type { Debt } from './types'

export function useDebts(uid: string): { debts: Debt[]; loading: boolean; error: boolean } {
  const [debts, setDebts] = useState<Debt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    return onSnapshot(
      debtsCollection(uid),
      (snapshot) => {
        setDebts(snapshot.docs.map((d) => d.data()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
        setLoading(false)
      },
      () => {
        setError(true)
        setLoading(false)
      },
    )
  }, [uid])

  return { debts, loading, error }
}
