import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DocumentActionDialog } from './DocumentActionDialog'
import { invoiceQuery } from './documentQueries'
import { InvoiceDocument } from '../documents/InvoiceDocument'
import { clientPhoneContacts } from '../../lib/share/contacts'
import { openPrintRoute } from '../../lib/share/printRoute'
import { renderElementToPdfFile } from '../../lib/share/renderDocument'
import { downloadFile } from '../../lib/share'
import { t } from '../../lib/i18n/docLabels'
import type { DocLang, ReceiptLang } from '../../lib/i18n/docLang'

export interface InvoiceActionDialogProps {
  open: boolean
  onClose: () => void
  invoiceId: string
  /** Human-readable reference (e.g. INV-0042); falls back to the id. */
  displayId?: string | null
}

const toDocLang = (l: ReceiptLang): DocLang => (l === 'ar' ? 'ar' : 'en')

/**
 * Print / Download PDF / Share dialog for an invoice. Print opens the
 * existing /invoice/:id route with ?lang=; Download and Share render the same
 * InvoiceDocument off-screen into a PDF. Contacts come from the invoice's client.
 */
export function InvoiceActionDialog(props: InvoiceActionDialogProps) {
  if (!props.open) return null
  return <Body {...props} />
}

function Body({ open, onClose, invoiceId, displayId }: InvoiceActionDialogProps) {
  const qc = useQueryClient()
  const { data } = useQuery(invoiceQuery(invoiceId))
  const ref = displayId ?? data?.displayId ?? invoiceId

  const buildFile = async (l: ReceiptLang) => {
    const lang = toDocLang(l)
    const invoice = await qc.fetchQuery({ ...invoiceQuery(invoiceId), staleTime: 30_000 })
    return renderElementToPdfFile(
      <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <InvoiceDocument invoice={invoice} lang={lang} />
        </div>
      </div>,
      `Invoice ${invoice.displayId ?? invoice.id}${lang === 'ar' ? ' (AR)' : ''}.pdf`,
      { widthPx: 600 },
    )
  }

  return (
    <DocumentActionDialog
      open={open}
      onClose={onClose}
      title={`Invoice ${ref}`}
      languages={['en', 'ar']}
      defaultLang="en"
      contacts={clientPhoneContacts(data?.client.phones)}
      shareMessage={(l) => t(toDocLang(l), 'msg.invoice', { ref, company: t(toDocLang(l), 'common.company') })}
      actions={{
        print: (l) => openPrintRoute(`/invoice/${invoiceId}`, toDocLang(l)),
        download: async (l) => downloadFile(await buildFile(l)),
        buildFile,
      }}
    />
  )
}

export default InvoiceActionDialog
