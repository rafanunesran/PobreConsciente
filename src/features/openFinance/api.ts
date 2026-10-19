import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import type { PluggyAccountLink, PluggyConfig } from './types'

// Uma conexão por pessoa da família (`pluggy_{uid}`): no modo família cada
// um tem o seu Meu Pluggy e a sua aplicação no Dashboard, e o Item ID de
// uma aplicação não pode ser lido com as credenciais de outra.
const ID_PREFIX = 'pluggy_'

function integrationsCollection(uid: string) {
  return collection(db, 'users', uid, 'integrations')
}

function configRef(uid: string, ownerUid: string) {
  return doc(db, 'users', uid, 'integrations', `${ID_PREFIX}${ownerUid}`)
}

function parseLink(value: unknown): PluggyAccountLink | undefined {
  if (!value || typeof value !== 'object') return undefined
  if ('accountId' in value && typeof value.accountId === 'string') return { accountId: value.accountId }
  if ('cardId' in value && typeof value.cardId === 'string') return { cardId: value.cardId }
  return undefined
}

// Mesmo narrowing campo a campo dos converters das outras features — um
// doc malformado vira "sem configuração" em vez de estourar em runtime.
function parseConfig(docId: string, data: Record<string, unknown>): PluggyConfig | null {
  if (!docId.startsWith(ID_PREFIX)) return null
  if (typeof data.clientId !== 'string' || typeof data.clientSecret !== 'string') return null

  const links: Record<string, PluggyAccountLink> = {}
  if (data.links && typeof data.links === 'object') {
    for (const [pluggyAccountId, value] of Object.entries(data.links as Record<string, unknown>)) {
      const link = parseLink(value)
      if (link) links[pluggyAccountId] = link
    }
  }

  return {
    ownerUid: docId.slice(ID_PREFIX.length),
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

export async function getPluggyConfig(uid: string, ownerUid: string): Promise<PluggyConfig | null> {
  const snapshot = await getDoc(configRef(uid, ownerUid))
  return snapshot.exists() ? parseConfig(snapshot.id, snapshot.data()) : null
}

// Todas as conexões do workspace (uma por membro que configurou).
export async function listPluggyConfigs(uid: string): Promise<PluggyConfig[]> {
  const snapshot = await getDocs(integrationsCollection(uid))
  return snapshot.docs
    .map((d) => parseConfig(d.id, d.data()))
    .filter((config): config is PluggyConfig => config !== null)
}

export async function savePluggyConfig(
  uid: string,
  ownerUid: string,
  config: Pick<PluggyConfig, 'clientId' | 'clientSecret' | 'itemIds' | 'links' | 'syncFrom'>,
): Promise<void> {
  // mergeFields: substitui só estes campos por inteiro (inclusive o mapa
  // `links`, pra desvincular uma conta de fato remover a chave). Apaga
  // lastSyncAt: depois de salvar (vínculo novo, data inicial mudada) a
  // próxima sincronização relê tudo desde syncFrom — o que já foi
  // importado é descartado pelo id/dedupe, então reler é seguro.
  await setDoc(
    configRef(uid, ownerUid),
    { ...config, lastSyncAt: deleteField() },
    { mergeFields: ['clientId', 'clientSecret', 'itemIds', 'links', 'syncFrom', 'lastSyncAt'] },
  )
}

// Quem sincroniza nem sempre é o dono da conexão (qualquer membro que abre
// o app sincroniza a família inteira) — por isso só esses dois campos, os
// únicos que as regras deixam outro membro alterar.
export async function recordPluggySync(
  uid: string,
  ownerUid: string,
  result: { at: string; error?: string },
): Promise<void> {
  await updateDoc(configRef(uid, ownerUid), {
    ...(result.error === undefined ? { lastSyncAt: result.at } : {}),
    lastSyncError: result.error ?? deleteField(),
  })
}

export async function deletePluggyConfig(uid: string, ownerUid: string): Promise<void> {
  await deleteDoc(configRef(uid, ownerUid))
}
