import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { transactionsCollection } from '../transactions/api'
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
    ...(data.linkSince && typeof data.linkSince === 'object'
      ? {
          linkSince: Object.fromEntries(
            Object.entries(data.linkSince as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          ),
        }
      : {}),
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

// Lançamentos em aberto do cartão que NÃO vieram da sincronização (import
// de arquivo, ajuste de fatura, lançamento à mão) a partir de `from` — o
// que "usar o banco como fonte" troca pelos lançamentos do banco.
export async function nonBankOpenCardTransactions(uid: string, cardId: string, from: string) {
  const snapshot = await getDocs(transactionsCollection(uid))
  return snapshot.docs
    .map((d) => d.data())
    .filter((t) => t.cardId === cardId && !t.paid && t.date >= from && !t.id.startsWith('pluggy_'))
}

const BATCH_LIMIT = 500

// O banco vira a fonte do cartão a partir de `from`: apaga os lançamentos
// em aberto que não vieram dele (cartão em aberto nunca mexe em saldo de
// conta, então é só apagar) e faz essa conta da Pluggy reimportar desde
// `from` na próxima sincronização. Fatura já paga fica como está.
export async function switchCardToBankSource(
  uid: string,
  ownerUid: string,
  pluggyAccountId: string,
  cardId: string,
  from: string,
): Promise<number> {
  const toDelete = await nonBankOpenCardTransactions(uid, cardId, from)
  for (let i = 0; i < toDelete.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const t of toDelete.slice(i, i + BATCH_LIMIT)) batch.delete(doc(transactionsCollection(uid), t.id))
    await batch.commit()
  }
  // FieldPath: o id da conta tem '-', que não é seguro num caminho com ponto.
  await updateDoc(
    configRef(uid, ownerUid),
    new FieldPath('linkSince', pluggyAccountId),
    from,
    'lastSyncAt',
    deleteField(),
  )
  return toDelete.length
}
