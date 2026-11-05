// Address resolution for printed/PDF documents. Pure — no React, no DOM.
//
// A client with multiple locations usually keeps its addresses on the
// locations (ClientLocation.address) and leaves Client.address empty, so
// documents must look there before falling back to "—".

/** Trimmed text, or null when absent/blank. */
function clean(v: string | null | undefined): string | null {
  const s = v?.trim()
  return s ? s : null
}

/** First non-blank value, or null. */
export function firstAddress(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const v = clean(c)
    if (v) return v
  }
  return null
}

export interface AddressedLocation {
  name: string
  address?: string | null
  isActive?: boolean
}

/** "Hamra Branch – Bliss St" (or just the address / name when the other is missing). */
export function formatLocationAddress(loc: AddressedLocation): string | null {
  const name = clean(loc.name)
  const address = clean(loc.address)
  if (name && address) return `${name} – ${address}`
  return address ?? name
}

/**
 * The address block for a client-level document (statement of account).
 * Single-location client → its own address. Multi-location client → its own
 * address (if any) followed by one line per ACTIVE location that has an
 * address, de-duplicated. Returns null when nothing is known (caller shows "—").
 * Lines are joined with "\n".
 */
export function clientDocumentAddress(
  clientAddress: string | null | undefined,
  locations: AddressedLocation[] = [],
  multiLocationEnabled = false,
): string | null {
  const own = clean(clientAddress)
  if (!multiLocationEnabled) return own
  const lines: string[] = own ? [own] : []
  for (const loc of locations) {
    if (loc.isActive === false || !clean(loc.address)) continue
    const line = formatLocationAddress(loc)
    if (line && !lines.includes(line) && line !== own) lines.push(line)
  }
  return lines.length ? lines.join('\n') : null
}
