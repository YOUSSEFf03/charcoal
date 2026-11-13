// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://localhost:5173/invoices/1"}
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({ api: { post: vi.fn() } }))
import { api } from '../api'
import { shareDocumentViaWhatsApp, toSingleLineCaption } from './whatsappShare'
import { WhatsAppShareError } from './whatsappExtension'

/* eslint-disable @typescript-eslint/no-explicit-any */
const post = api.post as unknown as ReturnType<typeof vi.fn>
const SHARE_ID = '0b9c8f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f'
const INVOICE = '33333333-3333-4333-8333-333333333333'
const CLIENT = '11111111-1111-4111-8111-111111111111'

/** What the fake background worker does with the next share. */
let background: {
  installed: boolean
  shareReply: any
  statuses: any[]
  received: any[]
}
let toBridge: (msg: any) => void

const pdf = () => new File(['%PDF-1.4\n%%EOF\n'], 'Invoice INV-1025.pdf', { type: 'application/pdf' })

beforeAll(() => {
  // jsdom's postMessage sets neither `source` nor `origin` (browsers do), and
  // both sides of the bridge rightly reject such messages — emulate Chrome.
  window.postMessage = ((data: unknown) => {
    setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window })))
  }) as typeof window.postMessage
  // Load the REAL extension bridge into this page, with a fake background worker behind it.
  const listeners: any[] = []
  ;(globalThis as any).chrome = {
    runtime: {
      id: 'ext',
      lastError: undefined,
      onMessage: { addListener: (fn: any) => listeners.push(fn) },
      sendMessage: (msg: any, cb: (r: any) => void) => {
        if (msg.type === 'ping') return cb(background.installed ? { ok: true, version: '1.0.0' } : { ok: false })
        background.received.push(msg.request)
        cb(background.shareReply)
        if (background.shareReply.ok) {
          background.statuses.forEach((s, i) => setTimeout(() => toBridge({ type: 'status', requestId: msg.request.requestId, ...s }), 5 * (i + 1)))
        }
      },
    },
  }
  toBridge = (msg) => listeners.forEach((fn) => fn(msg, { id: 'ext' }, () => {}))
  const dir = resolve(__dirname, '../../../apps/whatsapp-extension')
  for (const f of ['config.js', 'protocol.js', 'app-bridge.js']) (0, eval)(readFileSync(resolve(dir, f), 'utf8'))
})

beforeEach(() => {
  post.mockReset()
  post.mockImplementation(async (url: string) =>
    url === '/whatsapp-shares'
      ? { data: { shareId: SHARE_ID, phoneDigits: '96171960117', phoneMatchesSaved: true, preparedAt: '', expiresAt: '' } }
      : { data: undefined },
  )
  background = {
    installed: true,
    shareReply: { ok: true },
    statuses: [
      { status: 'opening_whatsapp' },
      { status: 'chat_open', chatTitle: 'Bendy' },
      { status: 'attaching' },
      { status: 'ready', chatTitle: 'Bendy', captionInserted: true, attachmentVerified: true },
    ],
    received: [],
  }
})

const input = (over: Record<string, unknown> = {}) => ({
  documentType: 'invoice' as const,
  documentId: INVOICE,
  customerId: CLIENT,
  phoneNumber: '71 960 117',
  message: 'Hello Bendy,\nplease find attached your invoice INV-1025.',
  getFile: pdf,
  ...over,
})

describe('shareDocumentViaWhatsApp', () => {
  it('authorizes on the server, hands the PDF to the extension, and stops at "ready" (not sent)', async () => {
    const progress: string[] = []
    const res = await shareDocumentViaWhatsApp(input(), (p) => progress.push(p.status))

    expect(post).toHaveBeenNthCalledWith(1, '/whatsapp-shares', {
      documentType: 'invoice', documentId: INVOICE, customerId: CLIENT, phoneNumber: '71 960 117',
    })
    // The extension gets the SERVER-normalized number, a single-line caption and the real PDF bytes.
    expect(background.received).toHaveLength(1)
    const req = background.received[0]
    expect(req).toMatchObject({
      requestId: SHARE_ID,
      phoneDigits: '96171960117',
      fileName: 'Invoice INV-1025.pdf',
      mimeType: 'application/pdf',
      message: 'Hello Bendy, please find attached your invoice INV-1025.',
    })
    expect(atob(req.pdfBase64)).toBe('%PDF-1.4\n%%EOF\n')

    expect(progress).toEqual([
      'checking_extension', 'authorizing', 'building_pdf', 'sending_to_extension',
      'accepted', 'opening_whatsapp', 'chat_open', 'attaching', 'ready',
    ])
    expect(res).toEqual({ shareId: SHARE_ID, phoneDigits: '96171960117', chatTitle: 'Bendy', captionInserted: true, attachmentVerified: true })
    // Logged as prepared for MANUAL send — never as sent.
    expect(post).toHaveBeenLastCalledWith(`/whatsapp-shares/${SHARE_ID}/outcome`, { outcome: 'ready_for_manual_send' })
  })

  it('fails with EXTENSION_NOT_FOUND before calling the server when the extension is missing', async () => {
    background.installed = false
    await expect(shareDocumentViaWhatsApp(input())).rejects.toMatchObject({ code: 'EXTENSION_NOT_FOUND' })
    expect(post).not.toHaveBeenCalled()
  })

  it('passes the server\'s INVALID_PHONE through and never contacts WhatsApp', async () => {
    post.mockRejectedValueOnce({ status: 422, error: 'Invalid WhatsApp phone number', code: 'INVALID_PHONE' })
    await expect(shareDocumentViaWhatsApp(input({ phoneNumber: '12' }))).rejects.toMatchObject({ code: 'INVALID_PHONE' })
    expect(background.received).toHaveLength(0)
  })

  it('reports a document the user may not share as SERVER_REJECTED with the server message', async () => {
    post.mockRejectedValueOnce({ status: 404, error: 'Document not found for this customer', code: 'NOT_FOUND' })
    await expect(shareDocumentViaWhatsApp(input())).rejects.toMatchObject({ code: 'SERVER_REJECTED', message: 'Document not found for this customer' })
  })

  it('surfaces extension errors (ATTACH_FAILED) and logs the outcome as failed', async () => {
    background.statuses = [{ status: 'chat_open', chatTitle: 'Bendy' }, { status: 'error', code: 'ATTACH_FAILED', message: 'nope' }]
    const err = await shareDocumentViaWhatsApp(input()).catch((e) => e)
    expect(err).toBeInstanceOf(WhatsAppShareError)
    expect(err.code).toBe('ATTACH_FAILED')
    expect(post).toHaveBeenLastCalledWith(`/whatsapp-shares/${SHARE_ID}/outcome`, { outcome: 'failed', errorCode: 'ATTACH_FAILED' })
  })

  it('reports BUSY when another document is still being prepared', async () => {
    background.shareReply = { ok: false, code: 'BUSY', message: 'busy' }
    await expect(shareDocumentViaWhatsApp(input())).rejects.toMatchObject({ code: 'BUSY' })
  })

  it('reports PDF_FAILED when the PDF cannot be generated', async () => {
    await expect(shareDocumentViaWhatsApp(input({ getFile: () => { throw new Error('canvas blew up') } })))
      .rejects.toMatchObject({ code: 'PDF_FAILED' })
    expect(background.received).toHaveLength(0)
    expect(post).toHaveBeenLastCalledWith(`/whatsapp-shares/${SHARE_ID}/outcome`, { outcome: 'failed', errorCode: 'PDF_FAILED' })
  })

  it('rejects PDFs over 6 MB with FILE_TOO_LARGE', async () => {
    const big = new File([new Uint8Array(6 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' })
    await expect(shareDocumentViaWhatsApp(input({ getFile: () => big }))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  })
})

describe('toSingleLineCaption', () => {
  it('collapses line breaks (an Enter in WhatsApp would send)', () => {
    expect(toSingleLineCaption('  Hello,\r\n\n  see attached.  ')).toBe('Hello, see attached.')
  })
})
