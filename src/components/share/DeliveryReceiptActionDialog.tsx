import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DocumentActionDialog } from './DocumentActionDialog'
import { bagTypesQuery, clientQuery, orderQuery } from './documentQueries'
import Modal from '../ui/Modal'
import { DeliveryReceiptDocument } from '../receipt/DeliveryReceiptDocument'
import { buildDeliveryReceiptData, receiptNeedsTranslation, type ReceiptBagType } from '../receipt/buildDeliveryReceiptData'
import { useArabicTranslations } from '../../hooks/useTranslation'
import { clientPhoneContacts } from '../../lib/share/contacts'
import { openPrintRoute } from '../../lib/share/printRoute'
import { renderElementToPdfFile } from '../../lib/share/renderDocument'
import { downloadFile } from '../../lib/share'
import { t } from '../../lib/i18n/docLabels'
import type { ReceiptLang } from '../../lib/i18n/docLang'
import type { ClientOrderDetail } from '../../lib/types'

export interface DeliveryReceiptActionDialogProps {
  open: boolean
  onClose: () => void
  order: ClientOrderDetail
  bagTypes: ReceiptBagType[]
}

/**
 * Print / Download PDF / Share dialog for an order's Delivery Receipt.
 * The receipt is already bilingual, so it offers Bilingual (default), English
 * and Arabic. Print opens /orders/:id/delivery-receipt?lang=; Download/Share
 * render the same DeliveryReceiptDocument off-screen (A4 width) into a PDF.
 */
export function DeliveryReceiptActionDialog(props: DeliveryReceiptActionDialogProps) {
  if (!props.open) return null
  return <Body {...props} />
}

function Body({ open, onClose, order, bagTypes }: DeliveryReceiptActionDialogProps) {
  const { data: client } = useQuery(clientQuery(order.client.id))
  // Machine translation of a non-glossary charcoal type (cached app-wide); the
  // latest result is read at build time so a late translation is still used.
  const translations = useArabicTranslations(receiptNeedsTranslation(order, 'bilingual') ? [order.charcoalType] : [])
  const translationsRef = useRef(translations)
  translationsRef.current = translations

  const display = order.displayId ?? `#${order.id.slice(0, 8).toUpperCase()}`

  const buildFile = (l: ReceiptLang) => {
    const data = buildDeliveryReceiptData(order, bagTypes, l, translationsRef.current)
    const suffix = l === 'bilingual' ? '' : ` (${l.toUpperCase()})`
    return renderElementToPdfFile(
      <DeliveryReceiptDocument data={data} widthMm={210} lang={l} />,
      `Delivery Receipt ${data.receiptNo}${suffix}.pdf`,
      { widthPx: 794, paperWidthMm: 210 },
    )
  }

  return (
    <DocumentActionDialog
      open={open}
      onClose={onClose}
      title={`Delivery receipt ${display}`}
      languages={['bilingual', 'en', 'ar']}
      defaultLang="bilingual"
      contacts={clientPhoneContacts(client?.phones, client?.name ?? order.client.name)}
      whatsappTarget={{ documentType: 'delivery_receipt', documentId: order.id, customerId: order.client.id }}
      shareMessage={(l) => {
        const msgLang = l === 'ar' ? 'ar' : 'en'
        return t(msgLang, 'msg.receipt', { ref: display, company: t(msgLang, 'common.company') })
      }}
      actions={{
        print: (l) => openPrintRoute(`/orders/${order.id}/delivery-receipt`, l),
        download: async (l) => downloadFile(await buildFile(l)),
        buildFile,
      }}
    />
  )
}

export default DeliveryReceiptActionDialog

export interface DeliveryReceiptActionDialogByIdProps {
  open: boolean
  onClose: () => void
  orderId: string
}

/**
 * Same dialog for callers that only know the order id (e.g. a row in a
 * client's order list): loads the order and bag types on open.
 */
export function DeliveryReceiptActionDialogById({ open, onClose, orderId }: DeliveryReceiptActionDialogByIdProps) {
  if (!open) return null
  return <ByIdBody onClose={onClose} orderId={orderId} />
}

function ByIdBody({ onClose, orderId }: { onClose: () => void; orderId: string }) {
  const orderQ = useQuery(orderQuery(orderId))
  const bagTypesQ = useQuery(bagTypesQuery())
  if (orderQ.data && bagTypesQ.data) {
    return <DeliveryReceiptActionDialog open onClose={onClose} order={orderQ.data} bagTypes={bagTypesQ.data} />
  }
  const failed = orderQ.isError || bagTypesQ.isError
  return (
    <Modal open onClose={onClose} title="Delivery receipt" width={440} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      <div role={failed ? 'alert' : 'status'} className="text-[13px] text-gray-600">
        {failed ? 'Failed to load the order.' : 'Loading…'}
      </div>
    </Modal>
  )
}
