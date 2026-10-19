import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { Avatar } from '../ui/Avatar'

export function Header() {
  const user = useAuthStore((state) => state.user)
  const firstName = user?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'por aí'

  // O avatar é a porta pro Perfil no mobile (Perfil saiu da bottom nav).
  return (
    <header className="flex items-center justify-between px-6 pb-2 pt-6">
      <Link to="/perfil" className="group flex items-center gap-3" aria-label="Abrir perfil">
        <Avatar src={user?.photoURL} name={user?.displayName ?? user?.email} />
        <div>
          <p className="text-sm text-light-secondary dark:text-dark-secondary">Olá, {firstName} 👋</p>
          <p className="font-[family-name:var(--font-display)] text-lg font-bold leading-tight text-light-primary dark:text-dark-primary">
            Pobre Consciente
          </p>
        </div>
      </Link>
      <Link
        to="/perfil"
        aria-label="Perfil"
        className="flex h-10 w-10 items-center justify-center rounded-full text-light-secondary transition-colors duration-200 hover:text-light-primary dark:text-dark-secondary dark:hover:text-dark-primary lg:hidden"
      >
        <ChevronRight size={20} />
      </Link>
    </header>
  )
}
