// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocumentActionDialog, type DocumentActionDialogProps } from './DocumentActionDialog'

const file = new File(['pdf'], 'inv.pdf', { type: 'application/pdf' })

function setup(over: Partial<DocumentActionDialogProps> = {}) {
  const props: DocumentActionDialogProps = {
    open: true,
    onClose: vi.fn(),
    title: 'Invoice 1',
    languages: ['en', 'ar'],
    defaultLang: 'en',
    actions: {
      print: vi.fn(),
      download: vi.fn().mockResolvedValue(undefined),
      buildFile: vi.fn().mockResolvedValue(file),
    },
    contacts: [{ label: 'Ahmad', phone: '03 123 456' }],
    shareMessage: (l) => `msg-${l}`,
    ...over,
  }
  render(<DocumentActionDialog {...props} />)
  return props
}

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
})

describe('DocumentActionDialog', () => {
  it('renders nothing when closed', () => {
    setup({ open: false })
    expect(screen.queryByText('Invoice 1')).toBeNull()
  })

  it('preselects the default language and prints with the chosen one', async () => {
    const user = userEvent.setup()
    const p = setup({ defaultLang: 'en' })
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'العربية' }))
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(p.actions.print).toHaveBeenCalledWith('ar')
    await waitFor(() => expect(p.onClose).toHaveBeenCalled())
  })

  it('shows an error and stays open when download fails', async () => {
    const user = userEvent.setup()
    const p = setup({ actions: { download: vi.fn().mockRejectedValue(new Error('boom')) } })
    await user.click(screen.getByRole('button', { name: 'Download PDF' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(p.onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const p = setup()
    await user.keyboard('{Escape}')
    expect(p.onClose).toHaveBeenCalled()
  })

  it('hides Share when buildFile is not provided', () => {
    setup({ actions: { print: vi.fn() } })
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
  })

  it('share flow: builds the file, downloads it and opens WhatsApp for the contact', async () => {
    const user = userEvent.setup()
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const p = setup()
    await user.click(screen.getByRole('radio', { name: 'العربية' }))
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(p.actions.buildFile).toHaveBeenCalledWith('ar'))
    await user.click(screen.getByRole('radio', { name: /Ahmad/ }))
    const send = await screen.findByRole('button', { name: 'Send on WhatsApp' })
    await waitFor(() => expect(send).toBeEnabled())
    expect(screen.getByText(/attach it to the chat/i)).toBeInTheDocument()
    await user.click(send)
    expect(open).toHaveBeenCalledWith('https://wa.me/9613123456?text=msg-ar', '_blank', 'noopener,noreferrer')
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('rejects an invalid typed number and offers native share when supported', async () => {
    const user = userEvent.setup()
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    setup({ contacts: [] })
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByText(/No saved phone numbers/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Or type a number'), '12')
    expect(screen.getByText('Enter a valid phone number.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send on WhatsApp' })).toBeDisabled()
    await user.click(await screen.findByRole('button', { name: 'Share via device…' }))
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [file], text: 'msg-en' }))
  })

  it('shows an error if the PDF cannot be built', async () => {
    const user = userEvent.setup()
    setup({ actions: { buildFile: vi.fn().mockRejectedValue(new Error('nope')) } })
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('nope')
    expect(screen.getByRole('button', { name: 'Send on WhatsApp' })).toBeDisabled()
  })
})
