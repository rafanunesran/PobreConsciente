import { BANK_SYNC_TAG, type SyncResult } from './sync'

// Texto do resultado de uma sincronização — o mesmo na tela de Conexão
// bancária e no aviso do menu de ação rápida. Só cartões são importados
// sozinhos; conta corrente fica no Histórico do banco.
export function describeSyncResult({ imported }: SyncResult): string {
  return imported === 0
    ? 'Cartões em dia: nenhum lançamento novo. As movimentações das contas ficam no Histórico do banco.'
    : `${imported} lançamento(s) de cartão importado(s) com a tag "${BANK_SYNC_TAG}". As movimentações das contas ficam no Histórico do banco.`
}
