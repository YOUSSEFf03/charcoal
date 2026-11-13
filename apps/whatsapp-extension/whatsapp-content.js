/*
 * Farah WhatsApp Share — runs inside https://web.whatsapp.com.
 *
 * When this tab was opened for a share job, it:
 *   1. waits for WhatsApp Web to load (or for the user to scan the QR code);
 *   2. waits for the chat opened by /send?phone=<digits>;
 *   3. attaches the PDF — paste into the composer, else drop onto the chat,
 *      else the Attach menu's document file input;
 *   4. types the caption into WhatsApp's preview screen;
 *   5. STOPS. WhatsApp's own preview with its Send button is left on screen.
 *
 * SAFETY — this script never sends:
 *   - it never dispatches keyboard events (no Enter, no shortcuts);
 *   - the only element it ever clicks is the Attach button, through
 *     safeClick(), which refuses anything that looks like a Send control;
 *   - line breaks are stripped from the caption before typing it.
 */
;(function (root) {
  'use strict'
  const CONFIG = root.FARAH_WA_CONFIG
  const P = root.FARAH_WA_PROTOCOL
  const { STATUS, ERRORS } = P
  const S = CONFIG.SELECTORS

  const doc = () => root.document
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  function q(selectors, scope) {
    const base = scope || doc()
    for (const sel of selectors) {
      try {
        const el = base.querySelector(sel)
        if (el) return el
      } catch (_) {
        /* selector unsupported — try the next */
      }
    }
    return null
  }

  async function waitFor(fn, timeoutMs, intervalMs) {
    const end = Date.now() + timeoutMs
    for (;;) {
      const v = fn()
      if (v) return v
      if (Date.now() >= end) return null
      await sleep(intervalMs || 200)
    }
  }

  // ---------------------------------------------------------------- safety
  const SEND_RE = /send|إرسال|ارسال|envoyer|enviar/i

  /** True when the element, an ancestor or a descendant looks like a Send control. */
  function looksLikeSend(el) {
    if (!el) return false
    for (let n = el; n && n.nodeType === 1 && n !== doc().body; n = n.parentElement) {
      for (const attr of ['aria-label', 'data-icon', 'title', 'data-testid']) {
        const v = n.getAttribute(attr)
        if (v && SEND_RE.test(v)) return true
      }
    }
    return !!(el.querySelector && el.querySelector('[data-icon*="send"], [aria-label*="Send"], [aria-label*="إرسال"]'))
  }

  /** The only click this script ever performs. */
  function safeClick(el) {
    if (!el) throw new Error('Nothing to click')
    if (looksLikeSend(el)) throw new Error('Refusing to click a control that looks like Send')
    el.click()
  }

  // ---------------------------------------------------------------- file
  function base64ToFile(b64, name, type) {
    const bin = root.atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new root.File([bytes], name, { type })
  }

  function makeDataTransfer(file) {
    const dt = new root.DataTransfer()
    dt.items.add(file)
    return dt
  }

  function withData(ev, prop, dt) {
    if (!ev[prop]) Object.defineProperty(ev, prop, { value: dt })
    return ev
  }

  // ---------------------------------------------------------------- page state
  const isLoggedIn = () => !!q(S.appReady)
  const isLoginScreen = () => !isLoggedIn() && !!q(S.loginScreen)
  const chatComposer = () => q(S.chatComposer)

  function chatTitle() {
    const el = q(S.chatTitle)
    if (!el) return ''
    return (el.getAttribute('title') || el.textContent || '').trim()
  }

  /**
   * WhatsApp's attachment preview is open: a Send control outside the chat
   * footer, or the chat composer has been replaced by the preview. Either
   * signal stops further attach attempts, so the PDF is never attached twice.
   */
  function previewOpen() {
    const all = doc().querySelectorAll(S.previewSendButton.join(','))
    for (const el of all) if (!el.closest('#main footer')) return true
    return !chatComposer()
  }

  /** The caption editor in the preview: an editable that is not the chat composer or the chat list. */
  function findCaptionBox() {
    const all = Array.from(doc().querySelectorAll('div[contenteditable="true"]'))
    const candidates = all.filter((el) => !el.closest('#main footer') && !el.closest('#side') && !el.closest('#pane-side'))
    return candidates.length ? candidates[candidates.length - 1] : null
  }

  // ---------------------------------------------------------------- attach strategies
  function attachByPaste(file) {
    const target = chatComposer()
    if (!target) return false
    target.focus()
    const dt = makeDataTransfer(file)
    let ev
    try {
      ev = new root.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    } catch (_) {
      ev = new root.Event('paste', { bubbles: true, cancelable: true })
    }
    target.dispatchEvent(withData(ev, 'clipboardData', dt))
    return true
  }

  function attachByDrop(file) {
    const target = q(S.chatPanel)
    if (!target) return false
    const dt = makeDataTransfer(file)
    for (const type of ['dragenter', 'dragover', 'drop']) {
      let ev
      try {
        ev = new root.DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })
      } catch (_) {
        ev = new root.Event(type, { bubbles: true, cancelable: true })
      }
      target.dispatchEvent(withData(ev, 'dataTransfer', dt))
    }
    return true
  }

  async function attachByFileInput(file) {
    const icon = q(S.attachButton)
    if (!icon) return false
    safeClick(icon.closest('button, [role="button"]') || icon)
    const input = await waitFor(() => q(S.documentFileInput), 3000)
    if (!input) return false
    input.files = makeDataTransfer(file).files
    input.dispatchEvent(new root.Event('change', { bubbles: true }))
    return true
  }

  // ---------------------------------------------------------------- caption
  function placeCaretAtEnd(el) {
    const sel = root.getSelection && root.getSelection()
    if (!sel || !doc().createRange) return
    const range = doc().createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  async function insertCaption(text) {
    if (!text) return true
    const box = await waitFor(findCaptionBox, 4000)
    if (!box) return false
    box.focus()
    placeCaretAtEnd(box)
    try {
      doc().execCommand('insertText', false, text)
    } catch (_) {
      /* checked below */
    }
    await sleep(150)
    const probe = text.slice(0, Math.min(20, text.length))
    return (box.textContent || '').indexOf(probe) !== -1
  }

  // ---------------------------------------------------------------- workflow
  /**
   * Runs one job. `report(update)` sends progress to the background worker.
   * Resolves with the final update ({status: 'ready'|'error', ...}).
   */
  async function runJob(job, report, overrides) {
    const T = Object.assign(
      {
        load: CONFIG.WA_LOAD_TIMEOUT_MS,
        login: CONFIG.WA_LOGIN_TIMEOUT_MS,
        attach: CONFIG.ATTACH_TIMEOUT_MS,
        chat: 30000,
        modalGrace: 6000,
        // Let the freshly opened chat finish wiring its composer before attaching.
        settle: 800,
      },
      overrides || {},
    )
    const finish = (update) => {
      report(update)
      return update
    }
    const error = (code, message) => finish({ status: STATUS.ERROR, code, message })

    try {
      // 1. Logged in?
      let state = await waitFor(() => (isLoggedIn() ? 'app' : isLoginScreen() ? 'login' : null), T.load)
      if (!state) return error(ERRORS.WHATSAPP_TIMEOUT, 'WhatsApp Web did not finish loading.')
      if (state === 'login') {
        report({ status: STATUS.WAITING_LOGIN })
        state = await waitFor(() => (isLoggedIn() ? 'app' : null), T.login)
        if (!state) return error(ERRORS.NOT_LOGGED_IN, 'WhatsApp Web is not logged in. Scan the QR code, then try again.')
      }

      // 2. Chat for this number open? (A lingering popup instead = number not on WhatsApp.)
      let modalSince = 0
      const chat = await waitFor(() => {
        if (chatComposer()) return { ok: true }
        const modal = q(S.modalDialog)
        if (modal) {
          modalSince = modalSince || Date.now()
          if (Date.now() - modalSince >= T.modalGrace) return { ok: false, text: (modal.textContent || '').trim() }
        } else {
          modalSince = 0
        }
        return null
      }, T.chat)
      if (!chat || !chat.ok) {
        const detail = chat && chat.text ? ' WhatsApp says: "' + chat.text.slice(0, 160) + '"' : ''
        return error(ERRORS.CHAT_UNAVAILABLE, 'Could not open the chat for +' + job.phoneDigits + '. The number may not be on WhatsApp.' + detail)
      }
      const title = chatTitle()
      report({ status: STATUS.CHAT_OPEN, chatTitle: title })

      // 3. Attach.
      report({ status: STATUS.ATTACHING })
      if (T.settle > 0) await sleep(T.settle)
      const file = base64ToFile(job.pdfBase64, job.fileName, job.mimeType)
      let attached = false
      for (const strategy of [attachByPaste, attachByDrop, attachByFileInput]) {
        let started = false
        try {
          started = await strategy(file)
        } catch (_) {
          started = false
        }
        if (started && (await waitFor(previewOpen, T.attach))) {
          attached = true
          break
        }
      }
      if (!attached) {
        return error(ERRORS.ATTACH_FAILED, 'The chat is open but WhatsApp did not accept the PDF. Attach it manually (it was not sent).')
      }
      const baseName = job.fileName.replace(/\.pdf$/i, '')
      const pageText = doc().body ? doc().body.textContent || '' : ''
      const attachmentVerified = pageText.indexOf(baseName) !== -1

      // 4. Caption.
      let captionInserted = await insertCaption(job.message)
      if (!captionInserted && job.message && root.navigator && root.navigator.clipboard) {
        try {
          await root.navigator.clipboard.writeText(job.message)
        } catch (_) {
          /* clipboard blocked — the app shows the message to copy */
        }
      }

      // 5. Stop. The user presses Send.
      return finish({ status: STATUS.READY, chatTitle: title, captionInserted, attachmentVerified })
    } catch (e) {
      return error(ERRORS.INTERNAL, 'Unexpected error in WhatsApp Web: ' + (e && e.message ? e.message : String(e)))
    }
  }

  root.__farahWaContent = { runJob, looksLikeSend, safeClick, base64ToFile, findCaptionBox, previewOpen }

  // ---------------------------------------------------------------- bootstrap
  if (root.__FARAH_WA_TEST__ || root.__farahWaContentStarted) return
  root.__farahWaContentStarted = true
  const chromeApi = root.chrome
  if (!chromeApi || !chromeApi.runtime || !chromeApi.runtime.id) return

  chromeApi.runtime
    .sendMessage({ type: 'wa:hello' })
    .then((res) => {
      if (!res || !res.job) return
      const job = res.job
      const report = (update) => {
        try {
          const p = chromeApi.runtime.sendMessage(Object.assign({ type: 'wa:status', requestId: job.requestId }, update))
          if (p && p.catch) p.catch(() => {})
        } catch (_) {
          /* extension reloaded */
        }
      }
      return runJob(job, report)
    })
    .catch(() => {
      /* extension not reachable — nothing to do */
    })
})(typeof globalThis !== 'undefined' ? globalThis : self)
