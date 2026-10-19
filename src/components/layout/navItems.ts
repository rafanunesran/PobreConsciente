import { BarChart3, CreditCard, Home, PiggyBank, Receipt, User, Wallet, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
}

// NOTE: compartilhado por BottomNav (mobile) e Sidebar (desktop) pra não
// duplicar a lista de rotas em dois lugares que podem desalinhar.
export const navItems: NavItem[] = [
  { to: '/', label: 'Início', icon: Home, end: true },
  { to: '/registros', label: 'Extrato', icon: Receipt, end: false },
  { to: '/contas', label: 'Contas', icon: Wallet, end: false },
  { to: '/cartoes', label: 'Cartões', icon: CreditCard, end: false },
]

// Perfil fica fora da bottom nav (o meio dela é o botão de lançar) — no
// mobile ele abre pelo avatar do cabeçalho. As demais telas secundárias
// aparecem na Sidebar (desktop) e no Perfil (mobile).
export const profileNavItem: NavItem = { to: '/perfil', label: 'Perfil', icon: User, end: false }

export const moreNavItems: NavItem[] = [
  { to: '/orcamentos', label: 'Orçamentos', icon: PiggyBank, end: false },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3, end: false },
]
