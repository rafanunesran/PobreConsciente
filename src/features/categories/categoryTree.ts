import type { Category, CategoryType } from './types'

// Mãe "efetiva" de uma categoria: só vale se a mãe ainda existe e é do
// mesmo tipo — filha de uma mãe excluída vira principal na prática.
export function effectiveParentId(category: Category, categoriesById: Map<string, Category>): string | undefined {
  if (category.parentId === undefined) return undefined
  const parent = categoriesById.get(category.parentId)
  return parent && parent.type === category.type && parent.parentId === undefined ? parent.id : undefined
}

// Categoria principal à qual um lançamento soma nos totais agregados
// (gráfico por categoria, relatórios): a própria, ou a mãe se for filha.
export function rootCategoryId(categoryId: string, categoriesById: Map<string, Category>): string {
  const category = categoriesById.get(categoryId)
  if (!category) return categoryId
  return effectiveParentId(category, categoriesById) ?? categoryId
}

// A própria categoria + suas filhas — o que um filtro ou orçamento numa
// categoria principal precisa cobrir.
export function categoryWithChildren(categoryId: string, categories: Category[]): Set<string> {
  const categoriesById = new Map(categories.map((c) => [c.id, c]))
  const ids = new Set([categoryId])
  for (const c of categories) {
    if (effectiveParentId(c, categoriesById) === categoryId) ids.add(c.id)
  }
  return ids
}

export interface CategoryOption {
  category: Category
  label: string
  isChild: boolean
}

// Lista ordenada pra <select>: cada principal seguida das suas filhas
// (indentadas no rótulo, já que <option> não aceita estilo de verdade).
export function categoryOptions(categories: Category[], type?: CategoryType): CategoryOption[] {
  const relevant = type ? categories.filter((c) => c.type === type) : categories
  const categoriesById = new Map(categories.map((c) => [c.id, c]))
  const roots = relevant.filter((c) => effectiveParentId(c, categoriesById) === undefined)
  const options: CategoryOption[] = []
  for (const root of roots) {
    options.push({ category: root, label: root.name, isChild: false })
    for (const child of relevant) {
      if (effectiveParentId(child, categoriesById) === root.id) {
        options.push({ category: child, label: `  ↳ ${child.name}`, isChild: true })
      }
    }
  }
  return options
}
