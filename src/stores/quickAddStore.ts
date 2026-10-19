import { create } from 'zustand'

interface QuickAddState {
  open: boolean
  setOpen: (open: boolean) => void
}

// Menu "O que você quer lançar?" — aberto pelo + central da BottomNav
// (mobile) ou pelo botão flutuante (desktop); o menu em si mora no FAB.
export const useQuickAddStore = create<QuickAddState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
