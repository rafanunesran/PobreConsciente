import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'
import { budgetsCollection } from './api'
import type { Budget } from './types'

interface UseBudgetsResult {
  budgets: Budget[]
  loading: boolean
  error: boolean
}

export function useBudgets(uid: string): UseBudgetsResult {
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    const unsubscribe = onSnapshot(
      budgetsCollection(uid),
      (snapshot) => {
        setBudgets(snapshot.docs.map((doc) => doc.data()))
        setLoading(false)
      },
      () => {
        setError(true)
        setLoading(false)
      },
    )
    return unsubscribe
  }, [uid])

  return { budgets, loading, error }
}
