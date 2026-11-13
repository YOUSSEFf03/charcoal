import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const EXT_DIR = resolve(__dirname, '..')

/** Source text of an extension script. */
export function source(file: string): string {
  return readFileSync(resolve(EXT_DIR, file), 'utf8')
}

/** Runs extension scripts in the global scope, in order — the way Chrome loads content scripts. */
export function loadScripts(...files: string[]): void {
  for (const f of files) (0, eval)(source(f))
}

/** A minimal PDF, base64 encoded (starts with "%PDF-"). */
export const PDF_BASE64 = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64')

export const REQUEST_ID = '0b9c8f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f'

export function shareRequest(over: Record<string, unknown> = {}) {
  return {
    requestId: REQUEST_ID,
    phoneDigits: '96171960117',
    fileName: 'Invoice INV-1025.pdf',
    mimeType: 'application/pdf',
    pdfBase64: PDF_BASE64,
    message: 'Hello Restaurant ABC, please find attached your invoice #1025.',
    ...over,
  }
}

/** Fake chrome.* API with in-memory session storage and spy-able tab calls. */
export function fakeChrome(vi: typeof import('vitest').vi) {
  const session = new Map<string, unknown>()
  const listeners: Array<(msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown> = []
  const removedListeners: Array<(tabId: number) => void> = []
  const chrome = {
    runtime: {
      id: 'farah-ext-id',
      lastError: undefined as undefined | { message: string },
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn((fn) => listeners.push(fn)) },
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => (session.has(key) ? { [key]: session.get(key) } : {})),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) session.set(k, JSON.parse(JSON.stringify(v)))
        }),
        remove: vi.fn(async (key: string) => {
          session.delete(key)
        }),
      },
    },
    tabs: {
      query: vi.fn(async () => [] as Array<{ id: number; windowId: number }>),
      create: vi.fn(async ({ url }: { url: string }) => ({ id: 77, windowId: 1, url })),
      update: vi.fn(async (id: number, { url }: { url: string }) => ({ id, windowId: 2, url })),
      sendMessage: vi.fn(async () => undefined),
      onRemoved: { addListener: vi.fn((fn) => removedListeners.push(fn)) },
    },
    windows: { update: vi.fn(async () => undefined) },
  }
  return { chrome, session, listeners, removedListeners }
}
