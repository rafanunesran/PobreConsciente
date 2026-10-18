import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { BottomNav } from './BottomNav'
import { Sidebar } from './Sidebar'
import { FAB } from './FAB'
import { Splash } from './Splash'
import { Toast } from '../ui/Toast'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore, syncWorkspace } from '../../stores/workspaceStore'
import { upsertMyProfile } from '../../features/family/userProfiles'
import { topUpRecurringRules } from '../../features/transactions/recurring'
import { notifyUpcomingBills } from '../../features/reminders/billNotifications'

// NOTE: abaixo de `lg`, comportamento igual ao original (coluna única de
// 480px, bottom nav). Em `lg+`, a Sidebar substitui a bottom nav e a coluna
// de conteúdo cresce (com um teto pra não esticar demais em telas ultra-wide).
export function AppShell() {
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const workspaceLoading = useWorkspaceStore((state) => state.loading)

  // Observa a família (se houver) assim que a pessoa loga — resolve
  // `workspaceId` (meu uid em modo solo, ou o uid do dono da família).
  useEffect(() => {
    if (!user) return
    return syncWorkspace(user.uid)
  }, [user])

  // Mantém o espelho público de nome/foto em dia — necessário pra outros
  // membros da família conseguirem resolver "adicionado por Fulano".
  useEffect(() => {
    if (!user) return
    void upsertMyProfile(user.uid, {
      displayName: user.displayName ?? user.email ?? 'Sem nome',
      email: user.email ?? '',
      ...(user.photoURL ? { photoURL: user.photoURL } : {}),
    })
  }, [user])

  // Garante que nenhuma regra recorrente fique com menos de 6 meses
  // gerados — roda uma vez por sessão, silenciosamente (sem UI de loading;
  // falha aqui não deve travar a navegação). Espera o workspace resolver
  // pra não gerar ocorrências no lugar errado (meu uid) antes de saber se
  // devo operar no namespace de uma família.
  useEffect(() => {
    if (workspaceId && !workspaceLoading) void topUpRecurringRules(workspaceId)
  }, [workspaceId, workspaceLoading])

  // Aviso de contas vencendo (se a pessoa ativou no Perfil) — no máximo
  // uma vez por dia, silencioso se falhar.
  useEffect(() => {
    if (workspaceId && !workspaceLoading) notifyUpcomingBills(workspaceId).catch(() => undefined)
  }, [workspaceId, workspaceLoading])

  // Essencial: as páginas abaixo (Outlet) usam `workspaceId` direto como
  // segmento de caminho no Firestore (`users/{workspaceId}/...`). Se
  // renderizássemos o Outlet antes do workspace resolver, `workspaceId`
  // ainda seria null e cada hook de dado chamaria `collection(db, 'users',
  // '', 'accounts')` — uma referência inválida (segmento vazio), que o SDK
  // rejeita na hora e derruba o app inteiro. Mesmo padrão do ProtectedRoute
  // esperando `initializing` antes de renderizar.
  if (workspaceLoading || !workspaceId) return <Splash />

  return (
    <div className="min-h-svh bg-bg-light dark:bg-bg-dark lg:flex">
      <Sidebar />
      <div className="flex w-full justify-center lg:flex-1">
        <div className="flex w-full max-w-[480px] flex-col lg:max-w-5xl">
          <Header />
          <main className="flex-1 pb-28 lg:pb-8">
            <Outlet />
          </main>
        </div>
      </div>
      <FAB />
      <Toast />
      <BottomNav />
    </div>
  )
}
