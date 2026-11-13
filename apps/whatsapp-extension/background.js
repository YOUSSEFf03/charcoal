/*
 * Farah WhatsApp Share — background service worker (Manifest V3).
 *
 * Holds at most ONE share job at a time:
 *   1. app-bridge.js forwards a validated share request from the Farah web app;
 *   2. we open (or reuse) a WhatsApp Web tab at /send?phone=<digits>;
 *   3. whatsapp-content.js in that tab claims the job, attaches the PDF,
 *      types the caption and reports progress;
 *   4. progress is relayed to the web-app tab; the job (and the PDF bytes)
 *      are deleted as soon as it ends.
 *
 * The job lives in chrome.storage.session (memory only, never written to
 * disk, unreadable by content scripts) so it survives the service worker
 * being suspended while WhatsApp loads. Nothing here ever sends a message.
 */
/* global importScripts */
if (typeof importScripts === 'function') importScripts('config.js', 'protocol.js')
;(function (root) {
  'use strict'
  const CONFIG = root.FARAH_WA_CONFIG
  const P = root.FARAH_WA_PROTOCOL
  const { STATUS, ERRORS } = P
  const chromeApi = root.chrome

  let job = null
  let loaded = false

  async function loadJob() {
    if (!loaded) {
      try {
        const stored = await chromeApi.storage.session.get('job')
        if (!job) job = stored.job || null
      } catch (_) {
        /* storage unavailable — keep the in-memory value */
      }
      loaded = true
    }
    if (job && Date.now() - job.createdAt > CONFIG.JOB_TTL_MS) {
      const expired = job
      await saveJob(null)
      notifyApp(expired, { status: STATUS.ERROR, code: ERRORS.JOB_EXPIRED, message: 'The WhatsApp preparation took too long and was cancelled.' })
    }
    return job
  }

  async function saveJob(next) {
    job = next
    loaded = true
    try {
      if (next) await chromeApi.storage.session.set({ job: next })
      else await chromeApi.storage.session.remove('job')
    } catch (_) {
      /* in-memory copy is still authoritative */
    }
  }

  function notifyApp(target, update) {
    if (!target || target.appTabId == null) return
    const msg = Object.assign({ type: 'status', requestId: target.requestId }, update)
    try {
      const p = chromeApi.tabs.sendMessage(target.appTabId, msg)
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } catch (_) {
      /* the app tab was closed — nothing to tell */
    }
  }

  function senderOrigin(sender) {
    if (sender.origin) return sender.origin
    try {
      return new URL(sender.url || (sender.tab && sender.tab.url) || '').origin
    } catch (_) {
      return ''
    }
  }

  async function openWhatsAppTab(phoneDigits) {
    const url = P.whatsappChatUrl(phoneDigits)
    const existing = await chromeApi.tabs.query({ url: CONFIG.WHATSAPP_ORIGIN + '/*' })
    if (existing && existing.length > 0) {
      const tab = await chromeApi.tabs.update(existing[0].id, { url, active: true })
      try {
        await chromeApi.windows.update(tab.windowId, { focused: true })
      } catch (_) {
        /* focusing is best-effort */
      }
      return tab
    }
    return chromeApi.tabs.create({ url, active: true })
  }

  async function handleShare(request, sender) {
    const checked = P.validateShareRequest(request)
    if (!checked.ok) return { ok: false, code: checked.code, message: checked.message }
    const value = checked.value

    const current = await loadJob()
    if (current) {
      if (current.requestId === value.requestId) return { ok: true, duplicate: true }
      return { ok: false, code: ERRORS.BUSY, message: 'Another document is already being prepared in WhatsApp. Finish or close it first.' }
    }

    const next = Object.assign({}, value, {
      appTabId: sender.tab ? sender.tab.id : null,
      waTabId: null,
      createdAt: Date.now(),
    })
    await saveJob(next)
    notifyApp(next, { status: STATUS.OPENING_WHATSAPP })
    try {
      const tab = await openWhatsAppTab(value.phoneDigits)
      if (job && job.requestId === next.requestId) {
        job.waTabId = tab.id
        await saveJob(job)
      }
    } catch (e) {
      await saveJob(null)
      const message = 'Could not open WhatsApp Web: ' + (e && e.message ? e.message : String(e))
      notifyApp(next, { status: STATUS.ERROR, code: ERRORS.INTERNAL, message })
      return { ok: false, code: ERRORS.INTERNAL, message }
    }
    return { ok: true }
  }

  /** WhatsApp tab asks for work. Only the tab we opened for the current job gets it. */
  async function handleWhatsAppHello(sender) {
    const current = await loadJob()
    const tabId = sender.tab && sender.tab.id
    if (!current || tabId == null || current.waTabId !== tabId) return { job: null }
    return {
      job: {
        requestId: current.requestId,
        phoneDigits: current.phoneDigits,
        fileName: current.fileName,
        mimeType: current.mimeType,
        pdfBase64: current.pdfBase64,
        message: current.message,
      },
    }
  }

  async function handleWhatsAppStatus(msg, sender) {
    const current = await loadJob()
    const tabId = sender.tab && sender.tab.id
    if (!current || current.waTabId !== tabId || current.requestId !== msg.requestId) return { ok: false }
    const allowed = [STATUS.WAITING_LOGIN, STATUS.CHAT_OPEN, STATUS.ATTACHING, STATUS.READY, STATUS.ERROR]
    if (allowed.indexOf(msg.status) === -1) return { ok: false }
    const update = { status: msg.status }
    if (typeof msg.code === 'string') update.code = msg.code.slice(0, 64)
    if (typeof msg.message === 'string') update.message = msg.message.slice(0, 300)
    if (typeof msg.chatTitle === 'string') update.chatTitle = msg.chatTitle.slice(0, 120)
    if (typeof msg.captionInserted === 'boolean') update.captionInserted = msg.captionInserted
    if (typeof msg.attachmentVerified === 'boolean') update.attachmentVerified = msg.attachmentVerified
    notifyApp(current, update)
    // Final states: drop the job and the PDF bytes immediately.
    if (msg.status === STATUS.READY || msg.status === STATUS.ERROR) await saveJob(null)
    return { ok: true }
  }

  /** Single entry point for runtime messages. Returns a promise of the response. */
  async function handleMessage(msg, sender) {
    if (!msg || typeof msg !== 'object' || !sender || sender.id !== chromeApi.runtime.id) return { ok: false }
    const origin = senderOrigin(sender)
    if (msg.type === 'ping' || msg.type === 'share') {
      if (!P.isAllowedAppOrigin(origin)) return { ok: false, code: ERRORS.BAD_REQUEST, message: 'Origin not allowed' }
      if (msg.type === 'ping') return { ok: true, version: P.VERSION }
      return handleShare(msg.request, sender)
    }
    if (msg.type === 'wa:hello' || msg.type === 'wa:status') {
      if (origin !== CONFIG.WHATSAPP_ORIGIN) return { ok: false }
      return msg.type === 'wa:hello' ? handleWhatsAppHello(sender) : handleWhatsAppStatus(msg, sender)
    }
    return { ok: false }
  }

  async function handleTabRemoved(tabId) {
    const current = await loadJob()
    if (current && current.waTabId === tabId) {
      await saveJob(null)
      notifyApp(current, { status: STATUS.ERROR, code: ERRORS.TAB_CLOSED, message: 'The WhatsApp tab was closed before the PDF was attached.' })
    }
  }

  if (chromeApi && chromeApi.runtime && chromeApi.runtime.onMessage) {
    chromeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      handleMessage(msg, sender).then(sendResponse, (e) =>
        sendResponse({ ok: false, code: ERRORS.INTERNAL, message: e && e.message ? e.message : String(e) }),
      )
      return true // async response
    })
    chromeApi.tabs.onRemoved.addListener((tabId) => {
      handleTabRemoved(tabId)
    })
  }

  root.__farahWaBackground = {
    handleMessage,
    handleTabRemoved,
    getJob: () => job,
    reset: () => {
      job = null
      loaded = false
    },
  }
})(typeof globalThis !== 'undefined' ? globalThis : self)
