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
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/cartoes', label: 'Cartões', icon: CreditCard, end: false },
  { to: '/contas', label: 'Contas', icon: Wallet, end: false },
  { to: '/registros/novo', label: 'Extrato', icon: Receipt, end: false },
  { to: '/perfil', label: 'Perfil', icon: User, end: false },
]

// Telas secundárias — não cabem na bottom nav (5 itens já é o teto no
// mobile), então aparecem só na Sidebar (desktop) e no Perfil (mobile).
export const moreNavItems: NavItem[] = [
  { to: '/orcamentos', label: 'Orçamentos', icon: PiggyBank, end: false },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3, end: false },
]
