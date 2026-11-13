import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeChrome, loadScripts, REQUEST_ID, shareRequest } from './load'

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any

describe('protocol.validateShareRequest', () => {
  beforeAll(() => loadScripts('config.js', 'protocol.js'))

  it('accepts a valid request and returns a cleaned copy', () => {
    const res = g.FARAH_WA_PROTOCOL.validateShareRequest(shareRequest({ message: 'Line 1\nLine 2\r\n  end' }))
    expect(res.ok).toBe(true)
    // Line breaks are removed: an Enter in WhatsApp can SEND.
    expect(res.value.message).toBe('Line 1 Line 2 end')
  })

  it.each([
    ['requestId', { requestId: 'not-a-uuid' }],
    ['phone too short', { phoneDigits: '1234' }],
    ['phone with symbols', { phoneDigits: '+96171960117' }],
    ['not a pdf name', { fileName: 'invoice.exe' }],
    ['wrong mime', { mimeType: 'text/html' }],
    ['not base64', { pdfBase64: '%%%%' }],
    ['not a PDF payload', { pdfBase64: Buffer.from('<html>hi</html>!').toString('base64') }],
    ['message not string', { message: 42 }],
    ['message too long', { message: 'x'.repeat(1001) }],
  ])('rejects %s', (_name, over) => {
    expect(g.FARAH_WA_PROTOCOL.validateShareRequest(shareRequest(over)).ok).toBe(false)
  })

  it('rejects oversized PDFs with FILE_TOO_LARGE', () => {
    const big = 'JVBERi0' + 'A'.repeat(9 * 1024 * 1024) + '='
    const res = g.FARAH_WA_PROTOCOL.validateShareRequest(shareRequest({ pdfBase64: big }))
    expect(res).toMatchObject({ ok: false, code: 'FILE_TOO_LARGE' })
  })

  it('sanitizes file names (no path tricks)', () => {
    expect(g.FARAH_WA_PROTOCOL.sanitizeFileName('../../etc/Invoice:1.pdf')).toBe('.. .. etc Invoice 1.pdf')
  })

  it('only allows the configured app origins', () => {
    const P = g.FARAH_WA_PROTOCOL
    expect(P.isAllowedAppOrigin('http://100.121.85.63:5173')).toBe(true)
    expect(P.isAllowedAppOrigin('http://100.121.85.63:8080')).toBe(false)
    expect(P.isAllowedAppOrigin('https://evil.example')).toBe(false)
  })

  it('builds the WhatsApp chat URL without any text parameter', () => {
    expect(g.FARAH_WA_PROTOCOL.whatsappChatUrl('96171960117')).toBe('https://web.whatsapp.com/send?phone=96171960117')
  })
})

describe('background worker', () => {
  let fc: ReturnType<typeof fakeChrome>
  let bg: any
  const appSender = { id: 'farah-ext-id', origin: 'http://100.121.85.63:5173', tab: { id: 5 } }
  const waSender = (tabId = 77) => ({ id: 'farah-ext-id', origin: 'https://web.whatsapp.com', tab: { id: tabId } })

  beforeEach(() => {
    fc = fakeChrome(vi)
    g.chrome = fc.chrome
    g.importScripts = undefined
    loadScripts('config.js', 'protocol.js', 'background.js')
    bg = g.__farahWaBackground
  })

  const share = (req = shareRequest(), sender: any = appSender) => bg.handleMessage({ type: 'share', request: req }, sender)

  it('opens a new WhatsApp tab at /send?phone=… and tells the app', async () => {
    await expect(share()).resolves.toEqual({ ok: true })
    expect(fc.chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://web.whatsapp.com/send?phone=96171960117', active: true })
    expect(bg.getJob()).toMatchObject({ requestId: REQUEST_ID, appTabId: 5, waTabId: 77 })
    expect(fc.chrome.tabs.sendMessage).toHaveBeenCalledWith(5, { type: 'status', requestId: REQUEST_ID, status: 'opening_whatsapp' })
    expect(fc.session.get('job')).toMatchObject({ waTabId: 77 })
  })

  it('reuses an existing WhatsApp tab and focuses its window', async () => {
    fc.chrome.tabs.query.mockResolvedValue([{ id: 9, windowId: 3 }])
    await share()
    expect(fc.chrome.tabs.update).toHaveBeenCalledWith(9, { url: 'https://web.whatsapp.com/send?phone=96171960117', active: true })
    expect(fc.chrome.tabs.create).not.toHaveBeenCalled()
    expect(fc.chrome.windows.update).toHaveBeenCalled()
  })

  it('rejects requests from other origins or other extensions', async () => {
    await expect(share(shareRequest(), { ...appSender, origin: 'https://evil.example' })).resolves.toMatchObject({ ok: false })
    await expect(share(shareRequest(), { ...appSender, id: 'other-ext' })).resolves.toMatchObject({ ok: false })
    expect(fc.chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('rejects invalid requests', async () => {
    await expect(share(shareRequest({ mimeType: 'image/png' }))).resolves.toMatchObject({ ok: false, code: 'BAD_REQUEST' })
    expect(bg.getJob()).toBeNull()
  })

  it('refuses a second share while one is running (BUSY) but treats a repeat of the same request as a duplicate', async () => {
    await share()
    await expect(share()).resolves.toEqual({ ok: true, duplicate: true })
    await expect(share(shareRequest({ requestId: '11111111-1111-4111-8111-111111111111' }))).resolves.toMatchObject({ ok: false, code: 'BUSY' })
    expect(fc.chrome.tabs.create).toHaveBeenCalledTimes(1)
  })

  it('hands the job only to the WhatsApp tab it opened', async () => {
    await share()
    await expect(bg.handleMessage({ type: 'wa:hello' }, waSender(12))).resolves.toEqual({ job: null })
    await expect(bg.handleMessage({ type: 'wa:hello' }, { ...waSender(), origin: 'https://evil.example' })).resolves.toMatchObject({ ok: false })
    const res = await bg.handleMessage({ type: 'wa:hello' }, waSender())
    expect(res.job).toMatchObject({ requestId: REQUEST_ID, phoneDigits: '96171960117', fileName: 'Invoice INV-1025.pdf' })
    expect(res.job.pdfBase64).toMatch(/^JVBERi0/)
  })

  it('relays progress to the app and deletes the job (and the PDF) once ready', async () => {
    await share()
    await bg.handleMessage({ type: 'wa:status', requestId: REQUEST_ID, status: 'chat_open', chatTitle: 'Bendy' }, waSender())
    expect(fc.chrome.tabs.sendMessage).toHaveBeenLastCalledWith(5, { type: 'status', requestId: REQUEST_ID, status: 'chat_open', chatTitle: 'Bendy' })
    await bg.handleMessage({ type: 'wa:status', requestId: REQUEST_ID, status: 'ready', captionInserted: true, attachmentVerified: true }, waSender())
    expect(fc.chrome.tabs.sendMessage).toHaveBeenLastCalledWith(5, {
      type: 'status', requestId: REQUEST_ID, status: 'ready', captionInserted: true, attachmentVerified: true,
    })
    expect(bg.getJob()).toBeNull()
    expect(fc.session.has('job')).toBe(false)
  })

  it('ignores status messages from other tabs or for other requests', async () => {
    await share()
    fc.chrome.tabs.sendMessage.mockClear()
    await bg.handleMessage({ type: 'wa:status', requestId: REQUEST_ID, status: 'ready' }, waSender(12))
    await bg.handleMessage({ type: 'wa:status', requestId: '11111111-1111-4111-8111-111111111111', status: 'ready' }, waSender())
    await bg.handleMessage({ type: 'wa:status', requestId: REQUEST_ID, status: 'sent' }, waSender())
    expect(fc.chrome.tabs.sendMessage).not.toHaveBeenCalled()
    expect(bg.getJob()).not.toBeNull()
  })

  it('reports TAB_CLOSED when the WhatsApp tab is closed mid-way', async () => {
    await share()
    await bg.handleTabRemoved(77)
    expect(fc.chrome.tabs.sendMessage).toHaveBeenLastCalledWith(5, expect.objectContaining({ status: 'error', code: 'TAB_CLOSED' }))
    expect(bg.getJob()).toBeNull()
  })

  it('expires stale jobs (JOB_EXPIRED) so a new share can start', async () => {
    await share()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 7 * 60 * 1000)
    await expect(share(shareRequest({ requestId: '11111111-1111-4111-8111-111111111111' }))).resolves.toEqual({ ok: true })
    expect(fc.chrome.tabs.sendMessage).toHaveBeenCalledWith(5, expect.objectContaining({ code: 'JOB_EXPIRED' }))
    vi.restoreAllMocks()
  })

  it('recovers the job from session storage after the service worker restarts', async () => {
    await share()
    bg.reset() // simulates the worker being suspended: memory gone, storage.session kept
    const res = await bg.handleMessage({ type: 'wa:hello' }, waSender())
    expect(res.job).toMatchObject({ requestId: REQUEST_ID })
  })

  it('reports an error to the app if WhatsApp Web cannot be opened', async () => {
    fc.chrome.tabs.create.mockRejectedValue(new Error('No window'))
    await expect(share()).resolves.toMatchObject({ ok: false, code: 'INTERNAL' })
    expect(bg.getJob()).toBeNull()
  })
})
