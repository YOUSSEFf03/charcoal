/**
 * RFC 4122 v4 UUID that also works outside a secure context.
 *
 * `crypto.randomUUID()` only exists on HTTPS or localhost pages. The app is
 * served over plain HTTP on the Tailscale IP, where calling it throws
 * "crypto.randomUUID is not a function" and crashes the page.
 * `crypto.getRandomValues()` is available in every context, so fall back to it.
 */
export function randomUUID(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()

  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
