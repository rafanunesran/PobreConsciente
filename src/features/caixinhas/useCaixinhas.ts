import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { caixinhasCollection } from './api'
import type { Caixinha } from './types'

interface UseCaixinhasResult {
  caixinhas: Caixinha[]
  loading: boolean
  error: boolean
}

export function useCaixinhas(uid: string, accountId: string): UseCaixinhasResult {
  const [caixinhas, setCaixinhas] = useState<Caixinha[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    // NOTE: sem orderBy aqui de propósito — where(campo A) + orderBy(campo
    // B diferente) exige um índice composto manual no Firestore. Ordena no
    // cliente em vez disso, evitando esse passo extra de configuração.
    const q = query(caixinhasCollection(uid), where('accountId', '==', accountId))
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => doc.data())
        docs.sort((a, b) => a.name.localeCompare(b.name))
        setCaixinhas(docs)
        setLoading(false)
      },
      () => {
        setError(true)
        setLoading(false)
      },
    )
    return unsubscribe
  }, [uid, accountId])

  return { caixinhas, loading, error }
}

// Todas as caixinhas do workspace, de todas as contas — usado no patrimônio.
export function useAllCaixinhas(uid: string): UseCaixinhasResult {
  const [caixinhas, setCaixinhas] = useState<Caixinha[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    return onSnapshot(
      caixinhasCollection(uid),
      (snapshot) => {
        setCaixinhas(snapshot.docs.map((doc) => doc.data()))
        setLoading(false)
      },
      () => {
        setError(true)
        setLoading(false)
      },
    )
  }, [uid])

  return { caixinhas, loading, error }
}
