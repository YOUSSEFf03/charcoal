// Pure display helpers for the printable invoice (InvoiceDocument). They only
// reformat values already on the invoice — nothing is calculated or invented,
// so the printed totals are exactly the server's total / paidAmount / balanceDue.

import type { DocLang } from './i18n/docLang'
import { unitLabel } from './i18n/docFormat'
import { trimQuantity } from './statementDescription'
import type { InvoiceLineItem } from './types'

export interface InvoiceLineView {
  /** Product as stored on the line (KG description snapshot or bag type name). */
  product: string
  /** Quantity with its unit, e.g. "500 كغ" / "14 كيس". */
  quantity: string
  /** Unit price, 2 decimals (no currency); null when the line has none (left out, never "NaN"). */
  unitPrice: string | null
  /** Line total, 2 decimals (no currency). */
  total: string
}

const money2 = (n: string | number) => Number(n).toFixed(2)
const optMoney2 = (n: string | number | null | undefined) =>
  n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? null : money2(n)

/** One invoice line split into labelled parts for the structured Arabic layout. */
export function invoiceLineView(lang: DocLang, line: InvoiceLineItem): InvoiceLineView {
  if (line.saleUnit === 'KG') {
    return {
      product: line.description,
      quantity: `${trimQuantity(line.kgQuantity)} ${unitLabel(lang, 'KG')}`,
      unitPrice: optMoney2(line.pricePerKg),
      total: money2(line.lineTotal),
    }
  }
  return {
    product: line.bagTypeName,
    quantity: `${line.qty} ${unitLabel(lang, 'BAG')}`,
    unitPrice: optMoney2(line.pricePerBag),
    total: money2(line.lineTotal),
  }
}

export type InvoiceStatusKey = 'owed' | 'paid' | 'overpaid'

/** Payment status from the server's balanceDue (total − paidAmount). */
export function invoiceStatusKey(balanceDue: string | number): InvoiceStatusKey {
  const b = Number(balanceDue)
  if (b > 0.004) return 'owed'
  if (b < -0.004) return 'overpaid'
  return 'paid'
}
