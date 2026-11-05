import { useQueryClient } from '@tanstack/react-query'
import { DocumentActionDialog } from './DocumentActionDialog'
import { dailyReportQuery } from './documentQueries'
import { DailyReportDocument } from '../documents/DailyReportDocument'
import { openPrintRoute } from '../../lib/share/printRoute'
import { renderElementToPdfFile } from '../../lib/share/renderDocument'
import { downloadFile } from '../../lib/share'
import { t } from '../../lib/i18n/docLabels'
import type { DocLang, ReceiptLang } from '../../lib/i18n/docLang'

export interface DailyReportActionDialogProps {
  open: boolean
  onClose: () => void
  /** Report date, YYYY-MM-DD. */
  date: string
}

const toDocLang = (l: ReceiptLang): DocLang => (l === 'ar' ? 'ar' : 'en')

/**
 * Print / Download PDF / Share dialog for the Full Day Report (owner only).
 * The report has no single recipient, so there are no saved contacts: sharing
 * asks for a typed number.
 */
export function DailyReportActionDialog(props: DailyReportActionDialogProps) {
  if (!props.open) return null
  return <Body {...props} />
}

function Body({ open, onClose, date }: DailyReportActionDialogProps) {
  const qc = useQueryClient()

  const buildFile = async (l: ReceiptLang) => {
    const lang = toDocLang(l)
    const report = await qc.fetchQuery({ ...dailyReportQuery(date), staleTime: 30_000 })
    return renderElementToPdfFile(
      <DailyReportDocument report={report} lang={lang} />,
      `Full Day Report ${date}${lang === 'ar' ? ' (AR)' : ''}.pdf`,
      { widthPx: 794 },
    )
  }

  return (
    <DocumentActionDialog
      open={open}
      onClose={onClose}
      title={`Full Day Report ${date}`}
      languages={['en', 'ar']}
      defaultLang="en"
      contacts={[]}
      shareMessage={(l) => t(toDocLang(l), 'msg.dailyReport', { date, company: t(toDocLang(l), 'common.company') })}
      actions={{
        print: (l) => openPrintRoute(`/reports/daily/${date}`, toDocLang(l)),
        download: async (l) => downloadFile(await buildFile(l)),
        buildFile,
      }}
    />
  )
}

export default DailyReportActionDialog
