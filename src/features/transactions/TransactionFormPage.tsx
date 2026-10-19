import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAccounts } from '../accounts/useAccounts'
import { useCards } from '../cards/useCards'
import { useCategories } from '../categories/useCategories'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { cn, formatBRL } from '../../lib/utils'
import { useToastStore } from '../../stores/toastStore'
import { getDueDate, getInvoicePeriod } from '../cards/invoiceUtils'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { RegistrosLocationState } from './RegistrosPage'
import { categoryOptions } from '../categories/categoryTree'
import { expenseSchema, incomeSchema, type ExpenseFormData, type IncomeFormData } from './schemas'
import { createTransaction, deleteTransaction, getTransaction, updateTransaction } from './api'
import { createRecurringTransaction } from './recurring'
import { createInstallmentTransaction } from './installments'
import {
  deleteTransactionSeries,
  fetchSeriesTransactions,
  seriesKindOf,
  updateTransactionSeries,
  type SeriesScope,
} from './series'
import { SeriesScopeDialog } from './SeriesScopeDialog'
import { TagInput } from './TagInput'
import { AttachmentsSection } from '../attachments/AttachmentsSection'
import { addAttachment, deleteAttachmentsOf, type NewAttachment } from '../attachments/api'
import { collectTags } from './tags'
import { useTransactions } from './useTransactions'
import type { Transaction, TransactionFormData } from './types'

type Kind = 'despesa' | 'receita'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function TransactionFormPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const attachmentFailed = (location.state as { attachmentFailed?: boolean } | null)?.attachmentFailed === true
  const { kind, transactionId } = useParams<{ kind: Kind; transactionId?: string }>()
  const isExpense = kind === 'despesa'
  const isEditMode = Boolean(transactionId)
  const user = useAuthStore((state) => state.user)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)

  const showToast = useToastStore((state) => state.show)
  const { accounts } = useAccounts(workspaceId ?? '')
  const { cards } = useCards(workspaceId ?? '')
  const { categories } = useCategories(workspaceId ?? '')
  const { transactions: allTransactions } = useTransactions(workspaceId ?? '')
  const tagSuggestions = useMemo(() => collectTags(allTransactions), [allTransactions])
  const relevantCategories = categoryOptions(categories, isExpense ? 'expense' : 'income')

  const [formError, setFormError] = useState<string | null>(null)
  const [isLoadingTransaction, setIsLoadingTransaction] = useState(isEditMode)
  const [loadError, setLoadError] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  // Lançamento carregado (não só o form): é dele que saem `recurringRuleId`/
  // `installmentGroupId`, que dizem se esta edição precisa perguntar o
  // alcance. `series` é a série completa, usada só pra mostrar quantos
  // lançamentos cada opção do diálogo afeta.
  const [loadedTransaction, setLoadedTransaction] = useState<Transaction | null>(null)
  const [series, setSeries] = useState<Transaction[]>([])
  const [scopePrompt, setScopePrompt] = useState<
    { action: 'edit'; payload: TransactionFormData } | { action: 'delete' } | null
  >(null)
  const [scopeBusy, setScopeBusy] = useState(false)
  const [scopeError, setScopeError] = useState<string | null>(null)
  // Comprovantes escolhidos antes do lançamento existir (modo criação) —
  // gravados logo depois do createTransaction, já com o id em mãos.
  const [pendingAttachments, setPendingAttachments] = useState<NewAttachment[]>([])

  const expenseForm = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      amount: 0,
      date: todayISO(),
      description: '',
      categoryId: '',
      linkedType: 'account',
      accountId: '',
      cardId: '',
      paid: true,
      recurrence: 'none',
      installmentsCount: 2,
      installmentAmountMode: 'total',
      tags: [],
    },
  })
  const incomeForm = useForm<IncomeFormData>({
    resolver: zodResolver(incomeSchema),
    defaultValues: {
      amount: 0,
      date: todayISO(),
      description: '',
      categoryId: '',
      accountId: '',
      paid: true,
      recurrence: 'none',
      installmentsCount: 2,
      installmentAmountMode: 'total',
      tags: [],
    },
  })

  useEffect(() => {
    if (!workspaceId || !transactionId) return
    let cancelled = false
    getTransaction(workspaceId, transactionId)
      .then((transaction) => {
        if (cancelled) return
        if (!transaction) {
          navigate('/registros', { replace: true })
          return
        }
        setLoadedTransaction(transaction)
        if (seriesKindOf(transaction) !== null) {
          // só pros contadores do diálogo de alcance — se falhar, o
          // diálogo ainda aparece, apenas sem os números.
          fetchSeriesTransactions(workspaceId, transaction)
            .then((found) => {
              if (!cancelled) setSeries(found)
            })
            .catch(() => undefined)
        }
        if (isExpense) {
          expenseForm.reset({
            amount: transaction.amount,
            date: transaction.date,
            description: transaction.description,
            categoryId: transaction.categoryId,
            linkedType: transaction.accountId !== undefined ? 'account' : 'card',
            accountId: transaction.accountId ?? '',
            cardId: transaction.cardId ?? '',
            paid: transaction.paid,
            recurrence: 'none',
            installmentsCount: 2,
            installmentAmountMode: 'total',
            tags: transaction.tags ?? [],
          })
        } else {
          incomeForm.reset({
            amount: transaction.amount,
            date: transaction.date,
            description: transaction.description,
            categoryId: transaction.categoryId,
            accountId: transaction.accountId ?? '',
            paid: transaction.paid,
            recurrence: 'none',
            installmentsCount: 2,
            installmentAmountMode: 'total',
            tags: transaction.tags ?? [],
          })
        }
        setIsLoadingTransaction(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoadError(true)
        setIsLoadingTransaction(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, transactionId, isExpense, navigate, expenseForm, incomeForm])

  if (!user || !workspaceId) return null

  // Cria um lançamento avulso e anexa os comprovantes pendentes. Se o
  // anexo falhar, o lançamento já existe — abre a edição dele pra pessoa
  // tentar anexar de novo, em vez de perder o arquivo em silêncio.
  // Devolve null quando já navegou pra edição (o caller não segue pro extrato).
  async function createSingleWithAttachments(payload: TransactionFormData): Promise<string | null> {
    if (!user || !workspaceId) return null
    const newId = await createTransaction(workspaceId, payload, user.uid)
    try {
      for (const attachment of pendingAttachments) {
        await addAttachment(workspaceId, newId, attachment, user.uid)
      }
      return newId
    } catch {
      navigate(`/registros/${kind}/${newId}/editar`, { replace: true, state: { attachmentFailed: true } })
      return null
    }
  }

  // Depois de salvar: volta pro extrato NO MÊS em que o lançamento aparece
  // (compra de cartão aparece no mês de vencimento da fatura, agregada nela),
  // destaca a linha e confirma com um aviso — antes a pessoa caía no mês
  // atual sem feedback e achava que o registro tinha sumido.
  function goToStatement(
    message: string,
    date: string,
    linkage: { accountId?: string; cardId?: string },
    id?: string,
  ) {
    const card = linkage.cardId ? cards.find((c) => c.id === linkage.cardId) : undefined
    let state: RegistrosLocationState = { month: date.slice(0, 7), highlightKey: id }
    let text = message
    if (card) {
      const period = getInvoicePeriod(card.closingDay, date)
      const dueDate = getDueDate(period.end, card.dueDay)
      state = { month: dueDate.slice(0, 7), highlightKey: `${card.id}-${period.end}` }
      text = `${message} na fatura ${card.name} (vence ${format(new Date(`${dueDate}T00:00:00`), "d 'de' MMM", { locale: ptBR })})`
    }
    showToast(text)
    navigate('/registros', { state })
  }

  async function onSubmitExpense(data: ExpenseFormData) {
    if (!user || !workspaceId) return
    setFormError(null)
    const linkage =
      data.linkedType === 'account' ? { accountId: data.accountId } : { cardId: data.cardId }
    // Defesa em profundidade: despesa de cartão só fica paga através do
    // pagamento de fatura (payCardInvoice) — nunca na criação. Edição não
    // entra aqui (o toggle já vem escondido pra card, `data.paid` reflete
    // só o que já estava salvo).
    const paidOnCreate = data.linkedType === 'card' ? false : data.paid

    try {
      if (transactionId) {
        const payload: TransactionFormData = {
          type: 'expense',
          amount: data.amount,
          date: data.date,
          description: data.description,
          categoryId: data.categoryId,
          paid: data.paid,
          tags: data.tags ?? [],
          ...linkage,
        }
        // Lançamento de série (fixo ou parcelado): antes de gravar,
        // pergunta o alcance — quem grava é handleScopeConfirm.
        if (loadedTransaction && seriesKindOf(loadedTransaction) !== null) {
          setScopeError(null)
          setScopePrompt({ action: 'edit', payload })
          return
        }
        await updateTransaction(workspaceId, transactionId, payload)
        goToStatement('Despesa atualizada', data.date, linkage, transactionId)
      } else if (data.recurrence === 'fixed') {
        await createRecurringTransaction(
          workspaceId,
          {
            amount: data.amount,
            description: data.description,
            categoryId: data.categoryId,
            dayOfMonth: Number(data.date.slice(-2)),
            tags: data.tags ?? [],
            ...linkage,
          },
          'expense',
          paidOnCreate,
          user.uid,
        )
        goToStatement(`Despesa fixa de ${formatBRL(data.amount)} criada, todo dia ${Number(data.date.slice(-2))}`, data.date, linkage)
      } else if (data.recurrence === 'installments') {
        await createInstallmentTransaction(
          workspaceId,
          {
            amount: data.amount,
            description: data.description,
            categoryId: data.categoryId,
            date: data.date,
            tags: data.tags ?? [],
            ...linkage,
          },
          'expense',
          data.installmentsCount ?? 2,
          data.installmentAmountMode === 'perInstallment',
          paidOnCreate,
          user.uid,
        )
        goToStatement(`Despesa parcelada em ${data.installmentsCount ?? 2}x criada`, data.date, linkage)
      } else {
        const payload: TransactionFormData = {
          type: 'expense',
          amount: data.amount,
          date: data.date,
          description: data.description,
          categoryId: data.categoryId,
          paid: paidOnCreate,
          tags: data.tags ?? [],
          ...linkage,
        }
        const newId = await createSingleWithAttachments(payload)
        if (!newId) return
        goToStatement(`Despesa de ${formatBRL(data.amount)} salva`, data.date, linkage, newId)
      }
    } catch {
      setFormError('Não foi possível salvar a despesa. Tente novamente.')
    }
  }

  async function onSubmitIncome(data: IncomeFormData) {
    if (!user || !workspaceId) return
    setFormError(null)
    try {
      if (transactionId) {
        const payload: TransactionFormData = {
          type: 'income',
          amount: data.amount,
          date: data.date,
          description: data.description,
          categoryId: data.categoryId,
          accountId: data.accountId,
          paid: data.paid,
          tags: data.tags ?? [],
        }
        // Lançamento de série (fixo ou parcelado): antes de gravar,
        // pergunta o alcance — quem grava é handleScopeConfirm.
        if (loadedTransaction && seriesKindOf(loadedTransaction) !== null) {
          setScopeError(null)
          setScopePrompt({ action: 'edit', payload })
          return
        }
        await updateTransaction(workspaceId, transactionId, payload)
        goToStatement('Receita atualizada', data.date, { accountId: data.accountId }, transactionId)
      } else if (data.recurrence === 'fixed') {
        await createRecurringTransaction(
          workspaceId,
          {
            amount: data.amount,
            description: data.description,
            categoryId: data.categoryId,
            dayOfMonth: Number(data.date.slice(-2)),
            accountId: data.accountId,
            tags: data.tags ?? [],
          },
          'income',
          data.paid,
          user.uid,
        )
        goToStatement(`Receita fixa de ${formatBRL(data.amount)} criada, todo dia ${Number(data.date.slice(-2))}`, data.date, { accountId: data.accountId })
      } else if (data.recurrence === 'installments') {
        await createInstallmentTransaction(
          workspaceId,
          {
            amount: data.amount,
            description: data.description,
            categoryId: data.categoryId,
            date: data.date,
            accountId: data.accountId,
            tags: data.tags ?? [],
          },
          'income',
          data.installmentsCount ?? 2,
          data.installmentAmountMode === 'perInstallment',
          data.paid,
          user.uid,
        )
        goToStatement(`Receita parcelada em ${data.installmentsCount ?? 2}x criada`, data.date, { accountId: data.accountId })
      } else {
        const payload: TransactionFormData = {
          type: 'income',
          amount: data.amount,
          date: data.date,
          description: data.description,
          categoryId: data.categoryId,
          accountId: data.accountId,
          paid: data.paid,
          tags: data.tags ?? [],
        }
        const newId = await createSingleWithAttachments(payload)
        if (!newId) return
        goToStatement(`Receita de ${formatBRL(data.amount)} salva`, data.date, { accountId: data.accountId }, newId)
      }
    } catch {
      setFormError('Não foi possível salvar a receita. Tente novamente.')
    }
  }

  async function handleDelete() {
    if (!workspaceId || !transactionId) return
    setIsDeleting(true)
    try {
      await deleteTransaction(workspaceId, transactionId)
      await deleteAttachmentsOf(workspaceId, [transactionId]).catch(() => undefined)
      showToast(`${isExpense ? 'Despesa' : 'Receita'} excluída`)
      navigate('/registros', { state: { month: loadedTransaction?.date.slice(0, 7) } satisfies RegistrosLocationState })
    } catch {
      setFormError('Não foi possível excluir. Tente novamente.')
      setIsDeleting(false)
    }
  }

  // Único ponto que grava quando o lançamento faz parte de uma série — o
  // escopo escolhido decide se a alteração/exclusão para nele, alcança os
  // pendentes ou a série toda.
  async function handleScopeConfirm(scope: SeriesScope) {
    if (!workspaceId || !scopePrompt || !loadedTransaction) return
    setScopeBusy(true)
    setScopeError(null)
    try {
      if (scopePrompt.action === 'edit') {
        await updateTransactionSeries(workspaceId, loadedTransaction, scopePrompt.payload, scope)
        goToStatement(
          `${isExpense ? 'Despesa' : 'Receita'} atualizada`,
          scopePrompt.payload.date,
          scopePrompt.payload,
          loadedTransaction.id,
        )
        return
      } else {
        await deleteTransactionSeries(workspaceId, loadedTransaction, scope)
        // Mesmo critério de alcance de series.ts (isInScope): o próprio
        // lançamento sempre, os irmãos conforme o escopo escolhido.
        const removedIds = [
          loadedTransaction.id,
          ...(scope === 'one'
            ? []
            : series.filter((t) => t.id !== loadedTransaction.id && (scope === 'all' || !t.paid)).map((t) => t.id)),
        ]
        await deleteAttachmentsOf(workspaceId, removedIds).catch(() => undefined)
        showToast(removedIds.length > 1 ? `${removedIds.length} lançamentos excluídos` : 'Lançamento excluído')
        navigate('/registros', { state: { month: loadedTransaction.date.slice(0, 7) } satisfies RegistrosLocationState })
      }
    } catch {
      setScopeError(
        scopePrompt.action === 'edit'
          ? 'Não foi possível salvar. Tente novamente.'
          : 'Não foi possível excluir. Tente novamente.',
      )
      setScopeBusy(false)
    }
  }

  if (isEditMode && isLoadingTransaction) {
    return (
      <div className="px-6 pt-4 text-sm text-light-secondary dark:text-dark-secondary">
        Carregando...
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-3 px-6 pt-4">
        <p className="text-sm text-danger">
          Não foi possível carregar esse registro. Verifique sua conexão ou tente novamente mais
          tarde.
        </p>
        <Button type="button" variant="secondary" onClick={() => navigate('/registros')}>
          Voltar
        </Button>
      </div>
    )
  }

  if (relevantCategories.length === 0) {
    return (
      <div className="flex flex-col gap-3 px-6 pt-4">
        <p className="text-sm text-light-secondary dark:text-dark-secondary">
          Você ainda não tem categorias de {isExpense ? 'despesa' : 'receita'}. Crie uma antes de
          continuar.
        </p>
        <Button type="button" variant="secondary" onClick={() => navigate('/categorias')}>
          Ir para Categorias
        </Button>
      </div>
    )
  }

  const seriesKind = loadedTransaction ? seriesKindOf(loadedTransaction) : null
  // Contadores do diálogo: o próprio lançamento entra em 'pendentes' mesmo
  // se já estiver pago — foi nele que a ação começou (ver isInScope em
  // series.ts). Sem a série carregada, sobra ao menos ele mesmo.
  const totalCount = series.length > 0 ? series.length : 1
  const pendingCount =
    series.length > 0
      ? series.filter((t) => t.id === loadedTransaction?.id || !t.paid).length
      : 1

  const linkedType = expenseForm.watch('linkedType')
  const recurrence = expenseForm.watch('recurrence')
  const installmentAmountMode = expenseForm.watch('installmentAmountMode')
  const expensePaid = expenseForm.watch('paid')
  const incomePaid = incomeForm.watch('paid')
  const incomeRecurrence = incomeForm.watch('recurrence')
  const incomeInstallmentAmountMode = incomeForm.watch('installmentAmountMode')

  return (
    <div className="flex flex-col gap-6 px-6 pt-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-light-primary dark:text-dark-primary">
          {isEditMode ? 'Editar' : 'Nova'} {isExpense ? 'despesa' : 'receita'}
        </h1>
        {isEditMode ? null : (
          // Trocar de tipo sem voltar pro menu — a escolha errada era comum.
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl border border-border-light p-1 dark:border-border-dark">
            {(['despesa', 'receita'] as const).map((k) => (
              <Link
                key={k}
                to={`/registros/${k}/nova`}
                replace
                aria-current={kind === k ? 'page' : undefined}
                className={cn(
                  'rounded-lg py-2 text-center text-sm font-medium transition-colors duration-200',
                  kind === k
                    ? k === 'despesa'
                      ? 'bg-danger text-white'
                      : 'bg-brand-500 text-white'
                    : 'text-light-secondary hover:text-light-primary dark:text-dark-secondary dark:hover:text-dark-primary',
                )}
              >
                {k === 'despesa' ? 'Despesa (saída)' : 'Receita (entrada)'}
              </Link>
            ))}
          </div>
        )}
        {attachmentFailed ? (
          <p className="text-sm text-danger">
            O lançamento foi salvo, mas o comprovante não foi anexado. Tente anexar de novo abaixo.
          </p>
        ) : null}
        {seriesKind !== null ? (
          <p className="text-sm text-light-secondary dark:text-dark-secondary">
            {seriesKind === 'recurring'
              ? 'Lançamento fixo'
              : `Parcela ${loadedTransaction?.installmentIndex ?? 1}/${loadedTransaction?.installmentTotal ?? 1}`}{' '}
            — ao salvar ou excluir você escolhe se vale só para este, para todos os pendentes ou
            para todos.
          </p>
        ) : null}
      </div>

      {isExpense ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={expenseForm.handleSubmit(onSubmitExpense)}
          noValidate
        >
          <Input
            label="Descrição"
            placeholder="Ex: Supermercado"
            error={expenseForm.formState.errors.description?.message}
            {...expenseForm.register('description')}
          />
          <Input
            label="Valor"
            type="number"
            step="0.01"
            error={expenseForm.formState.errors.amount?.message}
            {...expenseForm.register('amount', { valueAsNumber: true })}
          />
          <Input
            label="Data"
            type="date"
            error={expenseForm.formState.errors.date?.message}
            {...expenseForm.register('date')}
          />
          <Select
            label="Categoria"
            error={expenseForm.formState.errors.categoryId?.message}
            {...expenseForm.register('categoryId')}
          >
            <option value="">Selecione</option>
            {relevantCategories.map(({ category, label }) => (
              <option key={category.id} value={category.id}>
                {label}
              </option>
            ))}
          </Select>
          <TagInput
            value={expenseForm.watch('tags') ?? []}
            onChange={(tags) => expenseForm.setValue('tags', tags)}
            suggestions={tagSuggestions}
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-light-secondary dark:text-dark-secondary">Pago com</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => expenseForm.setValue('linkedType', 'account', { shouldValidate: true })}
                className={cn(
                  'flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-200',
                  linkedType === 'account'
                    ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                    : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
                )}
              >
                Conta
              </button>
              <button
                type="button"
                onClick={() => {
                  expenseForm.setValue('linkedType', 'card', { shouldValidate: true })
                  // Despesa de cartão só fica paga através do pagamento de
                  // fatura (payCardInvoice) — nunca marcada direto aqui.
                  expenseForm.setValue('paid', false)
                }}
                className={cn(
                  'flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-200',
                  linkedType === 'card'
                    ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                    : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
                )}
              >
                Cartão
              </button>
            </div>
            {expenseForm.formState.errors.linkedType ? (
              <span className="text-sm text-danger">
                {expenseForm.formState.errors.linkedType.message}
              </span>
            ) : null}
          </div>

          {linkedType === 'account' ? (
            <Select label="Conta" {...expenseForm.register('accountId')}>
              <option value="">Selecione</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          ) : (
            <Select label="Cartão" {...expenseForm.register('cardId')}>
              <option value="">Selecione</option>
              {cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.name}
                </option>
              ))}
            </Select>
          )}

          {linkedType === 'account' ? (
            <button
              type="button"
              onClick={() => expenseForm.setValue('paid', !expensePaid)}
              className={cn(
                'flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-200',
                expensePaid
                  ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                  : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
              )}
            >
              Já foi paga?
              <span>{expensePaid ? 'Sim' : 'Não'}</span>
            </button>
          ) : (
            <p className="text-sm text-light-secondary dark:text-dark-secondary">
              Despesa de cartão só fica paga quando a fatura é paga.
            </p>
          )}

          {!isEditMode ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-light-secondary dark:text-dark-secondary">Recorrência</span>
              <div className="flex gap-2">
                {(
                  [
                    ['none', 'Nenhuma'],
                    ['fixed', 'Fixa'],
                    ['installments', 'Parcelamento'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => expenseForm.setValue('recurrence', value)}
                    className={cn(
                      'flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200',
                      recurrence === value
                        ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                        : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {recurrence === 'fixed' ? (
                <p className="text-sm text-light-secondary dark:text-dark-secondary">
                  Gera 12 lançamentos mensais no dia {expenseForm.watch('date').slice(-2)}, renovando
                  automaticamente conforme se aproxima do fim.
                </p>
              ) : null}
            </div>
          ) : null}

          {!isEditMode && recurrence === 'installments' ? (
            <div className="flex flex-col gap-4 rounded-xl border border-border-light p-4 dark:border-border-dark">
              <Input
                label="Número de parcelas"
                type="number"
                min={2}
                max={48}
                error={expenseForm.formState.errors.installmentsCount?.message}
                {...expenseForm.register('installmentsCount', { valueAsNumber: true })}
              />
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-light-secondary dark:text-dark-secondary">
                  O valor informado é
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => expenseForm.setValue('installmentAmountMode', 'total')}
                    className={cn(
                      'flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200',
                      installmentAmountMode === 'total'
                        ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                        : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
                    )}
                  >
                    O total a parcelar
                  </button>
                  <button
                    type="button"
                    onClick={() => expenseForm.setValue('installmentAmountMode', 'perInstallment')}
                    className={cn(
                      'flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200',
                      installmentAmountMode === 'perInstallment'
                        ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                        : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
                    )}
                  >
                    O valor de cada parcela
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {isEditMode || recurrence === 'none' ? (
            <AttachmentsSection
              workspaceId={workspaceId}
              userId={user.uid}
              transactionId={transactionId}
              pending={pendingAttachments}
              onPendingChange={setPendingAttachments}
            />
          ) : null}

          {formError ? <p className="text-sm text-danger">{formError}</p> : null}

          <Button type="submit" disabled={expenseForm.formState.isSubmitting}>
            {expenseForm.formState.isSubmitting ? 'Salvando...' : 'Salvar'}
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={incomeForm.handleSubmit(onSubmitIncome)}
          noValidate
        >
          <Input
            label="Descrição"
            placeholder="Ex: Salário"
            error={incomeForm.formState.errors.description?.message}
            {...incomeForm.register('description')}
          />
          <Input
            label="Valor"
            type="number"
            step="0.01"
            error={incomeForm.formState.errors.amount?.message}
            {...incomeForm.register('amount', { valueAsNumber: true })}
          />
          <Input
            label="Data"
            type="date"
            error={incomeForm.formState.errors.date?.message}
            {...incomeForm.register('date')}
          />
          <Select
            label="Categoria"
            error={incomeForm.formState.errors.categoryId?.message}
            {...incomeForm.register('categoryId')}
          >
            <option value="">Selecione</option>
            {relevantCategories.map(({ category, label }) => (
              <option key={category.id} value={category.id}>
                {label}
              </option>
            ))}
          </Select>
          <TagInput
            value={incomeForm.watch('tags') ?? []}
            onChange={(tags) => incomeForm.setValue('tags', tags)}
            suggestions={tagSuggestions}
          />
          <Select
            label="Conta"
            error={incomeForm.formState.errors.accountId?.message}
            {...incomeForm.register('accountId')}
          >
            <option value="">Selecione</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>

          <button
            type="button"
            onClick={() => incomeForm.setValue('paid', !incomePaid)}
            className={cn(
              'flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-200',
              incomePaid
                ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
            )}
          >
            Já foi recebida?
            <span>{incomePaid ? 'Sim' : 'Não'}</span>
          </button>

          {!isEditMode ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-light-secondary dark:text-dark-secondary">Recorrência</span>
              <div className="flex gap-2">
                {(
                  [
                    ['none', 'Nenhuma'],
                    ['fixed', 'Fixa'],
                    ['installments', 'Parcelamento'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => incomeForm.setValue('recurrence', value)}
                    className={cn(
                      'flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200',
                      incomeRecurrence === value
                        ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                        : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {incomeRecurrence === 'fixed' ? (
                <p className="text-sm text-light-secondary dark:text-dark-secondary">
                  Gera 12 lançamentos mensais no dia {incomeForm.watch('date').slice(-2)}, renovando
                  automaticamente conforme se aproxima do fim.
                </p>
              ) : null}
            </div>
          ) : null}

          {!isEditMode && incomeRecurrence === 'installments' ? (
            <div className="flex flex-col gap-4 rounded-xl border border-border-light p-4 dark:border-border-dark">
              <Input
                label="Número de parcelas"
                type="number"
                min={2}
                max={48}
                error={incomeForm.formState.errors.installmentsCount?.message}
                {...incomeForm.register('installmentsCount', { valueAsNumber: true })}
              />
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-light-secondary dark:text-dark-secondary">
                  O valor informado é
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => incomeForm.setValue('installmentAmountMode', 'total')}
                    className={cn(
                      'flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200',
                      incomeInstallmentAmountMode === 'total'
                        ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                        : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
                    )}
                  >
                    O total a parcelar
                  </button>
                  <button
                    type="button"
                    onClick={() => incomeForm.setValue('installmentAmountMode', 'perInstallment')}
                    className={cn(
                      'flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200',
                      incomeInstallmentAmountMode === 'perInstallment'
                        ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                        : 'border-border-light text-light-secondary dark:border-border-dark dark:text-dark-secondary',
                    )}
                  >
                    O valor de cada parcela
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {isEditMode || incomeRecurrence === 'none' ? (
            <AttachmentsSection
              workspaceId={workspaceId}
              userId={user.uid}
              transactionId={transactionId}
              pending={pendingAttachments}
              onPendingChange={setPendingAttachments}
            />
          ) : null}

          {formError ? <p className="text-sm text-danger">{formError}</p> : null}

          <Button type="submit" disabled={incomeForm.formState.isSubmitting}>
            {incomeForm.formState.isSubmitting ? 'Salvando...' : 'Salvar'}
          </Button>
        </form>
      )}

      {isEditMode ? (
        <div className="border-t border-border-light pt-4 dark:border-border-dark">
          {seriesKind !== null ? (
            // Série: a confirmação de exclusão é o próprio diálogo de
            // alcance, que já pede confirmação explícita.
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setScopeError(null)
                setScopePrompt({ action: 'delete' })
              }}
            >
              Excluir
            </Button>
          ) : confirmingDelete ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-light-secondary dark:text-dark-secondary">
                Tem certeza? Essa ação não pode ser desfeita.
              </p>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={isDeleting}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  className="flex-1 bg-danger hover:bg-danger hover:shadow-none"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Excluindo...' : 'Confirmar exclusão'}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(true)}>
              Excluir
            </Button>
          )}
        </div>
      ) : null}

      {scopePrompt && seriesKind !== null && loadedTransaction ? (
        <SeriesScopeDialog
          action={scopePrompt.action}
          kind={seriesKind}
          type={loadedTransaction.type}
          pendingCount={pendingCount}
          totalCount={totalCount}
          busy={scopeBusy}
          error={scopeError}
          onCancel={() => {
            setScopePrompt(null)
            setScopeError(null)
          }}
          onConfirm={handleScopeConfirm}
        />
      ) : null}
    </div>
  )
}
