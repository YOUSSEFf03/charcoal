// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/share/whatsappExtension', async (orig) => ({
  ...(await orig<typeof import('../../lib/share/whatsappExtension')>()),
  pingExtension: vi.fn(),
}))
vi.mock('../../lib/share/whatsappShare', async (orig) => ({
  ...(await orig<typeof import('../../lib/share/whatsappShare')>()),
  shareDocumentViaWhatsApp: vi.fn(),
}))

import { pingExtension, WhatsAppShareError } from '../../lib/share/whatsappExtension'
import { shareDocumentViaWhatsApp } from '../../lib/share/whatsappShare'
import { DocumentActionDialog, type DocumentActionDialogProps } from './DocumentActionDialog'

const ping = pingExtension as unknown as ReturnType<typeof vi.fn>
const share = shareDocumentViaWhatsApp as unknown as ReturnType<typeof vi.fn>
const file = new File(['%PDF-'], 'Invoice INV-1025.pdf', { type: 'application/pdf' })
const target = { documentType: 'invoice' as const, documentId: 'inv-1', customerId: 'client-1' }

function setup(over: Partial<DocumentActionDialogProps> = {}) {
  const props: DocumentActionDialogProps = {
    open: true,
    onClose: vi.fn(),
    title: 'Invoice INV-1025',
    languages: ['en', 'ar'],
    defaultLang: 'en',
    actions: { buildFile: vi.fn().mockResolvedValue(file) },
    contacts: [{ label: 'Bendy', phone: '71960117' }],
    shareMessage: () => 'Hello Bendy, please find attached your invoice INV-1025.',
    whatsappTarget: target,
    ...over,
  }
  render(<DocumentActionDialog {...props} />)
  return props
}

async function openShare(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Share' }))
  await user.click(screen.getByRole('radio', { name: /Bendy/ }))
}

beforeEach(() => {
  ping.mockReset()
  share.mockReset()
})

describe('DocumentActionDialog — WhatsApp extension', () => {
  it('prepares in WhatsApp with the chosen number and the EDITED message, then says it is not sent', async () => {
    ping.mockResolvedValue('1.0.0')
    let progress: (p: unknown) => void = () => {}
    let finish: (v: unknown) => void = () => {}
    share.mockImplementation((_input, onProgress) => {
      progress = onProgress
      return new Promise((r) => { finish = r })
    })
    const user = userEvent.setup()
    setup()
    await openShare(user)

    const msg = screen.getByLabelText('Message')
    expect(msg).toHaveValue('Hello Bendy, please find attached your invoice INV-1025.')
    await user.clear(msg)
    await user.type(msg, 'Hi Bendy, invoice attached.')

    const prepare = await screen.findByRole('button', { name: 'Prepare in WhatsApp (PDF attached)' })
    await waitFor(() => expect(prepare).toBeEnabled())
    await user.click(prepare)
    // Double clicks do not start a second preparation.
    await user.click(screen.getByRole('button', { name: 'Working…' }))
    expect(share).toHaveBeenCalledTimes(1)

    const [input] = share.mock.calls[0]
    expect(input).toMatchObject({ ...target, phoneNumber: '71960117', message: 'Hi Bendy, invoice attached.' })
    expect(await input.getFile()).toBe(file)

    progress({ status: 'chat_open', chatTitle: 'Bendy' })
    expect(await screen.findByTestId('wa-progress')).toHaveTextContent('Chat opened: Bendy')

    finish({ shareId: 's', phoneDigits: '96171960117', chatTitle: 'Bendy', captionInserted: true, attachmentVerified: true })
    const ready = await screen.findByTestId('wa-ready')
    expect(ready).toHaveTextContent('Ready in WhatsApp (Bendy)')
    expect(ready).toHaveTextContent('Not sent yet — only you can press Send.')
    expect(ready).not.toHaveTextContent('copied')
  })

  it('warns when the caption could not be typed or the PDF name was not seen', async () => {
    ping.mockResolvedValue('1.0.0')
    share.mockResolvedValue({ shareId: 's', phoneDigits: '96171960117', chatTitle: '', captionInserted: false, attachmentVerified: false })
    const user = userEvent.setup()
    setup()
    await openShare(user)
    const prepare = await screen.findByRole('button', { name: 'Prepare in WhatsApp (PDF attached)' })
    await waitFor(() => expect(prepare).toBeEnabled())
    await user.click(prepare)
    const ready = await screen.findByTestId('wa-ready')
    expect(ready).toHaveTextContent('+96171960117')
    expect(ready).toHaveTextContent('It was copied')
    expect(ready).toHaveTextContent('Check that the attached file is the right PDF')
  })

  it('shows a clear message for extension errors', async () => {
    ping.mockResolvedValue('1.0.0')
    share.mockRejectedValue(new WhatsAppShareError('NOT_LOGGED_IN', 'x'))
    const user = userEvent.setup()
    setup()
    await openShare(user)
    const prepare = await screen.findByRole('button', { name: 'Prepare in WhatsApp (PDF attached)' })
    await waitFor(() => expect(prepare).toBeEnabled())
    await user.click(prepare)
    expect(await screen.findByRole('alert')).toHaveTextContent('WhatsApp Web is not logged in. Scan the QR code, then try again.')
  })

  it('without the extension: explains how to get it and keeps the chat-link fallback', async () => {
    ping.mockResolvedValue(null)
    const user = userEvent.setup()
    setup()
    await openShare(user)
    expect(await screen.findByTestId('wa-ext-missing')).toHaveTextContent('install the Farah WhatsApp extension')
    expect(screen.queryByRole('button', { name: 'Prepare in WhatsApp (PDF attached)' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Send on WhatsApp' })).toBeInTheDocument()
  })

  it('documents without a WhatsApp target never ping the extension', async () => {
    const user = userEvent.setup()
    setup({ whatsappTarget: null })
    await openShare(user)
    expect(ping).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send on WhatsApp' })).toBeInTheDocument()
  })

  it('shows the Arabic texts in an Arabic dialog', async () => {
    ping.mockResolvedValue('1.0.0')
    const user = userEvent.setup()
    setup({ uiLang: 'ar' })
    await user.click(screen.getByRole('button', { name: 'مشاركة' }))
    expect(await screen.findByRole('button', { name: 'تجهيز في واتساب (مع إرفاق PDF)' })).toBeInTheDocument()
  })
})
