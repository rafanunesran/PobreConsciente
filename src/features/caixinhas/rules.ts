import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import type { Transaction, TransactionType } from '../transactions/types'

// "Esta movimentação é a caixinha X": quando o banco manda algo que a
// leitura da descrição (openFinance/reserveParsing.ts) não sabe de qual
// caixinha é — "Aplicação", "Aplicação RDB" com várias caixinhas na
// conta... — a pessoa marca uma vez e fica gravada uma regra. A partir
// daí toda movimentação da mesma conta, com a mesma descrição e o mesmo
// sentido, vai direto pra essa caixinha (ver openFinance/sync.ts).
export interface CaixinhaRule {
  id: string
  accountId: string
  // descrição normalizada (ver descriptionPattern)
  pattern: string
  // despesa = guardar (saiu da conta), receita = resgatar (voltou pra ela)
  type: TransactionType
  caixinhaId: string
  createdBy: string
}

const caixinhaRuleConverter: FirestoreDataConverter<CaixinhaRule> = {
  toFirestore: (rule) => ({
    accountId: rule.accountId,
    pattern: rule.pattern,
    type: rule.type,
    caixinhaId: rule.caixinhaId,
    createdBy: rule.createdBy,
  }),
  fromFirestore: (snapshot: QueryDocumentSnapshot) => {
    const data = snapshot.data()
    return {
      id: snapshot.id,
      accountId: typeof data.accountId === 'string' ? data.accountId : '',
      pattern: typeof data.pattern === 'string' ? data.pattern : '',
      type: data.type === 'income' ? 'income' : 'expense',
      caixinhaId: typeof data.caixinhaId === 'string' ? data.caixinhaId : '',
      createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    }
  },
}

export function caixinhaRulesCollection(uid: string) {
  return collection(db, 'users', uid, 'caixinhaRules').withConverter(caixinhaRuleConverter)
}

// Sem acento, maiúscula, número nem pontuação: "Aplicação RDB 12/10" e
// "APLICACAO RDB" são a mesma movimentação — data, valor e código de
// operação que o banco põe no meio mudam a cada vez.
export function descriptionPattern(description: string): string {
  return description
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim()
}

export function findCaixinhaRule(
  rules: CaixinhaRule[],
  accountId: string,
  transaction: Pick<Transaction, 'description' | 'type'>,
): CaixinhaRule | undefined {
  const pattern = descriptionPattern(transaction.description)
  if (!pattern) return undefined
  return rules.find((r) => r.accountId === accountId && r.type === transaction.type && r.pattern === pattern)
}

// Id derivado de conta + sentido + descrição: marcar de novo a mesma
// movimentação (ou uma igual) troca a caixinha em vez de duplicar a regra.
function ruleIdFor(accountId: string, type: TransactionType, pattern: string): string {
  return `${accountId}_${type}_${pattern}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 300)
}

export async function listCaixinhaRules(uid: string): Promise<CaixinhaRule[]> {
  const snapshot = await getDocs(caixinhaRulesCollection(uid))
  return snapshot.docs.map((d) => d.data())
}

export async function saveCaixinhaRule(
  uid: string,
  accountId: string,
  transaction: Pick<Transaction, 'description' | 'type'>,
  caixinhaId: string,
  createdBy: string,
): Promise<CaixinhaRule> {
  const pattern = descriptionPattern(transaction.description)
  const rule: CaixinhaRule = {
    id: ruleIdFor(accountId, transaction.type, pattern),
    accountId,
    pattern,
    type: transaction.type,
    caixinhaId,
    createdBy,
  }
  await setDoc(doc(caixinhaRulesCollection(uid), rule.id), rule)
  return rule
}

// Caixinha encerrada: as regras dela deixam de valer.
export async function deleteCaixinhaRulesOf(uid: string, caixinhaId: string): Promise<void> {
  const snapshot = await getDocs(query(caixinhaRulesCollection(uid), where('caixinhaId', '==', caixinhaId)))
  await Promise.all(snapshot.docs.map((d) => deleteDoc(d.ref)))
}
