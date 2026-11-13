// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://localhost:5173/clients/1"}
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeChrome, loadScripts, REQUEST_ID, shareRequest } from './load'

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any
let fc: ReturnType<typeof fakeChrome>
let backgroundReply: any = { ok: true }

/** Messages the bridge posts back to the page. */
function pageInbox() {
  const inbox: any[] = []
  window.addEventListener('message', (e) => {
    if (e.data?.channel === 'farah-wa' && e.data.dir === 'to-page') inbox.push(e.data)
  })
  return inbox
}

function fromPage(data: any, origin = 'http://localhost:5173', source: any = window) {
  window.dispatchEvent(new MessageEvent('message', { data: { channel: 'farah-wa', dir: 'to-extension', ...data }, origin, source }))
}

const tick = () => new Promise((r) => setTimeout(r, 20))

describe('app-bridge content script', () => {
  let inbox: any[]

  beforeAll(() => {
    fc = fakeChrome(vi)
    fc.chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: (r: any) => void) => cb(backgroundReply))
    g.chrome = fc.chrome
    loadScripts('config.js', 'protocol.js', 'app-bridge.js')
    inbox = pageInbox()
  })

  beforeEach(() => {
    inbox.length = 0
    backgroundReply = { ok: true }
    fc.chrome.runtime.sendMessage.mockClear()
    fc.chrome.runtime.lastError = undefined
  })

  it('marks the page so the app can detect the extension', () => {
    expect(document.documentElement.getAttribute('data-farah-wa-extension')).toBe('1.0.0')
  })

  it('answers a ping', async () => {
    backgroundReply = { ok: true, version: '1.0.0' }
    fromPage({ type: 'ping', id: 'p1' })
    await tick()
    expect(inbox).toEqual([expect.objectContaining({ type: 'pong', id: 'p1', ok: true, version: '1.0.0' })])
  })

  it('forwards a valid share to the background worker and confirms it', async () => {
    fromPage({ type: 'share', id: 's1', request: shareRequest() })
    await tick()
    expect(fc.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'share', request: expect.objectContaining({ requestId: REQUEST_ID, phoneDigits: '96171960117' }) },
      expect.any(Function),
    )
    expect(inbox).toEqual([
      expect.objectContaining({ type: 'share-result', id: 's1', ok: true }),
      expect.objectContaining({ type: 'status', requestId: REQUEST_ID, status: 'accepted' }),
    ])
  })

  it('rejects an invalid share without bothering the background worker', async () => {
    fromPage({ type: 'share', id: 's2', request: shareRequest({ phoneDigits: 'abc' }) })
    await tick()
    expect(fc.chrome.runtime.sendMessage).not.toHaveBeenCalled()
    expect(inbox).toEqual([expect.objectContaining({ type: 'share-result', id: 's2', ok: false, code: 'BAD_REQUEST' })])
  })

  it('ignores messages from another origin or another window', async () => {
    fromPage({ type: 'share', id: 's3', request: shareRequest() }, 'https://evil.example')
    fromPage({ type: 'share', id: 's4', request: shareRequest() }, 'http://localhost:5173', null)
    await tick()
    expect(fc.chrome.runtime.sendMessage).not.toHaveBeenCalled()
    expect(inbox).toEqual([])
  })

  it('reports EXTENSION_DISCONNECTED when the extension was reloaded', async () => {
    fc.chrome.runtime.sendMessage.mockImplementationOnce(() => { throw new Error('Extension context invalidated.') })
    fromPage({ type: 'share', id: 's5', request: shareRequest() })
    await tick()
    expect(inbox[0]).toMatchObject({ type: 'share-result', ok: false, code: 'EXTENSION_DISCONNECTED' })
  })

  it('relays progress from the background worker, but not from a tab pretending to be it', async () => {
    const listener = fc.listeners[0]
    listener({ type: 'status', requestId: REQUEST_ID, status: 'ready', captionInserted: true, extra: 'dropped' }, { id: 'farah-ext-id' }, () => {})
    listener({ type: 'status', requestId: REQUEST_ID, status: 'ready' }, { id: 'farah-ext-id', tab: { id: 3 } }, () => {})
    listener({ type: 'status', requestId: REQUEST_ID, status: 'ready' }, { id: 'other-ext' }, () => {})
    await tick()
    expect(inbox).toEqual([{ channel: 'farah-wa', dir: 'to-page', type: 'status', requestId: REQUEST_ID, status: 'ready', captionInserted: true }])
  })
})
