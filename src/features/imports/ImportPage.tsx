import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, FileWarning, Upload } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from '../accounts/useAccounts'
import { useCards } from '../cards/useCards'
import { useCategories } from '../categories/useCategories'
import { useTransactions } from '../transactions/useTransactions'
import { Button } from '../../components/ui/Button'
import { cn, formatBRL } from '../../lib/utils'
import { parseFile } from './parseFile'
import { buildCategorySuggester } from './categorize'
import { isLikelyDuplicate } from './duplicates'
import { expandFutureInstallments } from './expandInstallments'
import { importTransactions } from './api'
import type { ImportTarget, ParsedEntry } from './types'
import { categoryOptions } from '../categories/categoryTree'
import { useCategoryRules } from '../rules/useCategoryRules'
import { matchCategoryRule } from '../rules/matchRule'

interface ReviewRow extends ParsedEntry {
  selected: boolean
  categoryId: string
  tags?: string[]
  likelyDuplicate: boolean
}

function formatDisplayDate(date: string): string {
  return format(new Date(`${date}T00:00:00`), "d 'de' MMM", { locale: ptBR })
}

export function ImportPage() {
  const navigate = useNavigate()
  const { cardId, accountId } = useParams<{ cardId?: string; accountId?: string }>()
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { accounts } = useAccounts(workspaceId ?? '')
  const { cards } = useCards(workspaceId ?? '')
  const { categories } = useCategories(workspaceId ?? '')
  const { transactions } = useTransactions(workspaceId ?? '')
  const { rules } = useCategoryRules(workspaceId ?? '')

  const [rows, setRows] = useState<ReviewRow[] | null>(null)
  const [fileFormat, setFileFormat] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const account = accountId ? accounts.find((a) => a.id === accountId) : undefined
  const card = cardId ? cards.find((c) => c.id === cardId) : undefined
  const targetKind: 'card' | 'account' = cardId ? 'card' : 'account'
  const targetName = card?.name ?? account?.name

  const scopedTransactions = useMemo(
    () => transactions.filter((t) => (cardId ? t.cardId === cardId : t.accountId === accountId)),
    [transactions, cardId, accountId],
  )

  async function handleFile(file: File) {
    setParsing(true)
    setParseError(null)
    setRows(null)
    try {
      const parsed = await parseFile(file, targetKind)
      const suggest = buildCategorySuggester(transactions)
      setRows(
        parsed.map((entry) => {
          // Regra explícita da pessoa vence a sugestão pelo histórico.
          const rule = matchCategoryRule(rules, entry.description, entry.type)
          return {
            ...entry,
            selected: !isLikelyDuplicate(entry, scopedTransactions),
            categoryId: rule?.categoryId ?? suggest(entry.description, entry.type) ?? '',
            ...(rule?.tags !== undefined ? { tags: rule.tags } : {}),
            likelyDuplicate: isLikelyDuplicate(entry, scopedTransactions),
          }
        }),
      )
      setFileFormat(file.name.toLowerCase().split('.').pop() ?? null)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Não foi possível ler este arquivo.')
    } finally {
      setParsing(false)
    }
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setRows((current) => {
      if (!current) return current
      const next = [...current]
      const row = next[index]
      if (!row) return current
      next[index] = { ...row, ...patch }
      return next
    })
  }

  function resetFile() {
    setRows(null)
    setParseError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const selectedRows = rows?.filter((r) => r.selected) ?? []
  const selectedTotal = selectedRows.reduce(
    (sum, r) => sum + (r.type === 'expense' ? -r.amount : r.amount),
    0,
  )
  const canImport =
    !importing && selectedRows.length > 0 && selectedRows.every((r) => r.categoryId)

  async function handleImport() {
    if (!user || !workspaceId || (!accountId && !cardId)) return
    setImporting(true)
    setImportError(null)
    try {
      const target: ImportTarget = cardId ? { cardId } : { accountId: accountId! }
      // Cada linha selecionada com parcela detectada traz junto as parcelas
      // futuras ainda não vistas em nenhuma fatura (já deduplicadas contra o
      // que já existe) — ver expandInstallments.ts.
      const withFutureInstallments = selectedRows.flatMap((row) => [
        row,
        ...expandFutureInstallments(row, scopedTransactions),
      ])
      await importTransactions(workspaceId, withFutureInstallments, target, user.uid)
      navigate(cardId ? `/cartoes/${cardId}/fatura` : `/contas/${accountId}`)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Não foi possível importar. Tente novamente.')
      setImporting(false)
    }
  }

  if (!user || !workspaceId) return null

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
            {targetKind === 'card' ? 'Importar fatura' : 'Importar extrato'}
          </h1>
          {targetName ? (
            <p className="text-sm text-light-secondary dark:text-dark-secondary">{targetName}</p>
          ) : null}
        </div>
      </div>

      {!rows ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border-light py-12 text-center dark:border-border-dark">
          <Upload size={32} className="text-light-secondary dark:text-dark-secondary" />
          <p className="max-w-xs text-sm text-light-secondary dark:text-dark-secondary">
            Envie um arquivo .csv, .ofx ou .pdf {targetKind === 'card' ? 'da fatura' : 'do extrato'}.
            Você vai poder revisar tudo antes de confirmar.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.ofx,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
          <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={parsing}>
            {parsing ? 'Lendo arquivo...' : 'Escolher arquivo'}
          </Button>
          {parseError ? <p className="max-w-xs text-sm text-danger">{parseError}</p> : null}
        </div>
      ) : (
        <>
          {fileFormat === 'pdf' ? (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
              <FileWarning size={16} className="mt-0.5 shrink-0" />
              <p>
                A leitura de PDF é sujeita a erros de layout — confira valores, datas e categorias
                de cada linha antes de importar.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            {rows.map((row, index) => {
              const futureCount = row.installmentTotal
                ? expandFutureInstallments(row, scopedTransactions).length
                : 0
              return (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-2xl border border-border-light bg-surface-light p-3 dark:border-border-dark dark:bg-surface-dark-elevated"
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    aria-label="Selecionar"
                    checked={row.selected}
                    onChange={(e) => updateRow(index, { selected: e.target.checked })}
                    className="mt-1.5 h-4 w-4 shrink-0 accent-brand-500"
                  />
                  <div className="min-w-0 flex-1">
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) => updateRow(index, { description: e.target.value })}
                      className="w-full truncate bg-transparent text-sm font-medium text-light-primary outline-none dark:text-dark-primary"
                    />
                    <p className="text-xs text-light-secondary dark:text-dark-secondary">
                      {formatDisplayDate(row.date)}
                      {row.installmentTotal
                        ? ` · Parcela ${row.installmentIndex}/${row.installmentTotal}`
                        : ''}
                      {row.likelyDuplicate ? (
                        <span className="text-amber-600 dark:text-amber-400"> · Possível duplicata</span>
                      ) : (
                        ''
                      )}
                    </p>
                    {futureCount > 0 ? (
                      <p className="text-xs text-light-secondary dark:text-dark-secondary">
                        + {futureCount} parcela(s) futura(s) será(ão) criada(s) automaticamente
                      </p>
                    ) : null}
                  </div>
                  <p
                    className={cn(
                      'shrink-0 text-sm font-semibold',
                      row.type === 'expense' ? 'text-danger' : 'text-brand-500',
                    )}
                  >
                    {row.type === 'expense' ? '-' : '+'}
                    {formatBRL(row.amount)}
                  </p>
                </div>

                <select
                  value={row.categoryId}
                  onChange={(e) => updateRow(index, { categoryId: e.target.value })}
                  className={cn(
                    'w-full rounded-lg border bg-transparent px-2 py-1.5 text-xs text-light-primary outline-none dark:text-dark-primary',
                    row.categoryId ? 'border-border-light dark:border-border-dark' : 'border-danger',
                  )}
                >
                  <option value="">Selecione a categoria</option>
                  {categoryOptions(categories, row.type).map(({ category, label }) => (
                    <option key={category.id} value={category.id}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              )
            })}
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-border-light bg-surface-light p-4 dark:border-border-dark dark:bg-surface-dark-elevated">
            <div className="flex items-center justify-between text-sm">
              <span className="text-light-secondary dark:text-dark-secondary">
                {selectedRows.length} selecionado(s)
              </span>
              <span
                className={cn('font-semibold', selectedTotal < 0 ? 'text-danger' : 'text-brand-500')}
              >
                {selectedTotal < 0 ? '-' : '+'}
                {formatBRL(Math.abs(selectedTotal))}
              </span>
            </div>
            {importError ? <p className="text-sm text-danger">{importError}</p> : null}
            <Button type="button" onClick={handleImport} disabled={!canImport}>
              {importing ? 'Importando...' : `Importar ${selectedRows.length} lançamento(s)`}
            </Button>
            <Button type="button" variant="secondary" onClick={resetFile} disabled={importing}>
              Escolher outro arquivo
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
