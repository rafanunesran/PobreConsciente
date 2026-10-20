import type { Transaction } from '../transactions/types'

// Reconhece, pela descrição do banco, dinheiro indo pra (ou voltando de)
// uma caixinha/reserva — cada banco chama de um jeito:
//   Mercado Pago  "Dinheiro reservado Viagem" / "Dinheiro retirado Viagem"
//   Nubank        "Dinheiro guardado" / "Dinheiro resgatado" / "Aplicação RDB" / "Resgate RDB"
//   PicPay        "Guardado no Cofrinho Viagem" / "Resgate do Cofrinho Viagem"
//   Inter         "Aplicação Meu Porquinho" ...
//   o próprio app "Guardado — Viagem" / "Resgatado — Viagem"
// Sem Firestore aqui (ver caixinhaSync.ts pra quem grava).

export const CAIXINHA_NAME_MAX = 40 // mesmo teto das regras do Firestore

export interface ReserveMovement {
  kind: 'guardar' | 'resgatar'
  // nome da caixinha quando a descrição traz; sem nome (ex.: "Aplicação
  // RDB"), quem chama escolhe a caixinha da conta
  name?: string
  // caixinha já sabida — marcada pela pessoa numa movimentação igual
  // (caixinhas/rules.ts); manda mais que o nome
  caixinhaId?: string
}

// Verbos que por si só já dizem "caixinha" (com ou sem "Dinheiro" antes).
const STRONG_GUARDAR = ['reservado', 'guardado']
const STRONG_RESGATAR = ['retirado', 'resgatado']
// Verbos que só valem acompanhados de uma palavra de caixinha/aplicação —
// "Depósito" sozinho pode ser qualquer coisa.
const WEAK_GUARDAR = [
  'reserva',
  'guardar',
  'guardei',
  'aplicado',
  'aplicacao',
  'deposito',
  'depositado',
  'investido',
  'transferido',
  'transferencia',
]
const WEAK_RESGATAR = ['retirada', 'resgate', 'resgatar', 'resgatei', 'sacado', 'saque']
const CONTAINERS = [
  'caixinha',
  'caixinhas',
  'reserva',
  'reservas',
  'cofrinho',
  'cofre',
  'porquinho',
  'objetivo',
  'objetivos',
  'meta',
  'metas',
  'poupanca',
  'rdb',
  'cdb',
]
// Ruído que sobra entre o verbo e o nome.
const FILLER = new Set([
  'dinheiro',
  'na',
  'no',
  'nas',
  'nos',
  'da',
  'do',
  'das',
  'dos',
  'de',
  'em',
  'para',
  'pra',
  'a',
  'o',
  'meu',
  'minha',
  'sua',
  'seu',
])
// Códigos de produto que não são nome de caixinha.
const PRODUCT_CODES = new Set(['rdb', 'cdb', 'cdi', 'lci', 'lca'])

function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function parseReserveMovement(
  transaction: Pick<Transaction, 'description' | 'type'>,
): ReserveMovement | null {
  const original = transaction.description.replace(/\s+/g, ' ').trim()
  // palavras originais (pra devolver o nome com acento/maiúscula) e versão
  // normalizada (pra comparar), na mesma posição
  const originalWords = original.split(/[\s—–\-:|/]+/).filter(Boolean)
  const words = originalWords.map((w) => fold(w).replace(/[^a-z0-9]/g, ''))

  const verbIndex = words.findIndex(
    (w) =>
      STRONG_GUARDAR.includes(w) ||
      STRONG_RESGATAR.includes(w) ||
      WEAK_GUARDAR.includes(w) ||
      WEAK_RESGATAR.includes(w),
  )
  if (verbIndex < 0) return null
  const verb = words[verbIndex] as string
  const strong = STRONG_GUARDAR.includes(verb) || STRONG_RESGATAR.includes(verb)
  const hasContainer = words.some((w) => CONTAINERS.includes(w))
  // verbo forte só conta no começo ("Dinheiro reservado X", "Guardado — X")
  // — no meio de uma frase pode ser outra coisa.
  const strongAtStart = strong && words.slice(0, verbIndex).every((w) => w === 'dinheiro')
  if (!strongAtStart && !hasContainer) return null

  const kind = STRONG_GUARDAR.includes(verb) || WEAK_GUARDAR.includes(verb) ? 'guardar' : 'resgatar'
  // guardar sai da conta (despesa), resgatar volta pra ela (receita) — se
  // o sinal não bate, não é a movimentação que a descrição sugere.
  if ((kind === 'guardar') !== (transaction.type === 'expense')) return null

  const nameWords = originalWords.filter((_, i) => {
    if (i === verbIndex) return false
    const w = words[i] as string
    if (i < verbIndex) return false // o que vem antes do verbo ("Dinheiro") não é nome
    return !FILLER.has(w) && !CONTAINERS.includes(w) && !PRODUCT_CODES.has(w) && w !== ''
  })
  const name = nameWords.join(' ').trim().slice(0, CAIXINHA_NAME_MAX)
  return name ? { kind, name } : { kind }
}
