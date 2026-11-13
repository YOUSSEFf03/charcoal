/**
 * Page-side client for the "Farah Charcoal – WhatsApp Share" Chrome extension
 * (apps/whatsapp-extension). Talks to its content script through
 * window.postMessage on channel "farah-wa"; only messages from this window
 * and this origin are accepted.
 *
 * The extension opens the chat in WhatsApp Web, attaches the PDF and types
 * the caption, then STOPS — the user presses Send in WhatsApp. "ready" means
 * exactly that: prepared, not sent.
 */

export const WA_CHANNEL = 'farah-wa'

/** Zip of apps/whatsapp-extension, served by the site (vite-plugins/whatsapp-extension-zip.mjs). */
export const EXTENSION_DOWNLOAD_URL = '/downloads/farah-whatsapp-extension.zip'

export type WaExtensionStatus =
  | 'accepted'
  | 'opening_whatsapp'
  | 'waiting_login'
  | 'chat_open'
  | 'attaching'
  | 'ready'
  | 'error'

export interface WaStatusUpdate {
  status: WaExtensionStatus
  code?: string
  message?: string
  chatTitle?: string
  /** False when WhatsApp's caption box could not be filled (the message is on the clipboard instead). */
  captionInserted?: boolean
  /** True when the PDF's file name is visible in WhatsApp's preview. */
  attachmentVerified?: boolean
}

export interface WaShareRequest {
  requestId: string
  phoneDigits: string
  fileName: string
  mimeType: 'application/pdf'
  pdfBase64: string
  message: string
}

export class WhatsAppShareError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'WhatsAppShareError'
  }
}

/** No answer to a ping within this time = extension not installed / not enabled for this site. */
const PING_TIMEOUT_MS = 1500
/** The extension must acknowledge a share request within this time. */
const ACK_TIMEOUT_MS = 5000
/** Upper bound for the whole WhatsApp step (includes scanning the QR code). */
const JOB_TIMEOUT_MS = 7 * 60 * 1000

let seq = 0
const nextId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`

function listen(handler: (data: Record<string, unknown>) => void): () => void {
  const fn = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return
    const data = event.data
    if (!data || typeof data !== 'object' || data.channel !== WA_CHANNEL || data.dir !== 'to-page') return
    handler(data as Record<string, unknown>)
  }
  window.addEventListener('message', fn)
  return () => window.removeEventListener('message', fn)
}

function post(payload: Record<string, unknown>) {
  window.postMessage({ channel: WA_CHANNEL, dir: 'to-extension', ...payload }, window.location.origin)
}

/** Version the extension stamped on <html>, or null. Cheap synchronous hint. */
export function extensionMarker(): string | null {
  return document.documentElement.getAttribute('data-farah-wa-extension')
}

/** Resolves with the extension version, or null if it does not answer. */
export function pingExtension(timeoutMs = PING_TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    const id = nextId()
    const stop = listen((data) => {
      if (data.type !== 'pong' || data.id !== id) return
      clearTimeout(timer)
      stop()
      resolve(data.ok ? String(data.version ?? '') || 'unknown' : null)
    })
    const timer = setTimeout(() => {
      stop()
      resolve(null)
    }, timeoutMs)
    post({ type: 'ping', id })
  })
}

/**
 * Hands a prepared PDF to the extension and follows its progress.
 * Resolves with the final "ready" update; rejects with WhatsAppShareError.
 */
export function sendToExtension(
  request: WaShareRequest,
  onStatus: (u: WaStatusUpdate) => void,
  timeouts: { ack?: number; job?: number } = {},
): Promise<WaStatusUpdate> {
  return new Promise((resolve, reject) => {
    const id = nextId()
    let acked = false
    let done = false
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      clearTimeout(ackTimer)
      clearTimeout(jobTimer)
      stop()
      fn()
    }
    const stop = listen((data) => {
      if (data.type === 'share-result' && data.id === id) {
        acked = true
        if (!data.ok) {
          finish(() => reject(new WhatsAppShareError(String(data.code ?? 'EXTENSION_ERROR'), String(data.message ?? 'The extension refused the request.'))))
        }
        return
      }
      if (data.type !== 'status' || data.requestId !== request.requestId) return
      const update: WaStatusUpdate = { status: data.status as WaExtensionStatus }
      for (const k of ['code', 'message', 'chatTitle', 'captionInserted', 'attachmentVerified'] as const) {
        if (data[k] !== undefined) (update as unknown as Record<string, unknown>)[k] = data[k]
      }
      acked = true
      if (update.status === 'error') {
        finish(() => reject(new WhatsAppShareError(update.code ?? 'EXTENSION_ERROR', update.message ?? 'WhatsApp preparation failed.')))
        return
      }
      onStatus(update)
      if (update.status === 'ready') finish(() => resolve(update))
    })
    const ackTimer = setTimeout(() => {
      if (!acked) {
        finish(() => reject(new WhatsAppShareError('EXTENSION_NOT_FOUND', 'The WhatsApp extension did not respond.')))
      }
    }, timeouts.ack ?? ACK_TIMEOUT_MS)
    const jobTimer = setTimeout(() => {
      finish(() => reject(new WhatsAppShareError('WHATSAPP_TIMEOUT', 'WhatsApp did not finish preparing the document in time.')))
    }, timeouts.job ?? JOB_TIMEOUT_MS)
    post({ type: 'share', id, request })
  })
}
