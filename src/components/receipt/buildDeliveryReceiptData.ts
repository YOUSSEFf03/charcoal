import type { ClientOrderDetail } from '../../lib/types'
import type { ReceiptLang } from '../../lib/i18n/docLang'
import { t } from '../../lib/i18n/docLabels'
import { unitLabel } from '../../lib/i18n/docFormat'
import { lookupCharcoalTypeAr } from '../../lib/charcoalTypeGlossary'
import { firstAddress } from '../../lib/clientAddress'
import type { DeliveryReceiptData, DeliveryReceiptItem } from './DeliveryReceiptDocument'

/** Minimal bag-type projection the receipt needs. */
export interface ReceiptBagType {
  id: string
  nominalKg: string
}

/**
 * True when the order's charcoal type is NOT a known glossary term, i.e. its
 * Arabic description should come from machine translation (and only when the
 * receipt shows Arabic at all). Known terms use the deterministic glossary.
 */
export function receiptNeedsTranslation(order: Pick<ClientOrderDetail, 'charcoalType'> | undefined, lang: ReceiptLang): boolean {
  return !!order && lang !== 'en' && !lookupCharcoalTypeAr(order.charcoalType).isKnown
}

/**
 * Builds the Delivery Receipt view-model from an order. Mirrors
 * OrderDetail.tsx's "Order details" card exactly (same bagLines vs single
 * bag type vs by-weight branching and figures). Shared by the print route and
 * the PDF share/download path so both render identical data.
 *
 * @param translations Map from English charcoal type to machine-translated
 *   Arabic (see useArabicTranslations); only consulted for non-glossary types.
 */
export function buildDeliveryReceiptData(
  order: ClientOrderDetail,
  bagTypes: ReceiptBagType[],
  lang: ReceiptLang,
  translations: Map<string, string> = new Map(),
): DeliveryReceiptData {
  const isBagOrder = !!order.bagTypeId
  const pricePerUnit = parseFloat(order.pricePerBag)
  const totalKg = parseFloat(order.totalKgRequested)
  const bagTypeById = new Map(bagTypes.map((b) => [b.id, b]))
  const totalBags = isBagOrder
    ? (order.bagLines.length > 0
        ? order.bagLines.reduce((s, l) => s + l.quantity, 0)
        : order.bagType ? Math.round(totalKg / parseFloat(order.bagType.nominalKg)) : 0)
    : 0
  const totalAmount = isBagOrder ? totalBags * pricePerUnit : totalKg * pricePerUnit

  // Bilingual/English keep the historical English strings; Arabic uses the dictionary.
  const sizeLabel = (kg: number) => (lang === 'ar' ? `${kg} ${unitLabel('ar', 'KG')}` : `${kg} KG`)
  const gradeLabel = `${lang === 'ar' ? t('ar', 'common.grade') : 'Grade'} ${order.grade}`

  const items: DeliveryReceiptItem[] = []
  if (isBagOrder && order.bagLines.length > 0) {
    order.bagLines.forEach((l, i) => {
      const bt = bagTypeById.get(l.bagTypeId)
      items.push({
        no: i + 1,
        descriptionEn: order.charcoalType,
        typeSize: bt ? sizeLabel(parseFloat(bt.nominalKg)) : '—',
        unit: 'BAG',
        quantity: l.quantity,
        unitPrice: pricePerUnit,
        lineTotal: l.quantity * pricePerUnit,
      })
    })
  } else if (isBagOrder) {
    items.push({
      no: 1,
      descriptionEn: order.charcoalType,
      typeSize: order.bagType ? sizeLabel(parseFloat(order.bagType.nominalKg)) : '—',
      unit: 'BAG',
      quantity: totalBags,
      unitPrice: pricePerUnit,
      lineTotal: totalAmount,
    })
  } else {
    items.push({
      no: 1,
      descriptionEn: order.charcoalType,
      typeSize: gradeLabel,
      unit: 'KG',
      quantity: totalKg,
      unitPrice: pricePerUnit,
      lineTotal: totalAmount,
    })
  }

  // Known-terminology check FIRST (see charcoalTypeGlossary.ts): a known term
  // with no verified Arabic yet shows English only and is deliberately NOT
  // sent to machine translation.
  const known = lookupCharcoalTypeAr(order.charcoalType)
  for (const it of items) it.descriptionAr = known.isKnown ? (known.ar ?? undefined) : translations.get(it.descriptionEn)

  const orderDisplay = order.displayId ?? `#${order.id.slice(0, 8).toUpperCase()}`
  // Delivery address: the shipment being delivered when the order routes
  // through one, else the order's location (multi-location clients keep their
  // addresses there), else the client's own address. Blank values are skipped.
  const address = firstAddress(
    order.shipments[0]?.address,
    order.location?.address,
    order.client.address,
  ) ?? '—'

  return {
    receiptNo: orderDisplay,
    date: new Date().toLocaleDateString('en-GB'),
    customerName: order.client.name,
    customerNameAr: order.client.nameAr,
    address,
    location: order.location?.name?.trim() || null,
    currency: order.currency,
    items,
    totalItems: items.length,
    totalQuantity: items.reduce((s, it) => s + it.quantity, 0),
    totalAmount,
    notes: order.notes,
  }
}
