import {
  Briefcase,
  Car,
  GraduationCap,
  Gamepad2,
  Heart,
  Home,
  MoreHorizontal,
  Receipt,
  ShoppingBag,
  TrendingUp,
  Utensils,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export const CATEGORY_TYPES = ['expense', 'income'] as const
export type CategoryType = (typeof CATEGORY_TYPES)[number]

export const CATEGORY_TYPE_LABELS: Record<CategoryType, string> = {
  expense: 'Despesa',
  income: 'Receita',
}

export const CATEGORY_ICONS = [
  'utensils',
  'car',
  'home',
  'heart',
  'gamepad',
  'shopping-bag',
  'graduation-cap',
  'receipt',
  'briefcase',
  'trending-up',
  'wallet',
  'more',
] as const
export type CategoryIcon = (typeof CATEGORY_ICONS)[number]

export const CATEGORY_ICON_COMPONENTS: Record<CategoryIcon, LucideIcon> = {
  utensils: Utensils,
  car: Car,
  home: Home,
  heart: Heart,
  gamepad: Gamepad2,
  'shopping-bag': ShoppingBag,
  'graduation-cap': GraduationCap,
  receipt: Receipt,
  briefcase: Briefcase,
  'trending-up': TrendingUp,
  wallet: Wallet,
  more: MoreHorizontal,
}

export const CATEGORY_COLORS = [
  '#10B981',
  '#EF4444',
  '#F59E0B',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#F97316',
] as const
export type CategoryColor = (typeof CATEGORY_COLORS)[number]

export interface Category {
  id: string
  name: string
  type: CategoryType
  icon: CategoryIcon
  color: CategoryColor
  // presente sse é subcategoria — só um nível (subcategoria não tem filhas).
  // Se a mãe for excluída, a filha passa a ser tratada como categoria
  // principal (ver categoryTree.ts), sem precisar regravar nada.
  parentId?: string
  createdBy: string // uid de quem criou — nunca alterado em updates
}

interface SuggestedCategory {
  name: string
  type: CategoryType
  icon: CategoryIcon
  color: CategoryColor
}

// NOTE: só um atalho pra popular o formulário com 1 toque — não é um enum
// paralelo, uma vez criada a categoria é um documento igual a qualquer outro.
export const SUGGESTED_CATEGORIES: SuggestedCategory[] = [
  { name: 'Alimentação', type: 'expense', icon: 'utensils', color: '#F59E0B' },
  { name: 'Transporte', type: 'expense', icon: 'car', color: '#3B82F6' },
  { name: 'Moradia', type: 'expense', icon: 'home', color: '#8B5CF6' },
  { name: 'Saúde', type: 'expense', icon: 'heart', color: '#EF4444' },
  { name: 'Lazer', type: 'expense', icon: 'gamepad', color: '#EC4899' },
  { name: 'Compras', type: 'expense', icon: 'shopping-bag', color: '#F97316' },
  { name: 'Educação', type: 'expense', icon: 'graduation-cap', color: '#14B8A6' },
  { name: 'Outros', type: 'expense', icon: 'more', color: '#3B82F6' },
  { name: 'Salário', type: 'income', icon: 'briefcase', color: '#10B981' },
  { name: 'Freelance', type: 'income', icon: 'trending-up', color: '#3B82F6' },
  { name: 'Investimentos', type: 'income', icon: 'wallet', color: '#8B5CF6' },
  { name: 'Outros', type: 'income', icon: 'more', color: '#F59E0B' },
]
