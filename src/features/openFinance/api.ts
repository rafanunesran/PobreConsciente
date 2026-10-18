import { deleteDoc, doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import type { PluggyAccountLink, PluggyConfig } from './types'

function configRef(uid: string) {
  return doc(db, 'users', uid, 'integrations', 'pluggy')
}

function parseLink(value: unknown): PluggyAccountLink | undefined {
  if (!value || typeof value !== 'object') return undefined
  if ('accountId' in value && typeof value.accountId === 'string') return { accountId: value.accountId }
  if ('cardId' in value && typeof value.cardId === 'string') return { cardId: value.cardId }
  return undefined
}

// Mesmo narrowing campo a campo dos converters das outras features — um
// doc malformado vira "sem configuração" em vez de estourar em runtime.
export async function getPluggyConfig(uid: string): Promise<PluggyConfig | null> {
  const snapshot = await getDoc(configRef(uid))
  if (!snapshot.exists()) return null
  const data = snapshot.data()
  if (typeof data.clientId !== 'string' || typeof data.clientSecret !== 'string') return null

  const links: Record<string, PluggyAccountLink> = {}
  if (data.links && typeof data.links === 'object') {
    for (const [pluggyAccountId, value] of Object.entries(data.links as Record<string, unknown>)) {
      const link = parseLink(value)
      if (link) links[pluggyAccountId] = link
    }
  }

  return {
    clientId: data.clientId,
    clientSecret: data.clientSecret,
    itemIds: Array.isArray(data.itemIds)
      ? data.itemIds.filter((id): id is string => typeof id === 'string' && id !== '')
      : [],
    links,
    syncFrom: typeof data.syncFrom === 'string' ? data.syncFrom : '',
    ...(typeof data.lastSyncAt === 'string' ? { lastSyncAt: data.lastSyncAt } : {}),
    ...(typeof data.lastSyncError === 'string' ? { lastSyncError: data.lastSyncError } : {}),
  }
}

export async function savePluggyConfig(
  uid: string,
  config: Pick<PluggyConfig, 'clientId' | 'clientSecret' | 'itemIds' | 'links' | 'syncFrom'>,
): Promise<void> {
  // mergeFields: substitui só estes campos por inteiro (inclusive o mapa
  // `links`, pra desvincular uma conta de fato remover a chave) e preserva
  // lastSyncAt — trocar um vínculo não deve reimportar tudo desde syncFrom.
  await setDoc(configRef(uid), config, {
    mergeFields: ['clientId', 'clientSecret', 'itemIds', 'links', 'syncFrom'],
  })
}

export async function recordPluggySync(uid: string, result: { at: string; error?: string }): Promise<void> {
  await updateDoc(configRef(uid), {
    ...(result.error === undefined ? { lastSyncAt: result.at } : {}),
    lastSyncError: result.error ?? deleteField(),
  })
}

export async function deletePluggyConfig(uid: string): Promise<void> {
  await deleteDoc(configRef(uid))
}
