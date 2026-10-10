import type { Account } from '../accounts/types'
import type { CreditCard } from '../cards/types'
import type { Category } from '../categories/types'
import { effectiveParentId } from '../categories/categoryTree'
import type { Transaction } from './types'

interface CsvLookups {
  categoriesById: Map<string, Category>
  accountsById: Map<string, Account>
  cardsById: Map<string, CreditCard>
}

// Formato pensado pro Excel/Google Planilhas em pt-BR: separador ";",
// vírgula decimal, data dd/mm/aaaa e BOM UTF-8 (sem ele o Excel quebra os
// acentos).
const SEPARATOR = ';'

function escapeCell(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function formatAmount(value: number): string {
  return value.toFixed(2).replace('.', ',')
}

function formatDateBR(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

export function transactionsToCsv(transactions: Transaction[], lookups: CsvLookups): string {
  const header = ['Data', 'Descrição', 'Tipo', 'Valor', 'Categoria', 'Subcategoria', 'Conta/Cartão', 'Situação', 'Tags']
  const rows = [...transactions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => {
      const category = lookups.categoriesById.get(t.categoryId)
      const parentId = category ? effectiveParentId(category, lookups.categoriesById) : undefined
      const parent = parentId ? lookups.categoriesById.get(parentId) : undefined
      const linked =
        t.accountId !== undefined
          ? (lookups.accountsById.get(t.accountId)?.name ?? '')
          : `Cartão ${lookups.cardsById.get(t.cardId ?? '')?.name ?? ''}`.trim()
      const paidLabel = t.type === 'expense' ? (t.paid ? 'Pago' : 'A pagar') : t.paid ? 'Recebido' : 'A receber'
      return [
        formatDateBR(t.date),
        t.description,
        t.type === 'expense' ? 'Despesa' : 'Receita',
        formatAmount(t.type === 'expense' ? -t.amount : t.amount),
        parent ? parent.name : (category?.name ?? ''),
        parent ? (category?.name ?? '') : '',
        linked,
        paidLabel,
        (t.tags ?? []).join(', '),
      ]
    })
  return [header, ...rows].map((row) => row.map(escapeCell).join(SEPARATOR)).join('\r\n')
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
