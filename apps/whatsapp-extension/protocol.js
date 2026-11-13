/*
 * Farah WhatsApp Share — message protocol and validation shared by every
 * part of the extension (page bridge, background worker, WhatsApp script).
 *
 * Page  ⇄ app-bridge.js        window.postMessage, channel "farah-wa"
 * app-bridge ⇄ background.js   chrome.runtime messages
 * background ⇄ whatsapp-content.js  chrome.runtime / chrome.tabs messages
 */
;(function (root) {
  'use strict'
  const CONFIG = root.FARAH_WA_CONFIG

  const CHANNEL = 'farah-wa'
  const VERSION = '1.0.0'

  /** Progress states reported back to the web app. "ready" is final: attached, awaiting the user's Send. */
  const STATUS = Object.freeze({
    ACCEPTED: 'accepted',
    OPENING_WHATSAPP: 'opening_whatsapp',
    WAITING_LOGIN: 'waiting_login',
    CHAT_OPEN: 'chat_open',
    ATTACHING: 'attaching',
    READY: 'ready',
    ERROR: 'error',
  })

  const ERRORS = Object.freeze({
    BAD_REQUEST: 'BAD_REQUEST',
    FILE_TOO_LARGE: 'FILE_TOO_LARGE',
    BUSY: 'BUSY',
    EXTENSION_DISCONNECTED: 'EXTENSION_DISCONNECTED',
    NOT_LOGGED_IN: 'NOT_LOGGED_IN',
    WHATSAPP_TIMEOUT: 'WHATSAPP_TIMEOUT',
    CHAT_UNAVAILABLE: 'CHAT_UNAVAILABLE',
    ATTACH_FAILED: 'ATTACH_FAILED',
    TAB_CLOSED: 'TAB_CLOSED',
    JOB_EXPIRED: 'JOB_EXPIRED',
    INTERNAL: 'INTERNAL',
  })

  // CR, LF and the Unicode line/paragraph separators (U+2028, U+2029).
  const LINE_BREAKS_RE = new RegExp('[\\r\\n' + String.fromCharCode(0x2028, 0x2029) + ']+', 'g')
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/
  // "%PDF-" base64-encoded starts with "JVBERi0".
  const PDF_BASE64_MAGIC = 'JVBERi0'

  function fail(message, code) {
    return { ok: false, code: code || ERRORS.BAD_REQUEST, message }
  }

  /** Strips path separators / reserved characters; must end in .pdf. */
  function sanitizeFileName(name) {
    const cleaned = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    return /\.pdf$/i.test(cleaned) ? cleaned : null
  }

  /**
   * Collapses line breaks to spaces and drops control characters.
   * Line breaks are removed on purpose: in WhatsApp an Enter can SEND, so the
   * extension never types one.
   */
  function sanitizeMessage(message) {
    return String(message)
      .replace(LINE_BREAKS_RE, ' ')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
      .replace(/ {2,}/g, ' ')
      .trim()
  }

  /**
   * Validates a share request from the web page. Returns
   * { ok: true, value } with a cleaned copy, or { ok: false, code, message }.
   */
  function validateShareRequest(input) {
    if (!input || typeof input !== 'object') return fail('Request must be an object')
    const { requestId, phoneDigits, fileName, mimeType, pdfBase64, message } = input
    if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) return fail('requestId must be a UUID')
    if (typeof phoneDigits !== 'string' || !/^\d{8,15}$/.test(phoneDigits)) return fail('phoneDigits must be 8–15 digits')
    if (typeof fileName !== 'string') return fail('fileName is required')
    const safeName = sanitizeFileName(fileName)
    if (!safeName) return fail('fileName must end in .pdf')
    if (mimeType !== 'application/pdf') return fail('Only PDF files can be shared')
    if (typeof pdfBase64 !== 'string' || !pdfBase64) return fail('pdfBase64 is required')
    const maxB64 = Math.ceil(CONFIG.MAX_PDF_BYTES / 3) * 4
    if (pdfBase64.length > maxB64) return fail('The PDF is too large to share through WhatsApp Web', ERRORS.FILE_TOO_LARGE)
    if (pdfBase64.length % 4 !== 0 || !BASE64_RE.test(pdfBase64)) return fail('pdfBase64 is not valid base64')
    if (!pdfBase64.startsWith(PDF_BASE64_MAGIC)) return fail('The file is not a PDF')
    if (typeof message !== 'string') return fail('message must be a string')
    const cleanMessage = sanitizeMessage(message)
    if (cleanMessage.length > CONFIG.MAX_MESSAGE_CHARS) return fail('The message is too long')
    return {
      ok: true,
      value: { requestId, phoneDigits, fileName: safeName, mimeType, pdfBase64, message: cleanMessage },
    }
  }

  /** True when `origin` is one of the configured web-app origins. */
  function isAllowedAppOrigin(origin) {
    return CONFIG.APP_ORIGINS.indexOf(origin) !== -1
  }

  /** WhatsApp chat URL for a phone number (digits only). No text: the caption is typed into the preview. */
  function whatsappChatUrl(phoneDigits) {
    return CONFIG.WHATSAPP_ORIGIN + '/send?phone=' + encodeURIComponent(phoneDigits)
  }

  const api = Object.freeze({
    CHANNEL,
    VERSION,
    STATUS,
    ERRORS,
    validateShareRequest,
    sanitizeFileName,
    sanitizeMessage,
    isAllowedAppOrigin,
    whatsappChatUrl,
  })
  root.FARAH_WA_PROTOCOL = api
})(typeof globalThis !== 'undefined' ? globalThis : self)
