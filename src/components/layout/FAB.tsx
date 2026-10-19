import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, Calculator, Plus } from 'lucide-react'
import { FloatingCalculator } from './FloatingCalculator'

interface MenuItem {
  label: string
  icon: typeof Plus
  className: string
  action: () => void
}

export function FAB() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [calcOpen, setCalcOpen] = useState(false)

  // Fecha o menu ao trocar de rota / ESC.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const items: MenuItem[] = [
    {
      label: 'Nova despesa',
      icon: ArrowDownCircle,
      className: 'bg-danger/10 text-danger',
      action: () => navigate('/registros/despesa/nova'),
    },
    {
      label: 'Nova receita',
      icon: ArrowUpCircle,
      className: 'bg-brand-500/10 text-brand-500',
      action: () => navigate('/registros/receita/nova'),
    },
    {
      label: 'Transferência entre contas',
      icon: ArrowLeftRight,
      className: 'bg-violet-500/10 text-violet-500',
      action: () => navigate('/contas/transferir'),
    },
    {
      label: 'Calculadora',
      icon: Calculator,
      className: 'bg-amber-500/10 text-amber-500',
      action: () => setCalcOpen(true),
    },
  ]

  function handleSelect(item: MenuItem) {
    setOpen(false)
    item.action()
  }

  return (
    <>
      {/* Backdrop leve só pra fechar o menu ao clicar fora (o menu É modal;
          a calculadora, aberta a partir dele, NÃO é). */}
      {open && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-20 cursor-default bg-black/20"
        />
      )}

      <div className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 lg:bottom-8 lg:left-auto lg:right-8 lg:translate-x-0">
        {open && (
          <div className="absolute bottom-16 right-1/2 flex translate-x-1/2 flex-col items-end gap-2 lg:right-0 lg:translate-x-0">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => handleSelect(item)}
                className="flex items-center gap-3 rounded-full border border-border-light bg-surface-light py-2 pl-4 pr-2 shadow-lg transition-transform duration-150 hover:scale-[1.02] dark:border-border-dark dark:bg-surface-dark-elevated"
              >
                <span className="whitespace-nowrap text-sm font-medium text-light-primary dark:text-dark-primary">
                  {item.label}
                </span>
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full ${item.className}`}
                >
                  <item.icon size={20} />
                </span>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Fechar menu' : 'Adicionar'}
          aria-expanded={open}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-[0_0_20px_var(--color-brand-glow)] transition-all duration-200 hover:bg-brand-600"
        >
          <span className={`transition-transform duration-200 ${open ? 'rotate-45' : ''}`}>
            <Plus size={28} />
          </span>
        </button>
      </div>

      {calcOpen && <FloatingCalculator onClose={() => setCalcOpen(false)} />}
    </>
  )
}
