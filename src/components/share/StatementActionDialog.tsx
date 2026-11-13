import { useCallback } from 'react'
import { DocumentActionDialog, type DocumentActionContact } from './DocumentActionDialog'
import { buildStatementPdfFile, exportStatementPdf, type StatementPdfConfig } from '../../lib/statementPdf'
import { t } from '../../lib/i18n/docLabels'
import type { DocLang, ReceiptLang } from '../../lib/i18n/docLang'
import { openPdfInNewTab, printCurrentPage } from '../../lib/share/printRoute'
import type { WhatsAppShareTarget } from '../../lib/share/whatsappShare'

export interface StatementActionDialogProps {
  open: boolean
  onClose: () => void
  /** Dialog title, e.g. "Statement of account — Ahmad". */
  title: string
  /** Party name used in the share message. */
  partyName: string
  /** Builds the statement config for the on-screen period (language is applied by the dialog). */
  buildConfig: () => StatementPdfConfig
  contacts: DocumentActionContact[]
  /**
   * When true, choosing English + Print prints the on-screen statement page
   * (the historical behaviour of the page's Print button). Arabic, and every
   * page without an on-screen statement, prints the generated PDF instead.
   */
  printPageInEnglish?: boolean
  /** Enables "Prepare in WhatsApp" (Farah WhatsApp extension) for this statement. */
  whatsappTarget?: WhatsAppShareTarget | null
}

const toDocLang = (l: ReceiptLang): DocLang => (l === 'ar' ? 'ar' : 'en')

/**
 * Print / Download PDF / Share dialog for a Statement of Account (client,
 * supplier or fill client). The statement is only offered in English or Arabic.
 */
export function StatementActionDialog({
  open, onClose, title, partyName, buildConfig, contacts, printPageInEnglish = false, whatsappTarget,
}: StatementActionDialogProps) {
  const withLang = useCallback((l: ReceiptLang): StatementPdfConfig => ({ ...buildConfig(), lang: toDocLang(l) }), [buildConfig])

  return (
    <DocumentActionDialog
      open={open}
      onClose={onClose}
      title={title}
      languages={['en', 'ar']}
      defaultLang="en"
      contacts={contacts}
      whatsappTarget={whatsappTarget}
      shareMessage={(l) => t(toDocLang(l), 'msg.statement', { name: partyName })}
      actions={{
        print: (l) => {
          if (printPageInEnglish && toDocLang(l) === 'en') {
            printCurrentPage()
            return
          }
          return openPdfInNewTab(() => buildStatementPdfFile(withLang(l)))
        },
        download: (l) => exportStatementPdf(withLang(l)),
        buildFile: (l) => buildStatementPdfFile(withLang(l)),
      }}
    />
  )
}

export default StatementActionDialog
