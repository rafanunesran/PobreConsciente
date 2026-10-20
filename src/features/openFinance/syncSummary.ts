import { BANK_SYNC_TAG, type SyncResult } from './sync'

// Texto do resultado de uma sincronização — o mesmo na tela de Conexão
// bancária e no aviso do menu de ação rápida.
export function describeSyncResult({ imported, accountsAligned = 0, caixinhasAligned = 0 }: SyncResult): string {
  const aligned = [
    accountsAligned > 0 ? `${accountsAligned} conta(s)` : '',
    caixinhasAligned > 0 ? `${caixinhasAligned} caixinha(s)` : '',
  ].filter(Boolean)
  return (
    (imported === 0
      ? 'Tudo em dia — nenhum lançamento novo.'
      : `${imported} lançamento(s) importado(s) com a tag "${BANK_SYNC_TAG}".`) +
    (aligned.length > 0 ? ` Saldo igual ao do banco: ${aligned.join(' e ')}.` : '')
  )
}
