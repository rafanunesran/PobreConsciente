import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Copy, LogOut, Users } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Card } from '../../components/ui/Card'
import { createFamily, joinFamily, leaveFamily } from './api'
import { primeUserProfile, useUserProfiles } from './useUserProfiles'
import { getUserProfile, setMyFullName } from './userProfiles'

const ABOUT_TEXT =
  'No modo família, duas ou mais pessoas administram juntas as mesmas contas, cartões e categorias. Se você entrar numa família, seus próprios dados não somem — eles só ficam fora de vista enquanto você estiver na família, e voltam a aparecer se você sair.'

function MemberList({ memberIds, ownerId }: { memberIds: string[]; ownerId: string }) {
  const profiles = useUserProfiles(memberIds)
  return (
    <div className="flex flex-col gap-2">
      {memberIds.map((uid) => {
        const profile = profiles.get(uid)
        return (
          <Card key={uid} className="flex items-center gap-3 p-3">
            <Avatar src={profile?.photoURL} name={profile?.displayName} className="h-9 w-9 text-sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-light-primary dark:text-dark-primary">
                {profile?.displayName ?? 'Carregando...'}
              </p>
              {profile?.fullName ? (
                <p className="truncate text-xs text-light-secondary dark:text-dark-secondary">{profile.fullName}</p>
              ) : null}
              {uid === ownerId ? (
                <p className="text-xs text-light-secondary dark:text-dark-secondary">Dono</p>
              ) : null}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// Nome completo como aparece no banco — com ele, Pix/TED entre membros da
// família vira transferência (não gasto) na conexão bancária.
function FullNameField({ uid }: { uid: string }) {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getUserProfile(uid)
      .then((profile) => {
        if (cancelled) return
        setValue(profile?.fullName ?? '')
        setSaved(profile?.fullName ?? '')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [uid])

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      await setMyFullName(uid, value)
      const profile = await getUserProfile(uid)
      if (profile) primeUserProfile(profile)
      setSaved(profile?.fullName ?? '')
      setMessage('Salvo.')
    } catch {
      setMessage('Não foi possível salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        label="Seu nome completo (como aparece no banco)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ex.: Rafael Nunes Figueiredo"
        autoComplete="name"
      />
      <p className="text-xs text-light-secondary dark:text-dark-secondary">
        Usado pela conexão bancária pra reconhecer Pix e transferências entre você e a sua família — eles não
        contam como gasto nem receita do mês. Visível pra outras pessoas do app, como o seu nome.
      </p>
      {message ? <p className="text-xs text-light-secondary dark:text-dark-secondary">{message}</p> : null}
      <Button
        type="button"
        variant="secondary"
        onClick={handleSave}
        disabled={saving || value.trim() === saved.trim()}
      >
        {saving ? 'Salvando...' : 'Salvar nome completo'}
      </Button>
    </div>
  )
}

export function FamilyPage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const family = useWorkspaceStore((state) => state.family)
  const workspaceLoading = useWorkspaceStore((state) => state.loading)

  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)

  if (!user) return null

  async function handleCreateFamily() {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      await createFamily(user.uid)
    } catch {
      setError('Não foi possível criar a família. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  async function handleJoinFamily() {
    if (!user || !joinCode.trim()) return
    setBusy(true)
    setError(null)
    try {
      await joinFamily(joinCode.trim(), user.uid)
    } catch {
      setError('Código inválido. Confira e tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  async function handleLeaveFamily() {
    if (!user || !family) return
    setBusy(true)
    setError(null)
    try {
      await leaveFamily(family.ownerId, user.uid)
    } catch {
      setError('Não foi possível sair da família. Tente novamente.')
      setBusy(false)
    }
  }

  async function handleCopyCode() {
    if (!family) return
    await navigator.clipboard.writeText(family.ownerId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isOwner = family?.ownerId === user.uid

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Voltar"
          onClick={() => navigate('/perfil')}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">Família</h1>
      </div>

      <FullNameField uid={user.uid} />

      {workspaceLoading ? (
        <div className="h-40 animate-pulse rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark-elevated" />
      ) : !family ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-light py-10 text-center dark:border-border-dark">
            <Users size={32} className="text-light-secondary dark:text-dark-secondary" />
            <p className="max-w-xs text-sm text-light-secondary dark:text-dark-secondary">
              {ABOUT_TEXT}
            </p>
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <Button type="button" onClick={handleCreateFamily} disabled={busy}>
            {busy ? 'Criando...' : 'Criar família'}
          </Button>

          <div className="flex flex-col gap-3 border-t border-border-light pt-4 dark:border-border-dark">
            <Input
              label="Entrar com um código"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Cole o código de convite"
              autoComplete="off"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleJoinFamily}
              disabled={busy || !joinCode.trim()}
            >
              {busy ? 'Entrando...' : 'Entrar na família'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {error ? <p className="text-sm text-danger">{error}</p> : null}

          {isOwner ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-light-secondary dark:text-dark-secondary">
                Compartilhe este código para convidar alguém para a sua família:
              </p>
              <Card className="flex items-center justify-between gap-3 p-3">
                <span className="truncate text-sm font-medium text-light-primary dark:text-dark-primary">
                  {family.ownerId}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0 gap-1.5 px-2.5 py-1.5 text-xs"
                  onClick={handleCopyCode}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copiado' : 'Copiar'}
                </Button>
              </Card>
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-light-primary dark:text-dark-primary">
              Membros ({family.memberIds.length})
            </h2>
            <MemberList memberIds={family.memberIds} ownerId={family.ownerId} />
          </div>

          <p className="text-xs text-light-secondary dark:text-dark-secondary">{ABOUT_TEXT}</p>

          {!isOwner ? (
            <div className="border-t border-border-light pt-4 dark:border-border-dark">
              {confirmingLeave ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-danger">
                    Você vai deixar de ver e editar os dados compartilhados desta família. Seus
                    próprios dados de antes voltam a aparecer.
                  </p>
                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setConfirmingLeave(false)}
                      disabled={busy}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      className="flex-1 bg-danger hover:bg-danger hover:shadow-none"
                      onClick={handleLeaveFamily}
                      disabled={busy}
                    >
                      {busy ? 'Saindo...' : 'Confirmar saída'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmingLeave(true)}>
                  <LogOut size={20} />
                  Sair da família
                </Button>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
