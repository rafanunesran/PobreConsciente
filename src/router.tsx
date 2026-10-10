import { createBrowserRouter } from 'react-router-dom'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { AppShell } from './components/layout/AppShell'

export const router = createBrowserRouter(
  [
    {
      path: '/login',
      lazy: async () => {
        const { LoginPage } = await import('./features/auth/LoginPage')
        return { Component: LoginPage }
      },
    },
    {
      path: '/esqueci-senha',
      lazy: async () => {
        const { ForgotPasswordPage } = await import('./features/auth/ForgotPasswordPage')
        return { Component: ForgotPasswordPage }
      },
    },
    {
      path: '/',
      element: (
        <ProtectedRoute>
          <AppShell />
        </ProtectedRoute>
      ),
      children: [
        {
          index: true,
          lazy: async () => {
            const { HomePage } = await import('./features/home/HomePage')
            return { Component: HomePage }
          },
        },
        {
          path: 'cartoes',
          lazy: async () => {
            const { CardsPage } = await import('./features/cards/CardsPage')
            return { Component: CardsPage }
          },
        },
        {
          path: 'cartoes/novo',
          lazy: async () => {
            const { CardFormPage } = await import('./features/cards/CardFormPage')
            return { Component: CardFormPage }
          },
        },
        {
          path: 'cartoes/:cardId/editar',
          lazy: async () => {
            const { CardFormPage } = await import('./features/cards/CardFormPage')
            return { Component: CardFormPage }
          },
        },
        {
          path: 'cartoes/:cardId/fatura',
          lazy: async () => {
            const { CardInvoicePage } = await import('./features/cards/CardInvoicePage')
            return { Component: CardInvoicePage }
          },
        },
        {
          path: 'cartoes/:cardId/fatura/ajustar',
          lazy: async () => {
            const { AdjustInvoicePage } = await import('./features/cards/AdjustInvoicePage')
            return { Component: AdjustInvoicePage }
          },
        },
        {
          path: 'cartoes/:cardId/fatura/pagar',
          lazy: async () => {
            const { PayCardInvoicePage } = await import('./features/cards/PayCardInvoicePage')
            return { Component: PayCardInvoicePage }
          },
        },
        {
          path: 'cartoes/:cardId/importar',
          lazy: async () => {
            const { ImportPage } = await import('./features/imports/ImportPage')
            return { Component: ImportPage }
          },
        },
        {
          path: 'cartoes/:cardId/corrigir-importacao',
          lazy: async () => {
            const { FixImportedInvoicePage } = await import('./features/cards/FixImportedInvoicePage')
            return { Component: FixImportedInvoicePage }
          },
        },
        {
          path: 'contas',
          lazy: async () => {
            const { AccountsPage } = await import('./features/accounts/AccountsPage')
            return { Component: AccountsPage }
          },
        },
        {
          path: 'contas/nova',
          lazy: async () => {
            const { AccountFormPage } = await import('./features/accounts/AccountFormPage')
            return { Component: AccountFormPage }
          },
        },
        {
          path: 'contas/transferir',
          lazy: async () => {
            const { AccountTransferPage } = await import('./features/accounts/AccountTransferPage')
            return { Component: AccountTransferPage }
          },
        },
        {
          path: 'contas/:accountId/editar',
          lazy: async () => {
            const { AccountFormPage } = await import('./features/accounts/AccountFormPage')
            return { Component: AccountFormPage }
          },
        },
        {
          path: 'contas/:accountId',
          lazy: async () => {
            const { AccountDetailPage } = await import('./features/accounts/AccountDetailPage')
            return { Component: AccountDetailPage }
          },
        },
        {
          path: 'contas/:accountId/ajustar',
          lazy: async () => {
            const { AdjustAccountBalancePage } = await import('./features/accounts/AdjustAccountBalancePage')
            return { Component: AdjustAccountBalancePage }
          },
        },
        {
          path: 'contas/:accountId/importar',
          lazy: async () => {
            const { ImportPage } = await import('./features/imports/ImportPage')
            return { Component: ImportPage }
          },
        },
        {
          path: 'contas/:accountId/caixinhas/nova',
          lazy: async () => {
            const { CaixinhaFormPage } = await import('./features/caixinhas/CaixinhaFormPage')
            return { Component: CaixinhaFormPage }
          },
        },
        {
          path: 'contas/:accountId/caixinhas/:caixinhaId/editar',
          lazy: async () => {
            const { CaixinhaFormPage } = await import('./features/caixinhas/CaixinhaFormPage')
            return { Component: CaixinhaFormPage }
          },
        },
        {
          path: 'contas/:accountId/caixinhas/:caixinhaId',
          lazy: async () => {
            const { CaixinhaDetailPage } = await import('./features/caixinhas/CaixinhaDetailPage')
            return { Component: CaixinhaDetailPage }
          },
        },
        {
          path: 'contas/:accountId/caixinhas/:caixinhaId/transferir',
          lazy: async () => {
            const { CaixinhaTransferPage } = await import('./features/caixinhas/CaixinhaTransferPage')
            return { Component: CaixinhaTransferPage }
          },
        },
        {
          path: 'contas/:accountId/caixinhas/:caixinhaId/rendimento',
          lazy: async () => {
            const { CaixinhaYieldPage } = await import('./features/caixinhas/CaixinhaYieldPage')
            return { Component: CaixinhaYieldPage }
          },
        },
        {
          path: 'contas/:accountId/caixinhas/:caixinhaId/ajustar',
          lazy: async () => {
            const { CaixinhaAdjustPage } = await import('./features/caixinhas/CaixinhaAdjustPage')
            return { Component: CaixinhaAdjustPage }
          },
        },
        {
          path: 'categorias',
          lazy: async () => {
            const { CategoriesPage } = await import('./features/categories/CategoriesPage')
            return { Component: CategoriesPage }
          },
        },
        {
          path: 'categorias/nova',
          lazy: async () => {
            const { CategoryFormPage } = await import('./features/categories/CategoryFormPage')
            return { Component: CategoryFormPage }
          },
        },
        {
          path: 'categorias/:categoryId/editar',
          lazy: async () => {
            const { CategoryFormPage } = await import('./features/categories/CategoryFormPage')
            return { Component: CategoryFormPage }
          },
        },
        {
          path: 'registros',
          lazy: async () => {
            const { RegistrosPage } = await import('./features/transactions/RegistrosPage')
            return { Component: RegistrosPage }
          },
        },
        {
          path: 'saldo',
          lazy: async () => {
            const { BalanceHistoryPage } = await import('./features/transactions/BalanceHistoryPage')
            return { Component: BalanceHistoryPage }
          },
        },
        {
          path: 'registros/novo',
          lazy: async () => {
            const { RegistroChooserPage } = await import('./features/transactions/RegistroChooserPage')
            return { Component: RegistroChooserPage }
          },
        },
        {
          path: 'registros/:kind/nova',
          lazy: async () => {
            const { TransactionFormPage } = await import('./features/transactions/TransactionFormPage')
            return { Component: TransactionFormPage }
          },
        },
        {
          path: 'registros/:kind/:transactionId/editar',
          lazy: async () => {
            const { TransactionFormPage } = await import('./features/transactions/TransactionFormPage')
            return { Component: TransactionFormPage }
          },
        },
        {
          path: 'registros/pendentes',
          lazy: async () => {
            const { PendingTransactionsPage } = await import('./features/transactions/PendingTransactionsPage')
            return { Component: PendingTransactionsPage }
          },
        },
        {
          path: 'orcamentos',
          lazy: async () => {
            const { BudgetsPage } = await import('./features/budgets/BudgetsPage')
            return { Component: BudgetsPage }
          },
        },
        {
          path: 'orcamentos/novo',
          lazy: async () => {
            const { BudgetFormPage } = await import('./features/budgets/BudgetFormPage')
            return { Component: BudgetFormPage }
          },
        },
        {
          path: 'orcamentos/:budgetId/editar',
          lazy: async () => {
            const { BudgetFormPage } = await import('./features/budgets/BudgetFormPage')
            return { Component: BudgetFormPage }
          },
        },
        {
          path: 'perfil',
          lazy: async () => {
            const { PerfilPage } = await import('./features/auth/PerfilPage')
            return { Component: PerfilPage }
          },
        },
        {
          path: 'familia',
          lazy: async () => {
            const { FamilyPage } = await import('./features/family/FamilyPage')
            return { Component: FamilyPage }
          },
        },
      ],
    },
  ],
  // NOTE: no GitHub Pages o app fica sob /PobreConsciente/ (project page),
  // não na raiz do domínio. import.meta.env.BASE_URL reflete o `base` do
  // vite.config.ts automaticamente (dev: "/", build: "/PobreConsciente/").
  { basename: import.meta.env.BASE_URL },
)
