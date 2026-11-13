/*
 * Farah WhatsApp Share — bridge between the Farah web app page and the
 * extension. Runs as a content script on the app's origin only.
 *
 * Page → extension: window.postMessage({ channel: 'farah-wa', dir: 'to-extension', type, id, ... })
 * Extension → page: window.postMessage({ channel: 'farah-wa', dir: 'to-page', type, id|requestId, ... })
 *
 * Every page message is checked: same window, exact allowed origin, known type.
 */
;(function (root) {
  'use strict'
  const P = root.FARAH_WA_PROTOCOL
  const { STATUS, ERRORS } = P
  const chromeApi = root.chrome
  const win = root.window || root
  const origin = win.location.origin

  // Manifest match patterns can't pin a port: re-check the exact origin.
  if (!P.isAllowedAppOrigin(origin)) return

  function toPage(payload) {
    win.postMessage(Object.assign({ channel: P.CHANNEL, dir: 'to-page' }, payload), origin)
  }

  function sendToBackground(msg) {
    return new Promise((resolve) => {
      try {
        chromeApi.runtime.sendMessage(msg, (response) => {
          const err = chromeApi.runtime.lastError
          if (err) resolve({ ok: false, code: ERRORS.EXTENSION_DISCONNECTED, message: err.message })
          else resolve(response || { ok: false, code: ERRORS.EXTENSION_DISCONNECTED, message: 'No response from the extension' })
        })
      } catch (e) {
        // "Extension context invalidated" after the extension is reloaded/updated.
        resolve({ ok: false, code: ERRORS.EXTENSION_DISCONNECTED, message: 'The extension was reloaded. Refresh this page and try again.' })
      }
    })
  }

  async function onPageMessage(event) {
    if (event.source !== win || event.origin !== origin) return
    const data = event.data
    if (!data || typeof data !== 'object' || data.channel !== P.CHANNEL || data.dir !== 'to-extension') return
    const id = typeof data.id === 'string' ? data.id.slice(0, 64) : null
    if (!id) return

    if (data.type === 'ping') {
      const res = await sendToBackground({ type: 'ping' })
      toPage({ type: 'pong', id, ok: !!res.ok, version: P.VERSION, code: res.code, message: res.message })
      return
    }

    if (data.type === 'share') {
      const checked = P.validateShareRequest(data.request)
      if (!checked.ok) {
        toPage({ type: 'share-result', id, ok: false, code: checked.code, message: checked.message })
        return
      }
      const res = await sendToBackground({ type: 'share', request: checked.value })
      toPage({ type: 'share-result', id, ok: !!res.ok, duplicate: !!res.duplicate, code: res.code, message: res.message })
      if (res.ok && !res.duplicate) toPage({ type: 'status', requestId: checked.value.requestId, status: STATUS.ACCEPTED })
    }
  }

  win.addEventListener('message', (event) => {
    onPageMessage(event)
  })

  // Progress from the background worker → page.
  if (chromeApi && chromeApi.runtime && chromeApi.runtime.onMessage) {
    chromeApi.runtime.onMessage.addListener((msg, sender) => {
      if (!sender || sender.id !== chromeApi.runtime.id || sender.tab) return // only the background worker
      if (!msg || msg.type !== 'status' || typeof msg.requestId !== 'string') return
      const out = { type: 'status', requestId: msg.requestId, status: msg.status }
      for (const k of ['code', 'message', 'chatTitle', 'captionInserted', 'attachmentVerified']) {
        if (msg[k] !== undefined) out[k] = msg[k]
      }
      toPage(out)
    })
  }

  // Lets the page detect the extension without a round trip.
  try {
    win.document.documentElement.setAttribute('data-farah-wa-extension', P.VERSION)
  } catch (_) {
    /* document not ready — the ping still works */
  }
})(typeof globalThis !== 'undefined' ? globalThis : self)
