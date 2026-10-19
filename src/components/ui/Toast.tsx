import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, X } from 'lucide-react'
import { useToastStore } from '../../stores/toastStore'

const DURATION_MS = 5000

export function Toast() {
  const message = useToastStore((state) => state.message)
  const action = useToastStore((state) => state.action)
  const key = useToastStore((state) => state.key)
  const dismiss = useToastStore((state) => state.dismiss)

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(dismiss, DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [message, key, dismiss])

  if (!message) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-[448px] items-center gap-3 rounded-2xl border border-brand-500/40 bg-surface-light p-3 shadow-lg dark:bg-surface-dark-elevated lg:bottom-8 lg:left-auto lg:right-28 lg:mx-0"
    >
      <CheckCircle2 size={20} className="shrink-0 text-brand-500" />
      <p className="min-w-0 flex-1 text-sm text-light-primary dark:text-dark-primary">{message}</p>
      {action ? (
        <Link
          to={action.to}
          onClick={dismiss}
          className="shrink-0 text-sm font-semibold text-brand-500 hover:text-brand-600"
        >
          {action.label}
        </Link>
      ) : null}
      <button
        type="button"
        aria-label="Fechar aviso"
        onClick={dismiss}
        className="shrink-0 text-light-secondary hover:text-light-primary dark:text-dark-secondary dark:hover:text-dark-primary"
      >
        <X size={16} />
      </button>
    </div>
  )
}
