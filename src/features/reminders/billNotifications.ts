import { getDocs } from 'firebase/firestore'
import { cardsCollection } from '../cards/api'
import { todayDateString } from '../cards/invoiceUtils'
import { transactionsCollection } from '../transactions/api'
import { formatBRL } from '../../lib/utils'
import { upcomingBills } from './upcomingBills'

// Preferência por aparelho (não por conta): permissão de notificação é do
// navegador, então guardar isso no Firestore não faria sentido.
const ENABLED_KEY = 'pc-bill-reminders'
const LAST_SHOWN_KEY = 'pc-bill-reminders-last'
// Aviso só pro que vence até depois de amanhã — a semana inteira fica no
// card da Home; notificação é pra urgência.
const NOTIFY_WINDOW_DAYS = 2

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // modo privado / storage bloqueado — a preferência só não persiste
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function billRemindersEnabled(): boolean {
  return notificationsSupported() && Notification.permission === 'granted' && readStorage(ENABLED_KEY) === '1'
}

export async function enableBillReminders(): Promise<boolean> {
  if (!notificationsSupported()) return false
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false
  writeStorage(ENABLED_KEY, '1')
  writeStorage(LAST_SHOWN_KEY, null) // avisa já na próxima abertura
  return true
}

export function disableBillReminders(): void {
  writeStorage(ENABLED_KEY, null)
}

async function showNotification(title: string, body: string): Promise<void> {
  const options: NotificationOptions = { body, icon: `${import.meta.env.BASE_URL}icon.svg`, tag: 'bill-reminder' }
  // No Android, `new Notification()` lança erro — lá só funciona via
  // service worker (o PWA já registra um). No desktop qualquer um serve.
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
  if (registration) {
    await registration.showNotification(title, options)
  } else {
    new Notification(title, options)
  }
}

// Chamado ao abrir o app: no máximo um aviso por dia, e só se houver algo
// vencido ou vencendo logo. Não é push de verdade (precisaria de servidor)
// — funciona quando a pessoa abre o app ou o PWA.
export async function notifyUpcomingBills(uid: string): Promise<void> {
  if (!billRemindersEnabled()) return
  const today = todayDateString()
  if (readStorage(LAST_SHOWN_KEY) === today) return

  const [transactionsSnap, cardsSnap] = await Promise.all([
    getDocs(transactionsCollection(uid)),
    getDocs(cardsCollection(uid)),
  ])
  const bills = upcomingBills(
    transactionsSnap.docs.map((d) => d.data()),
    cardsSnap.docs.map((d) => d.data()),
    NOTIFY_WINDOW_DAYS,
    today,
  )
  writeStorage(LAST_SHOWN_KEY, today)
  if (bills.length === 0) return

  const overdue = bills.filter((b) => b.daysUntil < 0).length
  const total = bills.reduce((sum, b) => sum + b.amount, 0)
  const title = overdue > 0 ? `${overdue} conta(s) vencida(s)` : `${bills.length} conta(s) vencendo`
  const names = bills
    .slice(0, 3)
    .map((b) => b.title)
    .join(', ')
  await showNotification(title, `${names}${bills.length > 3 ? '…' : ''} — total ${formatBRL(total)}`)
}
