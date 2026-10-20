import { useEffect, useState } from 'react'
import { getUserProfile } from './userProfiles'
import type { UserProfile } from './types'

// Cache module-level: perfis raramente mudam e são compartilhados por
// vários cards na mesma tela (mesmo autor em várias transações), então
// evita refetch por componente.
const cache = new Map<string, UserProfile>()

// Depois de editar o próprio perfil (nome completo), pra tela mostrar o
// valor novo sem esperar recarregar.
export function primeUserProfile(profile: UserProfile): void {
  cache.set(profile.uid, profile)
}

export function useUserProfiles(uids: string[]): Map<string, UserProfile> {
  const [, forceRender] = useState(0)
  const key = Array.from(new Set(uids.filter(Boolean))).sort().join(',')

  useEffect(() => {
    const missing = key.split(',').filter((uid) => uid && !cache.has(uid))
    if (missing.length === 0) return
    let cancelled = false
    void Promise.all(
      missing.map(async (uid) => {
        const profile = await getUserProfile(uid)
        if (profile) cache.set(uid, profile)
      }),
    ).then(() => {
      if (!cancelled) forceRender((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return cache
}
