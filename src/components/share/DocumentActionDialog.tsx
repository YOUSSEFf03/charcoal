import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Modal from '../ui/Modal'
import type { DocLang, ReceiptLang } from '../../lib/i18n/docLang'
import { t, type DocLabelKey } from '../../lib/i18n/docLabels'
import { toWhatsAppDigits } from '../../lib/phone'
import { canShareFiles, downloadFile, whatsappUrl } from '../../lib/share'
import { pingExtension, WhatsAppShareError } from '../../lib/share/whatsappExtension'
import {
  shareDocumentViaWhatsApp,
  type WhatsAppShareProgress,
  type WhatsAppShareResult,
  type WhatsAppShareTarget,
} from '../../lib/share/whatsappShare'

export interface DocumentActionContact {
  /** Display label, e.g. "Ahmad (mobile)". */
  label: string
  /** Raw stored phone; normalized for WhatsApp internally. */
  phone: string
}

export interface DocumentActionHandlers {
  /** Open/print the document in the chosen language. The dialog closes when it resolves. */
  print?: (lang: ReceiptLang) => void | Promise<void>
  /** Generate and download the PDF. The dialog closes when it resolves. */
  download?: (lang: ReceiptLang) => Promise<void>
  /** Build the PDF File. The Share action is only offered when this is provided. */
  buildFile?: (lang: ReceiptLang) => Promise<File>
}

export interface DocumentActionDialogProps {
  open: boolean
  onClose: () => void
  /** Modal title, e.g. "Invoice INV-0042". */
  title: string
  /** Languages offered (radio order). Include 'bilingual' only for documents that support it. */
  languages: ReceiptLang[]
  /** Preselected on every open; nothing is remembered between opens. */
  defaultLang: ReceiptLang
  actions: DocumentActionHandlers
  /** The party's stored phone numbers. May be empty (the user can type a number). */
  contacts: DocumentActionContact[]
  /** Prefilled WhatsApp / native-share text for the chosen document language. */
  shareMessage: (lang: ReceiptLang) => string
  /** Language of the dialog's own UI text. Default 'en'. */
  uiLang?: DocLang
  /**
   * Which document this is, for the Farah WhatsApp extension (attaches the PDF
   * in WhatsApp Web; the user presses Send). Omit to offer only the chat link.
   */
  whatsappTarget?: WhatsAppShareTarget | null
}

const WA_ERROR_CODES = new Set([
  'EXTENSION_NOT_FOUND', 'EXTENSION_DISCONNECTED', 'INVALID_PHONE', 'BUSY', 'NOT_LOGGED_IN', 'CHAT_UNAVAILABLE',
  'ATTACH_FAILED', 'TAB_CLOSED', 'WHATSAPP_TIMEOUT', 'FILE_TOO_LARGE', 'PDF_FAILED',
])

type ExtState = 'unknown' | 'checking' | 'available' | 'missing'

const LANG_LABEL_KEY: Record<ReceiptLang, DocLabelKey> = {
  en: 'share.langEn',
  ar: 'share.langAr',
  bilingual: 'share.langBilingual',
}

/** Minimum digit count for a number to be considered dialable. */
const MIN_PHONE_DIGITS = 8

type Step = 'choose' | 'share'
type Busy = null | 'print' | 'download' | 'prepare'

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Print / Download PDF / Share dialog used by every document action button.
 * Step 1 picks the language and action; the Share step builds the PDF, then
 * offers the native share sheet (when supported) and a WhatsApp chat link.
 * WhatsApp links cannot carry attachments, so that path downloads the PDF and
 * the UI tells the user to attach it.
 */
export function DocumentActionDialog(props: DocumentActionDialogProps) {
  // The stateful body is mounted only while open, so every open starts fresh
  // (default language, first step, no leftover file or errors).
  if (!props.open) return null
  return <DialogBody {...props} />
}

function DialogBody({
  onClose, title, languages, defaultLang, actions, contacts, shareMessage, uiLang = 'en', whatsappTarget,
}: DocumentActionDialogProps) {
  const L = useCallback((key: DocLabelKey, vars?: Record<string, string | number>) => t(uiLang, key, vars), [uiLang])
  const uid = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  const [lang, setLang] = useState<ReceiptLang>(
    languages.includes(defaultLang) ? defaultLang : languages[0] ?? defaultLang,
  )
  const [step, setStep] = useState<Step>('choose')
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [selectedPhone, setSelectedPhone] = useState('')
  const [typed, setTyped] = useState('')
  const [message, setMessage] = useState('')
  const [extState, setExtState] = useState<ExtState>('unknown')
  const [waRunning, setWaRunning] = useState(false)
  const [waProgress, setWaProgress] = useState<WhatsAppShareProgress | null>(null)
  const [waResult, setWaResult] = useState<WhatsAppShareResult | null>(null)
  const waRunningRef = useRef(false)
  const buildToken = useRef(0)

  // Focus the first control on open; Esc closes unless a job is running.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('input, button')?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  // Invalidate any in-flight PDF build on unmount.
  useEffect(() => () => { buildToken.current++ }, [])

  const run = async (kind: 'print' | 'download') => {
    const fn = kind === 'print' ? actions.print : actions.download
    if (!fn) return
    setBusy(kind)
    setError(null)
    try {
      await fn(lang)
      onClose()
    } catch (e) {
      setError(L('share.error', { message: errorMessage(e) }))
      setBusy(null)
    }
  }

  const prepareFile = async () => {
    if (!actions.buildFile) return
    const token = ++buildToken.current
    setBusy('prepare')
    setError(null)
    setFile(null)
    try {
      const f = await actions.buildFile(lang)
      if (token === buildToken.current) setFile(f)
    } catch (e) {
      if (token === buildToken.current) setError(L('share.error', { message: errorMessage(e) }))
    } finally {
      if (token === buildToken.current) setBusy(null)
    }
  }

  const goShare = () => {
    setStep('share')
    setNotice(null)
    setMessage(shareMessage(lang))
    setWaProgress(null)
    setWaResult(null)
    if (whatsappTarget && extState !== 'available') {
      setExtState('checking')
      void pingExtension().then((v) => setExtState(v ? 'available' : 'missing'))
    }
    void prepareFile()
  }
  const goBack = () => {
    buildToken.current++
    setStep('choose')
    setBusy(null)
    setFile(null)
    setError(null)
    setNotice(null)
    setWaProgress(null)
    setWaResult(null)
  }

  const phone = typed.trim() || selectedPhone
  const phoneValid = toWhatsAppDigits(phone).length >= MIN_PHONE_DIGITS
  const showInvalid = typed.trim() !== '' && !phoneValid
  const nativeShareAvailable = file != null && canShareFiles(file)
  const working = busy !== null

  const nativeShare = async () => {
    if (!file) return
    setError(null)
    try {
      await navigator.share({ files: [file], title, text: message })
      setNotice(L('share.shared'))
    } catch (e) {
      // Dismissing the share sheet is not an error.
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(L('share.error', { message: errorMessage(e) }))
      }
    }
  }

  const sendWhatsApp = () => {
    if (!file || !phoneValid) return
    const url = whatsappUrl(phone, message)
    if (!url) return
    // The file is already built, so both calls stay inside the click gesture.
    downloadFile(file)
    window.open(url, '_blank', 'noopener,noreferrer')
    setNotice(L('share.downloaded'))
  }

  const waErrorText = (e: unknown) =>
    e instanceof WhatsAppShareError && WA_ERROR_CODES.has(e.code)
      ? L(`share.waErr.${e.code}` as DocLabelKey)
      : L('share.error', { message: errorMessage(e) })

  /** Extension path: PDF attached + caption typed in WhatsApp Web; the user presses Send there. */
  const prepareInWhatsApp = async () => {
    if (!whatsappTarget || !file || !phoneValid || waRunningRef.current) return
    waRunningRef.current = true
    setWaRunning(true)
    setError(null)
    setNotice(null)
    setWaResult(null)
    try {
      const result = await shareDocumentViaWhatsApp(
        { ...whatsappTarget, phoneNumber: phone, message, getFile: () => file },
        setWaProgress,
      )
      setWaResult(result)
    } catch (e) {
      setWaProgress(null)
      if (e instanceof WhatsAppShareError && e.code === 'EXTENSION_NOT_FOUND') setExtState('missing')
      setError(waErrorText(e))
    } finally {
      waRunningRef.current = false
      setWaRunning(false)
    }
  }

  const waProgressText = (p: WhatsAppShareProgress | null): string | null => {
    if (!p || p.status === 'error' || p.status === 'ready') return null
    const name = ('chatTitle' in p && p.chatTitle) || `+${toWhatsAppDigits(phone)}`
    return L(`share.wa.${p.status}` as DocLabelKey, { name })
  }
  const extensionMode = !!whatsappTarget && extState === 'available'

  const footer = step === 'share' ? (
    <>
      <button type="button" className="btn" onClick={goBack} disabled={waRunning}>{L('share.back')}</button>
      <button type="button" className="btn" onClick={onClose}>{L('share.close')}</button>
    </>
  ) : (
    <button type="button" className="btn" onClick={onClose} disabled={working}>{L('share.close')}</button>
  )

  return (
    <Modal open onClose={() => { if (!working) onClose() }} title={title} width={440} scrollable footer={footer}>
      <div ref={rootRef} dir={uiLang === 'ar' ? 'rtl' : 'ltr'} lang={uiLang} className="flex max-w-full flex-col gap-4">
        {step === 'choose' && (
          <>
            <fieldset className="m-0 border-0 p-0" disabled={working}>
              <legend className="mb-2 p-0 text-[12px] font-medium text-gray-600">{L('share.language')}</legend>
              <div className="flex flex-wrap gap-2">
                {languages.map((l) => (
                  <label
                    key={l}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${
                      lang === l ? 'border-gray-900 bg-gray-50 font-semibold' : 'border-gray-300'
                    }`}
                  >
                    <input type="radio" name={`${uid}-lang`} value={l} checked={lang === l} onChange={() => setLang(l)} />
                    <span lang={l === 'ar' ? 'ar' : undefined}>{L(LANG_LABEL_KEY[l])}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <div className="mb-2 text-[12px] font-medium text-gray-600">{L('share.action')}</div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {actions.print && (
                  <button type="button" className="btn flex-1 justify-center" disabled={working} onClick={() => void run('print')}>
                    {busy === 'print' ? L('share.working') : L('share.print')}
                  </button>
                )}
                {actions.download && (
                  <button type="button" className="btn flex-1 justify-center" disabled={working} onClick={() => void run('download')}>
                    {busy === 'download' ? L('share.working') : L('share.download')}
                  </button>
                )}
                {actions.buildFile && (
                  <button type="button" className="btn green flex-1 justify-center" disabled={working} onClick={goShare}>
                    {L('share.share')}
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {step === 'share' && (
          <>
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 p-0 text-[12px] font-medium text-gray-600">{L('share.contact')}</legend>
              {contacts.length === 0 ? (
                <p className="m-0 text-[13px] text-gray-500">{L('share.noContacts')}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {contacts.map((c, i) => {
                    const checked = !typed.trim() && selectedPhone === c.phone
                    return (
                      <label
                        key={`${c.phone}-${i}`}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${
                          checked ? 'border-gray-900 bg-gray-50' : 'border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`${uid}-contact`}
                          checked={checked}
                          onChange={() => { setSelectedPhone(c.phone); setTyped('') }}
                        />
                        <span className="font-medium">{c.label}</span>
                        <bdi dir="ltr" className="ms-2 text-gray-600">{c.phone}</bdi>
                      </label>
                    )
                  })}
                </div>
              )}
              <label className="mt-3 block text-[12px] font-medium text-gray-600" htmlFor={`${uid}-num`}>
                {L('share.typeNumber')}
              </label>
              <input
                id={`${uid}-num`}
                type="tel"
                inputMode="tel"
                dir="ltr"
                className="form-input mt-1"
                placeholder={L('share.numberPlaceholder')}
                value={typed}
                aria-invalid={showInvalid}
                aria-describedby={showInvalid ? `${uid}-err` : undefined}
                onChange={(e) => setTyped(e.target.value)}
              />
              {showInvalid && <div id={`${uid}-err`} className="field-err">{L('share.invalidNumber')}</div>}
            </fieldset>

            <div>
              <label className="block text-[12px] font-medium text-gray-600" htmlFor={`${uid}-msg`}>{L('share.message')}</label>
              <textarea
                id={`${uid}-msg`}
                className="form-input mt-1"
                rows={3}
                maxLength={1000}
                dir="auto"
                value={message}
                disabled={waRunning}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              {extensionMode && (
                <>
                  <button
                    type="button"
                    className="btn green justify-center"
                    disabled={working || waRunning || !file || !phoneValid}
                    onClick={() => void prepareInWhatsApp()}
                  >
                    {busy === 'prepare' ? L('share.preparing') : waRunning ? L('share.working') : L('share.prepareWhatsapp')}
                  </button>
                  <p className="m-0 text-[12px] text-gray-500">{L('share.prepareHint')}</p>
                  {waRunning && waProgressText(waProgress) && (
                    <p className="m-0 text-[13px] text-gray-700" data-testid="wa-progress">{waProgressText(waProgress)}</p>
                  )}
                  {waResult && (
                    <div className="rounded-lg border border-green-600 bg-green-50 px-3 py-2 text-[13px]" data-testid="wa-ready">
                      <div className="font-semibold">{L('share.wa.ready', { name: waResult.chatTitle || `+${waResult.phoneDigits}` })}</div>
                      <div>{L('share.wa.notSent')}</div>
                      {!waResult.captionInserted && <div>{L('share.wa.captionCopied')}</div>}
                      {!waResult.attachmentVerified && <div>{L('share.wa.checkAttachment')}</div>}
                    </div>
                  )}
                </>
              )}
              {nativeShareAvailable && (
                <button type="button" className="btn justify-center" disabled={working || waRunning} onClick={() => void nativeShare()}>
                  {L('share.nativeShare')}
                </button>
              )}
              <button
                type="button"
                className={`btn justify-center${extensionMode ? '' : ' green'}`}
                disabled={working || waRunning || !file || !phoneValid}
                onClick={sendWhatsApp}
              >
                {busy === 'prepare' && !extensionMode ? L('share.preparing') : extensionMode ? L('share.linkOnly') : L('share.whatsapp')}
              </button>
              <p className="m-0 text-[12px] text-gray-500">{L('share.whatsappHint')}</p>
              {whatsappTarget && extState === 'missing' && (
                <p className="m-0 text-[12px] text-gray-500" data-testid="wa-ext-missing">{L('share.extMissing')}</p>
              )}
            </div>
          </>
        )}

        <div role="status" aria-live="polite" className="text-[13px] text-gray-600">
          {busy === 'prepare' ? L('share.preparing') : notice}
        </div>
        {error && (
          <div role="alert" className="text-[13px] text-red-600">
            <span>{error}</span>
            {step === 'share' && !working && !file && (
              <button type="button" className="btn ms-2" aria-label={L('share.preparing')} onClick={() => void prepareFile()}>↻</button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

export default DocumentActionDialog
