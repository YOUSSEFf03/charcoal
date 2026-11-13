import { api } from '../api'
import {
  pingExtension,
  sendToExtension,
  WhatsAppShareError,
  type WaStatusUpdate,
} from './whatsappExtension'

/**
 * Reusable "prepare this PDF in WhatsApp" service.
 *
 *   1. checks the Farah WhatsApp extension is installed;
 *   2. asks the backend to authorize it (POST /whatsapp-shares — checks the
 *      user may share THIS document with THIS customer, validates and
 *      normalizes the number, logs the event);
 *   3. builds the PDF in the browser and hands the bytes straight to the
 *      extension (never uploaded, no download URL exists);
 *   4. follows the extension until WhatsApp shows the PDF + caption with its
 *      Send button — then stops. The user presses Send. Nothing here can send.
 *
 * Adding a document type: add it to WhatsAppDocumentType here and to
 * WHATSAPP_DOCUMENT_TYPES + the ownership check in the backend's
 * whatsapp-share.service.ts.
 */

export type WhatsAppDocumentType = 'invoice' | 'delivery_receipt' | 'client_statement' | 'supplier_statement'

export interface WhatsAppShareTarget {
  documentType: WhatsAppDocumentType
  /** Invoice id, order id (delivery receipt), or the party id for statements. */
  documentId: string
  /** Client id (supplier id for supplier_statement). */
  customerId: string
}

export interface WhatsAppShareInput extends WhatsAppShareTarget {
  phoneNumber: string
  message: string
  /** Returns the PDF to attach (may reuse an already-built file). */
  getFile: () => File | Promise<File>
}

/** Progress shown in the UI: the app's own steps, then the extension's. */
export type WhatsAppShareProgress =
  | { status: 'checking_extension' | 'authorizing' | 'building_pdf' | 'sending_to_extension' }
  | WaStatusUpdate

export interface PreparedShare {
  shareId: string
  phoneDigits: string
  phoneMatchesSaved: boolean
  preparedAt: string
  expiresAt: string
}

export interface WhatsAppShareResult {
  shareId: string
  phoneDigits: string
  chatTitle: string
  captionInserted: boolean
  attachmentVerified: boolean
}

/** Mirrors the extension's MAX_PDF_BYTES. */
export const MAX_WHATSAPP_PDF_BYTES = 6 * 1024 * 1024

/** WhatsApp sends on Enter, so the extension never types a line break: collapse them here, visibly. */
export function toSingleLineCaption(message: string): string {
  return message.replace(/\s*[\r\n]+\s*/g, ' ').replace(/ {2,}/g, ' ').trim()
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the PDF'))
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'error' in e) return String((e as { error: unknown }).error)
  return e instanceof Error ? e.message : String(e)
}

function reportOutcome(shareId: string, outcome: 'ready_for_manual_send' | 'failed', errorCode?: string) {
  const code = errorCode && /^[A-Z_]{1,64}$/.test(errorCode) ? errorCode : undefined
  api.post(`/whatsapp-shares/${shareId}/outcome`, { outcome, ...(code ? { errorCode: code } : {}) }).catch(() => {
    /* logging only — never blocks the user */
  })
}

export async function shareDocumentViaWhatsApp(
  input: WhatsAppShareInput,
  onProgress: (p: WhatsAppShareProgress) => void = () => {},
): Promise<WhatsAppShareResult> {
  onProgress({ status: 'checking_extension' })
  if (!(await pingExtension())) {
    throw new WhatsAppShareError(
      'EXTENSION_NOT_FOUND',
      'The Farah WhatsApp extension is not installed or not enabled for this site.',
    )
  }

  onProgress({ status: 'authorizing' })
  let prepared: PreparedShare
  try {
    const res = await api.post<PreparedShare>('/whatsapp-shares', {
      documentType: input.documentType,
      documentId: input.documentId,
      customerId: input.customerId,
      phoneNumber: input.phoneNumber,
    })
    prepared = res.data
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : 'SERVER_REJECTED'
    throw new WhatsAppShareError(code === 'INVALID_PHONE' ? 'INVALID_PHONE' : 'SERVER_REJECTED', errorText(e))
  }

  try {
    onProgress({ status: 'building_pdf' })
    let file: File
    try {
      file = await input.getFile()
    } catch (e) {
      throw new WhatsAppShareError('PDF_FAILED', `The PDF could not be generated: ${errorText(e)}`)
    }
    if (file.size > MAX_WHATSAPP_PDF_BYTES) {
      throw new WhatsAppShareError('FILE_TOO_LARGE', 'The PDF is too large to attach through WhatsApp Web (max 6 MB).')
    }
    const pdfBase64 = await fileToBase64(file)

    onProgress({ status: 'sending_to_extension' })
    const final = await sendToExtension(
      {
        requestId: prepared.shareId,
        phoneDigits: prepared.phoneDigits,
        fileName: file.name.toLowerCase().endsWith('.pdf') ? file.name : `${file.name}.pdf`,
        mimeType: 'application/pdf',
        pdfBase64,
        message: toSingleLineCaption(input.message),
      },
      onProgress,
    )
    reportOutcome(prepared.shareId, 'ready_for_manual_send')
    return {
      shareId: prepared.shareId,
      phoneDigits: prepared.phoneDigits,
      chatTitle: final.chatTitle ?? '',
      captionInserted: final.captionInserted !== false,
      attachmentVerified: final.attachmentVerified === true,
    }
  } catch (e) {
    const err = e instanceof WhatsAppShareError ? e : new WhatsAppShareError('UNEXPECTED', errorText(e))
    reportOutcome(prepared.shareId, 'failed', err.code)
    throw err
  }
}
