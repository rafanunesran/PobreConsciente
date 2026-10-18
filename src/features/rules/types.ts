import type { TransactionType } from '../transactions/types'

// "Se a descrição contém X, use a categoria Y (e as tags Z)". Aplicada ao
// importar extratos/faturas e ao digitar a descrição de um lançamento novo
// — sempre como sugestão: a pessoa ainda pode trocar antes de salvar.
export interface CategoryRule {
  id: string
  pattern: string // trecho procurado na descrição (comparação sem acento/caixa)
  type: TransactionType
  categoryId: string
  tags?: string[]
  createdBy: string
}
