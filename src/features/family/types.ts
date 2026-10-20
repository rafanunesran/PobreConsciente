// O ID do documento É o uid de quem criou a família — permite que as
// regras do Firestore façam get() direto (sem query) pra checar
// membership a partir do uid que já está no caminho de qualquer outra
// coleção (users/{ownerId}/...).
export interface Family {
  id: string // === ownerId
  ownerId: string
  memberIds: string[] // inclui ownerId
}

// Espelho público mínimo de nome/foto — o Firebase Auth não expõe dados
// de OUTROS usuários pro cliente, só do próprio (auth.currentUser).
export interface UserProfile {
  uid: string
  displayName: string
  email: string
  photoURL?: string
  // nome completo como aparece no banco (ex.: "Rafael Nunes Figueiredo") —
  // a conexão bancária usa pra reconhecer Pix/TED entre membros da família
  // como transferência, não gasto (ver openFinance/sync.ts)
  fullName?: string
}
