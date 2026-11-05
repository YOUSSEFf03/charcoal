// Structured reading of a Statement of Account row description. Pure.
//
// The backend ledger (ReportsService.buildInvoiceDescription /
// buildPaymentDescription) sends ONE joined string per entry, e.g.
//   "Order Sale · 500.000 kg BBQ Hardwood Grade A · 10 × 10kg Bag - Hamra"
//   "Cash Payment"
// and deliberately keeps the entry shape fixed (no extra fields). Documents
// that want labelled lines (the Arabic statement) parse that known format
// here. Anything that does not match exactly returns null, and the caller
// shows the original string unchanged — nothing is ever guessed or invented.

export interface SaleItem {
  unit: 'KG' | 'BAG'
  /** Quantity as sent ("500.000", "10"). */
  quantity: string
  /** Product (KG line: the line description; BAG line: the bag type name). May be empty. */
  product: string
}

export type PaymentMethod = 'cash' | 'whish' | 'omt' | 'bank_transfer' | 'cheque' | 'other'

export type ParsedDescription =
  | { kind: 'sale'; source: 'order' | 'warehouse'; items: SaleItem[]; location: string | null }
  | { kind: 'payment'; method: PaymentMethod }
  | { kind: 'carried_forward'; notes: string | null }

// Mirrors buildPaymentDescription()'s map exactly.
const PAYMENT_LABELS: Record<string, PaymentMethod> = {
  'Cash Payment': 'cash',
  Whish: 'whish',
  OMT: 'omt',
  'Bank Transfer': 'bank_transfer',
  'Cheque Payment': 'cheque',
  Payment: 'other',
}

const SALE_PREFIXES: Array<[string, 'order' | 'warehouse']> = [
  ['Order Sale', 'order'],
  ['Warehouse Sale', 'warehouse'],
]

const CARRIED_FORWARD = 'Opening balance (carried forward)'

function parseItem(raw: string): SaleItem | null {
  const s = raw.trim()
  // KG line: "<kgQuantity> kg <description>"
  const kg = /^(\d+(?:\.\d+)?) kg(?: (.*))?$/.exec(s)
  if (kg) return { unit: 'KG', quantity: kg[1], product: (kg[2] ?? '').trim() }
  // BAG line: "<qty> × <bagTypeName>"
  const bag = /^(\d+) × ?(.*)$/.exec(s)
  if (bag) return { unit: 'BAG', quantity: bag[1], product: bag[2].trim() }
  return null
}

/**
 * Parses a backend ledger description. `knownLocations` are the client's
 * real location names: the backend appends " - <location>" to a sale, and the
 * suffix is only split off when it matches one of these exactly (a product
 * name may itself contain " - ").
 */
export function parseStatementDescription(desc: string, knownLocations: string[] = []): ParsedDescription | null {
  const text = desc.trim()

  const method = PAYMENT_LABELS[text]
  if (method) return { kind: 'payment', method }

  if (text === CARRIED_FORWARD) return { kind: 'carried_forward', notes: null }
  if (text.startsWith(`${CARRIED_FORWARD} · `)) {
    return { kind: 'carried_forward', notes: text.slice(CARRIED_FORWARD.length + 3).trim() || null }
  }

  for (const [prefix, source] of SALE_PREFIXES) {
    if (text !== prefix && !text.startsWith(`${prefix} `)) continue
    let rest = text.slice(prefix.length)

    let location: string | null = null
    const names = [...knownLocations].filter((n) => n.trim()).sort((a, b) => b.length - a.length)
    for (const name of names) {
      if (rest.endsWith(` - ${name}`)) {
        location = name
        rest = rest.slice(0, rest.length - name.length - 3)
        break
      }
    }

    if (rest === '') return { kind: 'sale', source, items: [], location }
    if (!rest.startsWith(' · ')) return null
    const items: SaleItem[] = []
    for (const part of rest.slice(3).split(' · ')) {
      const item = parseItem(part)
      if (!item) return null
      items.push(item)
    }
    return { kind: 'sale', source, items, location }
  }
  return null
}

/** "500.000" → "500", "12.500" → "12.5", "10" → "10". Display only. */
export function trimQuantity(q: string): string {
  if (!/^\d+\.\d+$/.test(q)) return q
  return q.replace(/0+$/, '').replace(/\.$/, '')
}
