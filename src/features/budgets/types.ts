// Limite mensal de gastos de UMA categoria de despesa — o mesmo valor vale
// pra todo mês (não há orçamento "de março" separado do "de abril"), igual
// a um teto fixo que a pessoa revisa quando quiser.
export interface Budget {
  id: string
  categoryId: string
  amount: number // teto mensal, sempre > 0
  createdBy: string // uid de quem criou — nunca alterado em updates
}
