import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { moreNavItems, navItems, profileNavItem } from './navItems'

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r border-border-light bg-surface-light p-6 dark:border-border-dark dark:bg-surface-dark lg:flex">
      <p className="font-[family-name:var(--font-display)] text-xl font-bold text-brand-500">Pobre Consciente</p>

      <nav className="mt-8 flex flex-col gap-1">
        {[...navItems, ...moreNavItems, profileNavItem].map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-light-secondary transition-colors duration-200 dark:text-dark-secondary',
                isActive
                  ? 'bg-brand-500/10 text-brand-500 dark:text-brand-400'
                  : 'hover:text-light-primary dark:hover:text-dark-primary',
              )
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
