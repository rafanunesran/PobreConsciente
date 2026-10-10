import { MAX_DATA_URL_LENGTH } from './types'
import type { NewAttachment } from './api'

export class AttachmentTooLargeError extends Error {}
export class AttachmentTypeError extends Error {}

const MAX_DIMENSION = 1600

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new AttachmentTypeError('Imagem inválida'))
    }
    image.src = url
  })
}

// Foto de comprovante tirada no celular passa fácil de 3 MB — redimensiona
// pra no máximo 1600px e recomprime em JPEG, baixando a qualidade até caber
// no documento. Texto de recibo continua legível nessa resolução.
async function compressImage(file: File): Promise<string> {
  const image = await loadImage(file)
  let scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height))
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new AttachmentTypeError('Navegador sem suporte a canvas')
    context.fillStyle = '#ffffff' // PNG com transparência não vira fundo preto
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const quality = Math.max(0.4, 0.8 - attempt * 0.1)
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl
    scale *= 0.8
  }
  throw new AttachmentTooLargeError('Imagem grande demais')
}

export async function prepareAttachment(file: File): Promise<NewAttachment> {
  if (file.type === 'application/pdf') {
    const dataUrl = await readAsDataUrl(file)
    if (dataUrl.length > MAX_DATA_URL_LENGTH) throw new AttachmentTooLargeError('PDF grande demais')
    return { name: file.name, mimeType: 'application/pdf', dataUrl }
  }
  if (file.type.startsWith('image/')) {
    const dataUrl = await compressImage(file)
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return { name, mimeType: 'image/jpeg', dataUrl }
  }
  throw new AttachmentTypeError('Tipo de arquivo não suportado')
}

// Abre o comprovante numa aba nova. Navegadores bloqueiam navegar direto
// pra data: URL, então converte pra blob: antes.
export async function openAttachment(dataUrl: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
