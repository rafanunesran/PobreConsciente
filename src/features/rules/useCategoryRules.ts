import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'
import { categoryRulesCollection } from './api'
import type { CategoryRule } from './types'

export function useCategoryRules(uid: string): { rules: CategoryRule[]; loading: boolean; error: boolean } {
  const [rules, setRules] = useState<CategoryRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    return onSnapshot(
      categoryRulesCollection(uid),
      (snapshot) => {
        setRules(snapshot.docs.map((d) => d.data()).sort((a, b) => a.pattern.localeCompare(b.pattern)))
        setLoading(false)
      },
      () => {
        setError(true)
        setLoading(false)
      },
    )
  }, [uid])

  return { rules, loading, error }
}
