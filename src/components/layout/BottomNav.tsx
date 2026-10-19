import { NavLink } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { cn } from '../../lib/utils'
import { navItems, type NavItem } from './navItems'
import { useQuickAddStore } from '../../stores/quickAddStore'

function Tab({ to, label, icon: Icon, end }: NavItem) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center gap-1 py-1 text-[11px] font-medium text-light-secondary transition-colors duration-200 dark:text-dark-secondary',
          isActive && 'text-brand-500 dark:text-brand-400',
        )
      }
    >
      <Icon size={22} />
      {label}
    </NavLink>
  )
}

// 4 abas + o botão de lançar no meio, sempre à mão (no lugar do antigo
// botão flutuante, que cobria conteúdo e ficava longe do polegar).
export function BottomNav() {
  const setOpen = useQuickAddStore((state) => state.setOpen)
  const half = Math.ceil(navItems.length / 2)

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[480px] border-t border-border-light bg-surface-light/95 backdrop-blur-xl dark:border-border-dark dark:bg-surface-dark/95 lg:hidden">
      <ul className="grid grid-cols-5 items-end px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2">
        {navItems.slice(0, half).map((item) => (
          <li key={item.to}>
            <Tab {...item} />
          </li>
        ))}
        <li className="flex justify-center">
          <button
            type="button"
            aria-label="Novo lançamento"
            onClick={() => setOpen(true)}
            className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg shadow-brand-500/30 ring-4 ring-bg-light transition-transform active:scale-95 dark:ring-bg-dark"
          >
            <Plus size={28} strokeWidth={2.5} />
          </button>
        </li>
        {navItems.slice(half).map((item) => (
          <li key={item.to}>
            <Tab {...item} />
          </li>
        ))}
      </ul>
    </nav>
  )
}
