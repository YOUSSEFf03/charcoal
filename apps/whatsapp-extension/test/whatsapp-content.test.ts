// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadScripts, shareRequest, source } from './load'

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any

/** jsdom has no DataTransfer — a minimal stand-in. */
class FakeDataTransfer {
  files: File[] = []
  items = { add: (f: File) => { this.files.push(f) } }
}

type Mode = { paste?: boolean; drop?: boolean; fileInput?: boolean }

/**
 * A fake WhatsApp Web. Opening a document (by paste, drop or the Attach
 * menu's file input) shows a preview with a caption box and a Send button.
 * Records anything that would SEND.
 */
function fakeWhatsApp(opts: { mode?: Mode; loggedIn?: boolean; chat?: boolean; title?: string } = {}) {
  const mode = { paste: true, drop: true, fileInput: true, ...opts.mode }
  const state = { sent: false, keyEvents: 0, attachedFiles: [] as File[] }
  document.body.innerHTML = ''
  const app = document.createElement('div')
  app.id = 'app'
  document.body.appendChild(app)

  const renderApp = () => {
    app.innerHTML = '<div id="side"></div>'
    if (opts.chat === false) return
    const main = document.createElement('div')
    main.id = 'main'
    main.innerHTML =
      `<header><span title="${opts.title ?? 'Bendy'}">${opts.title ?? 'Bendy'}</span></header>` +
      '<footer><div contenteditable="true" data-tab="10" tabindex="0"></div>' +
      '<button type="button" title="Attach"><span data-icon="plus-rounded"></span></button></footer>'
    app.appendChild(main)

    const showPreview = (files: File[]) => {
      state.attachedFiles.push(...files)
      main.querySelector('footer')!.remove()
      const preview = document.createElement('div')
      preview.id = 'preview'
      preview.innerHTML =
        `<div class="doc-name">${files[0].name}</div>` +
        '<div contenteditable="true" class="caption" tabindex="0"></div>' +
        '<div role="button" aria-label="Send"><span data-icon="send"></span></div>'
      preview.querySelector('[aria-label="Send"]')!.addEventListener('click', () => { state.sent = true })
      app.appendChild(preview)
    }

    const composer = main.querySelector('footer [contenteditable]')!
    composer.addEventListener('paste', (e: any) => {
      if (mode.paste && e.clipboardData?.files?.length) showPreview(Array.from(e.clipboardData.files))
    })
    main.addEventListener('drop', (e: any) => {
      if (mode.drop && e.dataTransfer?.files?.length && main.querySelector('footer')) showPreview(Array.from(e.dataTransfer.files))
    })
    main.querySelector('button[title="Attach"]')!.addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '*'
      let files: File[] = []
      Object.defineProperty(input, 'files', { get: () => files, set: (v) => { files = Array.from(v) }, configurable: true })
      input.addEventListener('change', () => { if (mode.fileInput && files.length) showPreview(files) })
      app.appendChild(input)
    })
  }

  if (opts.loggedIn === false) {
    app.innerHTML = '<div data-ref="qr"><canvas aria-label="Scan this QR code"></canvas></div>'
  } else {
    renderApp()
  }

  for (const type of ['keydown', 'keypress', 'keyup']) {
    document.addEventListener(type, () => { state.keyEvents++ }, true)
  }
  return { state, logIn: renderApp }
}

const FAST = { load: 300, login: 300, attach: 200, chat: 400, modalGrace: 100, settle: 0 }

describe('whatsapp-content runJob', () => {
  beforeAll(() => {
    g.__FARAH_WA_TEST__ = true
    g.DataTransfer = FakeDataTransfer
    // jsdom does not implement execCommand: emulate typing into the focused editor.
    document.execCommand = vi.fn((cmd: string, _ui?: boolean, text?: string) => {
      if (cmd !== 'insertText') return false
      const el = document.activeElement as HTMLElement | null
      if (!el || el.getAttribute('contenteditable') !== 'true') return false
      el.textContent = (el.textContent ?? '') + (text ?? '')
      return true
    }) as any
    loadScripts('config.js', 'protocol.js', 'whatsapp-content.js')
  })

  let reports: any[]
  const report = (u: any) => reports.push(u)
  const run = (over: Record<string, unknown> = {}, timeouts = FAST) => g.__farahWaContent.runJob(shareRequest(over), report, timeouts)

  beforeEach(() => { reports = [] })
  afterEach(() => { document.body.innerHTML = '' })

  it('attaches the PDF by paste, types the caption, and stops before Send', async () => {
    const wa = fakeWhatsApp()
    const res = await run()
    expect(res).toEqual({ status: 'ready', chatTitle: 'Bendy', captionInserted: true, attachmentVerified: true })
    expect(reports.map((r) => r.status)).toEqual(['chat_open', 'attaching', 'ready'])
    expect(wa.state.attachedFiles).toHaveLength(1)
    expect(wa.state.attachedFiles[0].name).toBe('Invoice INV-1025.pdf')
    expect(wa.state.attachedFiles[0].type).toBe('application/pdf')
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.readAsText(wa.state.attachedFiles[0])
    })
    expect(text).toMatch(/^%PDF-1\.4/)
    expect(document.querySelector('.caption')!.textContent).toBe('Hello Restaurant ABC, please find attached your invoice #1025.')
    // The final confirmation screen is left for the user.
    expect(document.querySelector('[aria-label="Send"]')).not.toBeNull()
    expect(wa.state.sent).toBe(false)
    expect(wa.state.keyEvents).toBe(0)
  })

  it('falls back to drag-and-drop when paste is ignored', async () => {
    const wa = fakeWhatsApp({ mode: { paste: false } })
    await expect(run()).resolves.toMatchObject({ status: 'ready' })
    expect(wa.state.attachedFiles).toHaveLength(1)
    expect(wa.state.sent).toBe(false)
  })

  it('falls back to the Attach menu file input, and never attaches twice', async () => {
    const wa = fakeWhatsApp({ mode: { paste: false, drop: false } })
    await expect(run()).resolves.toMatchObject({ status: 'ready', captionInserted: true })
    expect(wa.state.attachedFiles).toHaveLength(1)
    expect(wa.state.sent).toBe(false)
    expect(wa.state.keyEvents).toBe(0)
  })

  it('reports ATTACH_FAILED (and sends nothing) when WhatsApp accepts no method', async () => {
    const wa = fakeWhatsApp({ mode: { paste: false, drop: false, fileInput: false } })
    await expect(run()).resolves.toMatchObject({ status: 'error', code: 'ATTACH_FAILED' })
    expect(wa.state.sent).toBe(false)
  })

  it('waits for the QR-code login, then continues', async () => {
    const wa = fakeWhatsApp({ loggedIn: false })
    setTimeout(() => wa.logIn(), 100)
    await expect(run({}, { ...FAST, login: 2000 })).resolves.toMatchObject({ status: 'ready' })
    expect(reports[0]).toEqual({ status: 'waiting_login' })
  })

  it('reports NOT_LOGGED_IN when nobody scans the QR code', async () => {
    fakeWhatsApp({ loggedIn: false })
    await expect(run()).resolves.toMatchObject({ status: 'error', code: 'NOT_LOGGED_IN' })
  })

  it('reports WHATSAPP_TIMEOUT when WhatsApp Web never loads', async () => {
    document.body.innerHTML = '<div id="app">Loading…</div>'
    await expect(run()).resolves.toMatchObject({ status: 'error', code: 'WHATSAPP_TIMEOUT' })
  })

  it('reports CHAT_UNAVAILABLE with WhatsApp\'s own popup text for a number not on WhatsApp', async () => {
    fakeWhatsApp({ chat: false })
    const dlg = document.createElement('div')
    dlg.setAttribute('role', 'dialog')
    dlg.textContent = 'Phone number shared via url is invalid.'
    document.body.appendChild(dlg)
    const res = await run()
    expect(res).toMatchObject({ status: 'error', code: 'CHAT_UNAVAILABLE' })
    expect(res.message).toContain('Phone number shared via url is invalid.')
  })

  it('still finishes (captionInserted=false) when the caption cannot be typed', async () => {
    const wa = fakeWhatsApp()
    const orig = document.execCommand
    document.execCommand = vi.fn(() => false) as any
    try {
      await expect(run()).resolves.toMatchObject({ status: 'ready', captionInserted: false })
    } finally {
      document.execCommand = orig
    }
    expect(wa.state.sent).toBe(false)
  })

  it('skips the caption when the message is empty', async () => {
    fakeWhatsApp()
    await expect(run({ message: '' })).resolves.toMatchObject({ status: 'ready', captionInserted: true })
    expect(document.querySelector('.caption')!.textContent).toBe('')
  })
})

describe('never sends', () => {
  beforeAll(() => {
    g.__FARAH_WA_TEST__ = true
    loadScripts('config.js', 'protocol.js', 'whatsapp-content.js')
  })

  it('safeClick refuses anything that looks like a Send button (any language)', () => {
    document.body.innerHTML =
      '<div role="button" aria-label="Send" id="a"><span data-icon="send"></span></div>' +
      '<button id="b"><span data-icon="wds-ic-send-filled"></span></button>' +
      '<div role="button" aria-label="إرسال" id="c"></div>' +
      '<button title="Attach" id="ok"><span data-icon="plus-rounded"></span></button>'
    const clicked: string[] = []
    document.body.addEventListener('click', (e) => clicked.push((e.target as HTMLElement).id || 'child'))
    const { safeClick } = g.__farahWaContent
    for (const id of ['a', 'b', 'c']) expect(() => safeClick(document.getElementById(id))).toThrow(/Send/)
    expect(() => safeClick(document.querySelector('#a span'))).toThrow(/Send/)
    safeClick(document.getElementById('ok'))
    expect(clicked).toEqual(['ok'])
  })

  it('the source never creates keyboard events and calls .click() only inside safeClick', () => {
    const code = source('whatsapp-content.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/KeyboardEvent|keydown|keypress|keyup/)
    expect(code.match(/\.click\(\)/g)).toHaveLength(1)
    expect(code).toMatch(/if \(looksLikeSend\(el\)\) throw[^\n]*\n\s*el\.click\(\)/)
    // The chat URL never carries text, so WhatsApp has nothing to auto-send.
    expect(source('protocol.js')).not.toMatch(/[?&]text=/)
  })
})
