import { create } from 'zustand'

export interface ToastAction {
  label: string
  to: string
}

interface ToastState {
  message: string | null
  action: ToastAction | null
  // muda a cada show() — reinicia o timer mesmo se a mensagem for igual
  key: number
  show: (message: string, action?: ToastAction) => void
  dismiss: () => void
}

// Aviso curto depois de uma operação (salvar, excluir...). Global porque a
// tela que dispara (form) já foi desmontada quando o aviso precisa aparecer
// (extrato) — o Toast em si é renderizado uma vez só, no AppShell.
export const useToastStore = create<ToastState>()((set) => ({
  message: null,
  action: null,
  key: 0,
  show: (message, action) => set((state) => ({ message, action: action ?? null, key: state.key + 1 })),
  dismiss: () => set({ message: null, action: null }),
}))
