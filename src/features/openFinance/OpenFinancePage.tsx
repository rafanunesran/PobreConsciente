import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, ExternalLink, Landmark, RefreshCw, Users } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from '../accounts/useAccounts'
import { useCards } from '../cards/useCards'
import { createAccount } from '../accounts/api'
import { createCard } from '../cards/api'
import { accountDataFromPluggy, cardDataFromPluggy } from './createFromPluggy'
import { DiagnosticPanel } from './DiagnosticPanel'
import { useUserProfiles } from '../family/useUserProfiles'
import { todayDateString } from '../cards/invoiceUtils'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { cn, formatBRL } from '../../lib/utils'
import { deletePluggyConfig, listPluggyConfigs, savePluggyConfig } from './api'
import { authenticate, getItem, listAccounts } from './pluggyClient'
import { BANK_SYNC_TAG, syncBankTransactions } from './sync'
import type { PluggyAccount, PluggyAccountLink, PluggyConfig } from './types'

interface FoundAccount extends PluggyAccount {
  institution: string
}

// valor do <select> de vínculo: '' (não importar), 'account:<id>', 'card:<id>'
// ou 'new:card' / 'new:account' (criar no app ao salvar — ver handleSave)
function linkToValue(link: PluggyAccountLink | undefined): string {
  if (!link) return ''
  return 'accountId' in link ? `account:${link.accountId}` : `card:${link.cardId}`
}

function valueToLink(value: string): PluggyAccountLink | undefined {
  const [kind, id] = value.split(':')
  if (!id) return undefined
  return kind === 'card' ? { cardId: id } : { accountId: id }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Uma entrada por linha (ou separada por vírgula). Valida o formato aqui
// porque é fácil colar o nome do banco no lugar do código — a Pluggy só
// responderia "Invalid id, not an uuid", sem dizer qual linha.
function parseItemIds(raw: string): { ids: string[]; invalid: string[] } {
  const entries = raw
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
  return {
    ids: Array.from(new Set(entries.filter((entry) => UUID_PATTERN.test(entry)))),
    invalid: entries.filter((entry) => !UUID_PATTERN.test(entry)),
  }
}

function formatSyncDate(iso: string): string {
  return format(new Date(iso), "d 'de' MMM 'às' HH:mm", { locale: ptBR })
}

const EXTERNAL_LINK_CLASS = 'inline-flex items-center gap-0.5 font-medium text-brand-500 underline'

export function OpenFinancePage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const family = useWorkspaceStore((state) => state.family)
  const { accounts } = useAccounts(workspaceId ?? '')
  const { cards } = useCards(workspaceId ?? '')

  // `config` é a minha conexão (editável aqui); `otherConfigs`, as dos
  // outros membros da família — só status, cada um edita a sua.
  const [config, setConfig] = useState<PluggyConfig | null>(null)
  const [otherConfigs, setOtherConfigs] = useState<PluggyConfig[]>([])
  const [loadingConfig, setLoadingConfig] = useState(true)
  const profiles = useUserProfiles(otherConfigs.map((c) => c.ownerUid))

  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [itemIdsRaw, setItemIdsRaw] = useState('')
  const [syncFrom, setSyncFrom] = useState(todayDateString())
  const [links, setLinks] = useState<Record<string, PluggyAccountLink>>({})
  // contas da Pluggy marcadas como "criar novo" — viram cartão/conta no app só ao salvar
  const [toCreate, setToCreate] = useState<Record<string, 'card' | 'account'>>({})

  const [found, setFound] = useState<FoundAccount[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  async function fetchAccounts(id: string, secret: string, itemIds: string[]) {
    setFetching(true)
    setFetchError(null)
    try {
      if (itemIds.length === 0) throw new Error('Cole pelo menos um Item ID.')
      const apiKey = await authenticate(id, secret)
      const all: FoundAccount[] = []
      for (const itemId of itemIds) {
        const item = await getItem(apiKey, itemId)
        const itemAccounts = await listAccounts(apiKey, itemId)
        const institution = item.connector?.name ?? 'Banco'
        all.push(...itemAccounts.map((a) => ({ ...a, institution })))
      }
      if (all.length === 0) {
        throw new Error(
          'Nenhuma conta encontrada. No Meu Pluggy, confira se a conexão com o banco foi autorizada para a sua aplicação.',
        )
      }
      setFound(all)
    } catch (err) {
      setFound(null)
      setFetchError(err instanceof Error ? err.message : 'Não foi possível buscar as contas.')
    } finally {
      setFetching(false)
    }
  }

  async function reloadConfigs(): Promise<PluggyConfig | null> {
    if (!workspaceId || !user) return null
    const all = await listPluggyConfigs(workspaceId)
    const mine = all.find((c) => c.ownerUid === user.uid) ?? null
    setConfig(mine)
    setOtherConfigs(all.filter((c) => c.ownerUid !== user.uid))
    return mine
  }

  useEffect(() => {
    if (!workspaceId || !user) return
    let cancelled = false
    reloadConfigs()
      .then((saved) => {
        if (cancelled) return
        if (saved) {
          setClientId(saved.clientId)
          setClientSecret(saved.clientSecret)
          setItemIdsRaw(saved.itemIds.join('\n'))
          setSyncFrom(saved.syncFrom || todayDateString())
          setLinks(saved.links)
          void fetchAccounts(saved.clientId, saved.clientSecret, saved.itemIds)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingConfig(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, user])

  if (!user || !workspaceId) return null

  const { ids: itemIds, invalid: invalidItemIds } = parseItemIds(itemIdsRaw)
  const canFetch =
    !fetching &&
    clientId.trim() !== '' &&
    clientSecret.trim() !== '' &&
    itemIds.length > 0 &&
    invalidItemIds.length === 0
  // só vínculos de contas que a Pluggy de fato devolveu — um Item ID
  // removido leva junto os vínculos das contas dele.
  const activeLinks = Object.fromEntries(
    Object.entries(links).filter(([pluggyAccountId]) => found?.some((a) => a.id === pluggyAccountId)),
  )
  const activeCreates = Object.entries(toCreate).filter(([pluggyAccountId]) =>
    found?.some((a) => a.id === pluggyAccountId),
  )
  const canSave =
    !saving && found !== null && Object.keys(activeLinks).length + activeCreates.length > 0 && syncFrom !== ''

  function updateLink(pluggyAccountId: string, value: string) {
    const createKind = value === 'new:card' ? 'card' : value === 'new:account' ? 'account' : undefined
    setToCreate((current) => {
      const next = { ...current }
      if (createKind) next[pluggyAccountId] = createKind
      else delete next[pluggyAccountId]
      return next
    })
    setLinks((current) => {
      const next = { ...current }
      const link = createKind ? undefined : valueToLink(value)
      if (link) next[pluggyAccountId] = link
      else delete next[pluggyAccountId]
      return next
    })
  }

  function selectValue(pluggyAccountId: string): string {
    const createKind = toCreate[pluggyAccountId]
    return createKind ? `new:${createKind}` : linkToValue(links[pluggyAccountId])
  }

  async function runSync() {
    if (!user || !workspaceId) return
    setSyncing(true)
    setSyncMessage(null)
    setSyncError(null)
    try {
      const { imported, errors, accountsAligned = 0, caixinhasAligned = 0 } = await syncBankTransactions(
        workspaceId,
        user.uid,
      )
      const aligned = [
        accountsAligned > 0 ? `${accountsAligned} conta(s)` : '',
        caixinhasAligned > 0 ? `${caixinhasAligned} caixinha(s)` : '',
      ].filter(Boolean)
      setSyncMessage(
        (imported === 0
          ? 'Tudo em dia — nenhum lançamento novo.'
          : `${imported} lançamento(s) importado(s) com a tag "${BANK_SYNC_TAG}".`) +
          (aligned.length > 0 ? ` Saldo igual ao do banco: ${aligned.join(' e ')}.` : ''),
      )
      if (errors.length > 0) setSyncError(errors.join(' '))
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Falha na sincronização.')
    } finally {
      setSyncing(false)
      await reloadConfigs().catch(() => undefined)
    }
  }

  async function handleSave() {
    if (!workspaceId || !user) return
    setSaving(true)
    setSaveError(null)
    try {
      // Cria primeiro o que foi marcado como "criar novo" e vincula ao id
      // recém-criado — o vínculo salvo é sempre com algo que já existe.
      const finalLinks = { ...activeLinks }
      for (const [pluggyAccountId, kind] of activeCreates) {
        const pluggyAccount = found?.find((a) => a.id === pluggyAccountId)
        if (!pluggyAccount) continue
        finalLinks[pluggyAccountId] =
          kind === 'card'
            ? {
                cardId: await createCard(
                  workspaceId,
                  cardDataFromPluggy(pluggyAccount, pluggyAccount.institution),
                  user.uid,
                ),
              }
            : {
                accountId: await createAccount(
                  workspaceId,
                  accountDataFromPluggy(pluggyAccount, pluggyAccount.institution),
                  user.uid,
                ),
              }
      }
      setLinks(finalLinks)
      setToCreate({})

      await savePluggyConfig(workspaceId, user.uid, {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        itemIds,
        links: finalLinks,
        syncFrom,
      })
      await reloadConfigs()
      setSaving(false)
      await runSync()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Não foi possível salvar.')
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!workspaceId || !user) return
    if (!window.confirm('Remover a sua conexão bancária? Os lançamentos já importados continuam no app.'))
      return
    await deletePluggyConfig(workspaceId, user.uid)
    setConfig(null)
    setClientId('')
    setClientSecret('')
    setItemIdsRaw('')
    setLinks({})
    setFound(null)
    setSyncMessage(null)
    setSyncError(null)
  }

  const selectClass =
    'w-full rounded-lg border border-border-light bg-transparent px-2 py-1.5 text-sm text-light-primary outline-none dark:border-border-dark dark:text-dark-primary'

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Voltar"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-light-secondary transition-colors duration-200 hover:text-light-primary dark:border-border-dark dark:text-dark-secondary dark:hover:text-dark-primary"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-light-primary dark:text-dark-primary">
            Conexão bancária
          </h1>
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            Importa os gastos do banco automaticamente (Open Finance via Meu Pluggy)
          </p>
        </div>
      </div>

      {config || otherConfigs.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-border-light bg-surface-light p-4 dark:border-border-dark dark:bg-surface-dark-elevated">
          {config ? (
            <ConnectionStatus label="Minha conexão" config={config} hideError={syncMessage !== null} />
          ) : null}
          {otherConfigs.map((other) => (
            <ConnectionStatus
              key={other.ownerUid}
              label={`Conexão de ${profiles.get(other.ownerUid)?.displayName ?? 'outro membro'}`}
              config={other}
              hideError={syncMessage !== null}
            />
          ))}
          <p className="text-xs text-light-secondary dark:text-dark-secondary">
            O app sincroniza sozinho ao ser aberto (no máximo a cada 6 horas)
            {otherConfigs.length > 0 ? ', as conexões de toda a família' : ''}. O banco atualiza o Meu Pluggy
            uma vez por dia.
          </p>
          {syncMessage ? <p className="text-sm text-brand-500">{syncMessage}</p> : null}
          {syncError ? <p className="text-sm text-danger">{syncError}</p> : null}
          <Button type="button" onClick={runSync} disabled={syncing}>
            <RefreshCw size={18} className={cn(syncing && 'animate-spin')} />
            {syncing
              ? 'Sincronizando...'
              : otherConfigs.length > 0
                ? 'Sincronizar todas agora'
                : 'Sincronizar agora'}
          </Button>
        </div>
      ) : null}

      {family ? (
        <div className="flex items-start gap-2 rounded-2xl border border-border-light p-3 text-xs text-light-secondary dark:border-border-dark dark:text-dark-secondary">
          <Users size={16} className="mt-0.5 shrink-0" />
          <p>
            Modo família: cada pessoa configura aqui a <strong>sua</strong> conexão, entrando no app com a
            própria conta e usando o próprio Meu Pluggy. Os lançamentos de todos caem no mesmo workspace.
            Conta conjunta: basta uma pessoa vincular.
          </p>
        </div>
      ) : null}

      <details
        open={!loadingConfig && !config}
        className="rounded-2xl border border-border-light bg-surface-light p-4 text-sm text-light-primary dark:border-border-dark dark:bg-surface-dark-elevated dark:text-dark-primary"
      >
        <summary className="cursor-pointer font-medium">Como configurar (grátis, uns 10 minutos)</summary>
        <ol className="mt-3 flex list-decimal flex-col gap-3 pl-5 text-light-secondary dark:text-dark-secondary">
          <li>
            Crie sua conta gratuita no{' '}
            <a href="https://meu.pluggy.ai" target="_blank" rel="noreferrer" className={EXTERNAL_LINK_CLASS}>
              Meu Pluggy <ExternalLink size={12} />
            </a>{' '}
            e conecte seus bancos e cartões por lá. A autorização é feita pelo Open Finance, no app do próprio
            banco.
          </li>
          <li>
            Entre no{' '}
            <a
              href="https://dashboard.pluggy.ai"
              target="_blank"
              rel="noreferrer"
              className={EXTERNAL_LINK_CLASS}
            >
              Dashboard da Pluggy <ExternalLink size={12} />
            </a>{' '}
            <strong>com a mesma conta do Meu Pluggy</strong>. Lá dentro, abra a sua aplicação (pode ser a de
            demonstração) e copie o <strong>Client ID</strong> e o <strong>Client Secret</strong>.
          </li>
          <li>
            Ainda no Dashboard, em <strong>Applications → sua aplicação → Demo</strong>, toque em{' '}
            <strong>Connect Account</strong>, escolha o conector <strong>MeuPluggy</strong> (não o do banco) e
            entre com a sua conta do Meu Pluggy. Cada banco vira um item em <strong>Connected Items</strong>:
            copie o <strong>Item ID de cada um</strong> — um código como <code>6122de13-54da-43e6-…</code>,
            não o nome do banco. Os cartões de crédito vêm dentro do item do banco deles.
          </li>
          <li>
            Cole as três informações abaixo, toque em <strong>Buscar contas</strong> e escolha para qual conta
            ou cartão do app vão os lançamentos de cada conta do banco.
          </li>
        </ol>
        <p className="mt-3 text-xs text-light-secondary dark:text-dark-secondary">
          Mais detalhes no{' '}
          <a
            href="https://meu.pluggy.ai/api-guide"
            target="_blank"
            rel="noreferrer"
            className={EXTERNAL_LINK_CLASS}
          >
            guia oficial do Meu Pluggy <ExternalLink size={12} />
          </a>
          .
        </p>
      </details>

      <div className="flex flex-col gap-4">
        <Input
          label="Client ID"
          name="pluggyClientId"
          autoComplete="off"
          spellCheck={false}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
        <Input
          label="Client Secret"
          name="pluggyClientSecret"
          type="password"
          autoComplete="off"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pluggyItemIds" className="text-sm text-light-secondary dark:text-dark-secondary">
            Item IDs — um por banco, um por linha (passo 3)
          </label>
          <textarea
            id="pluggyItemIds"
            rows={2}
            spellCheck={false}
            value={itemIdsRaw}
            onChange={(e) => setItemIdsRaw(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className={cn(
              'rounded-xl border border-border-light bg-surface-light px-4 py-2.5 font-mono text-sm text-light-primary outline-none transition-all duration-200 focus:border-brand-500 dark:border-border-dark dark:bg-surface-dark-elevated dark:text-dark-primary',
              invalidItemIds.length > 0 && 'border-danger focus:border-danger dark:border-danger',
            )}
          />
          {invalidItemIds.length > 0 ? (
            <span className="text-sm text-danger">
              {invalidItemIds.map((entry) => `"${entry}"`).join(', ')}{' '}
              {invalidItemIds.length === 1 ? 'não é um Item ID' : 'não são Item IDs'}. O Item ID é um código
              no mesmo formato do Client ID — veja o passo 3 acima.
            </span>
          ) : (
            <span className="text-xs text-light-secondary dark:text-dark-secondary">
              Só aparecem as contas e cartões dos bancos cujo Item ID estiver aqui. A autorização do MeuPluggy
              vale 1 ano — depois, refaça o passo 3 (o Item ID pode mudar).
            </span>
          )}
        </div>
        <p className="text-xs text-light-secondary dark:text-dark-secondary">
          As credenciais ficam salvas no app (membros da família também enxergam) e só dão acesso de leitura
          aos dados que você autorizou no Meu Pluggy.
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void fetchAccounts(clientId, clientSecret, itemIds)}
          disabled={!canFetch}
        >
          {fetching ? 'Buscando...' : 'Buscar contas'}
        </Button>
        {fetchError ? <p className="text-sm text-danger">{fetchError}</p> : null}
      </div>

      {found ? (
        <div className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-light-primary dark:text-dark-primary">
            Para onde vai cada conta do banco
          </h2>
          {found.map((pluggyAccount) => (
            <div
              key={pluggyAccount.id}
              className="flex flex-col gap-2 rounded-2xl border border-border-light bg-surface-light p-3 dark:border-border-dark dark:bg-surface-dark-elevated"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-light-primary dark:text-dark-primary">
                    {pluggyAccount.marketingName || pluggyAccount.name}
                  </p>
                  <p className="text-xs text-light-secondary dark:text-dark-secondary">
                    {pluggyAccount.institution} ·{' '}
                    {pluggyAccount.type === 'CREDIT' ? 'Cartão de crédito' : 'Conta'}
                    {pluggyAccount.number ? ` · ${pluggyAccount.number}` : ''}
                  </p>
                </div>
                {typeof pluggyAccount.balance === 'number' ? (
                  <p className="shrink-0 text-xs text-light-secondary dark:text-dark-secondary">
                    {formatBRL(pluggyAccount.balance)}
                  </p>
                ) : null}
              </div>
              <select
                aria-label="Destino no app"
                value={selectValue(pluggyAccount.id)}
                onChange={(e) => updateLink(pluggyAccount.id, e.target.value)}
                className={selectClass}
              >
                <option value="">Não importar</option>
                <option value={pluggyAccount.type === 'CREDIT' ? 'new:card' : 'new:account'}>
                  {pluggyAccount.type === 'CREDIT'
                    ? '+ Criar cartão novo com os dados do banco'
                    : '+ Criar conta nova com o saldo do banco'}
                </option>
                {pluggyAccount.type === 'CREDIT' ? (
                  <>
                    <optgroup label="Cartões">
                      {cards.map((c) => (
                        <option key={c.id} value={`card:${c.id}`}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Contas">
                      {accounts.map((a) => (
                        <option key={a.id} value={`account:${a.id}`}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  </>
                ) : (
                  <>
                    <optgroup label="Contas">
                      {accounts.map((a) => (
                        <option key={a.id} value={`account:${a.id}`}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Cartões">
                      {cards.map((c) => (
                        <option key={c.id} value={`card:${c.id}`}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  </>
                )}
              </select>
              {(() => {
                // só pra vínculo já salvo — é o que a sincronização usa
                const savedLink = config?.links[pluggyAccount.id]
                if (!config || !savedLink) return null
                return (
                  <DiagnosticPanel
                    workspaceId={workspaceId}
                    ownerUid={user.uid}
                    config={config}
                    onSourceChanged={runSync}
                    pluggyAccount={pluggyAccount}
                    link={savedLink}
                    card={'cardId' in savedLink ? cards.find((c) => c.id === savedLink.cardId) : undefined}
                  />
                )
              })()}
            </div>
          ))}

          <Input
            label="Importar lançamentos a partir de"
            name="pluggySyncFrom"
            type="date"
            value={syncFrom}
            max={todayDateString()}
            onChange={(e) => setSyncFrom(e.target.value)}
          />
          <p className="-mt-2 text-xs text-light-secondary dark:text-dark-secondary">
            Escolha o dia seguinte ao último lançamento que você já registrou à mão, para não duplicar.
            Lançamentos com mesma data e valor de um já existente são ignorados.
          </p>

          {saveError ? <p className="text-sm text-danger">{saveError}</p> : null}
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Salvando...' : 'Salvar e sincronizar'}
          </Button>
        </div>
      ) : null}

      {config ? (
        <Button type="button" variant="secondary" onClick={handleRemove} className="mb-6">
          Remover minha conexão
        </Button>
      ) : null}
    </div>
  )
}

function ConnectionStatus({
  label,
  config,
  hideError,
}: {
  label: string
  config: PluggyConfig
  hideError: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Landmark size={18} className="text-brand-500" />
        <p className="text-sm font-medium text-light-primary dark:text-dark-primary">{label}</p>
      </div>
      <p className="text-xs text-light-secondary dark:text-dark-secondary">
        {config.lastSyncAt
          ? `Última sincronização: ${formatSyncDate(config.lastSyncAt)}.`
          : 'Ainda não sincronizado.'}
      </p>
      {config.lastSyncError && !hideError ? (
        <p className="text-xs text-danger">Última tentativa falhou: {config.lastSyncError}</p>
      ) : null}
    </div>
  )
}
