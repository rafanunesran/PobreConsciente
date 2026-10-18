import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  setDoc,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import type { CategoryRule } from './types'
import type { CategoryRuleFormData } from './schemas'

const ruleConverter: FirestoreDataConverter<CategoryRule> = {
  toFirestore: (rule) => ({
    pattern: rule.pattern,
    type: rule.type,
    categoryId: rule.categoryId,
    createdBy: rule.createdBy,
    ...(Array.isArray(rule.tags) && rule.tags.length > 0 ? { tags: rule.tags } : {}),
  }),
  fromFirestore: (snapshot: QueryDocumentSnapshot) => {
    const data = snapshot.data()
    const tags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : []
    return {
      id: snapshot.id,
      pattern: typeof data.pattern === 'string' ? data.pattern : '',
      type: data.type === 'income' ? 'income' : 'expense',
      categoryId: typeof data.categoryId === 'string' ? data.categoryId : '',
      createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
      ...(tags.length > 0 ? { tags } : {}),
    }
  },
}

export function categoryRulesCollection(uid: string) {
  return collection(db, 'users', uid, 'categoryRules').withConverter(ruleConverter)
}

export async function createCategoryRule(uid: string, data: CategoryRuleFormData, createdBy: string): Promise<string> {
  const ref = await addDoc(categoryRulesCollection(uid), { id: '', createdBy, ...data })
  return ref.id
}

// setDoc do doc inteiro: tirar todas as tags precisa remover o campo, e o
// converter só grava `tags` quando há alguma.
export async function updateCategoryRule(
  uid: string,
  rule: CategoryRule,
  data: CategoryRuleFormData,
): Promise<void> {
  await setDoc(doc(categoryRulesCollection(uid), rule.id), { ...rule, ...data })
}

export async function deleteCategoryRule(uid: string, ruleId: string): Promise<void> {
  await deleteDoc(doc(categoryRulesCollection(uid), ruleId))
}
