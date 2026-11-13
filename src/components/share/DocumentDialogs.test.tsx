// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'

// Capture what the share/download path renders instead of rasterising it.
const mockRenderToPdf = vi.fn(async (_el: ReactElement, name: string, _opts?: unknown) => new File(['pdf'], name, { type: 'application/pdf' }))
vi.mock('../../lib/share/renderDocument', () => ({
  renderElementToPdfFile: (el: ReactElement, name: string, opts?: unknown) => mockRenderToPdf(el, name, opts),
}))
vi.mock('../../hooks/useTranslation', () => ({ useArabicTranslations: () => new Map<string, string>() }))

import { DeliveryReceiptActionDialog } from './DeliveryReceiptActionDialog'
import { DailyReportActionDialog } from './DailyReportActionDialog'
import { InvoiceActionDialog } from './InvoiceActionDialog'
import type { ClientOrderDetail } from '../../lib/types'

const order = {
  id: 'order-1', displayId: 'SO-0099', clientId: 'client-1',
  client: { id: 'client-1', name: 'Acme Trading', nameAr: null, type: 'restaurant', currency: 'USD', address: 'Beirut' },
  charcoalType: 'BBQ Hardwood', grade: 'A', totalKgRequested: '100.000', bagTypeId: 'bt-1',
  bagType: { id: 'bt-1', name: '10 kg Bag', nominalKg: '10' }, pricePerBag: '10.00', currency: 'USD',
  notes: null, bagLines: [], shipments: [], invoices: [],
} as unknown as ClientOrderDetail

function renderWithClient(ui: ReactElement, seed: Array<[unknown[], unknown]> = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  for (const [key, data] of seed) qc.setQueryData(key, data)
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

describe('DeliveryReceiptActionDialog', () => {
  const client = { id: 'client-1', phones: [{ number: '+961 70 000003', label: 'mobile', isActive: true, dateAdded: '2026-01-01' }] }
  const open = () => renderWithClient(
    <DeliveryReceiptActionDialog open onClose={vi.fn()} order={order} bagTypes={[{ id: 'bt-1', nominalKg: '10' }]} />,
    [[['clients', 'client-1'], client]],
  )

  it('offers Bilingual (default), English and Arabic', () => {
    open()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: 'Bilingual' })).toBeChecked()
    expect(within(dialog).getByRole('radio', { name: 'English' })).not.toBeChecked()
    expect(within(dialog).getByRole('radio', { name: 'العربية' })).not.toBeChecked()
  })

  it('Print opens the delivery-receipt route with the chosen language', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    const user = userEvent.setup()
    open()
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'العربية' }))
    await user.click(within(dialog).getByRole('button', { name: 'Print' }))
    expect(openSpy).toHaveBeenCalledWith('/orders/order-1/delivery-receipt?lang=ar', '_blank')
  })

  it('Download PDF renders the SAME receipt document in the chosen language with the order figures', async () => {
    const user = userEvent.setup()
    open()
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'English' }))
    await user.click(within(dialog).getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(mockRenderToPdf).toHaveBeenCalledTimes(1))
    const [el, name] = mockRenderToPdf.mock.calls[0]
    expect(name).toBe('Delivery Receipt SO-0099 (EN).pdf')
    expect(el.props).toMatchObject({ lang: 'en', widthMm: 210 })
    expect(el.props.data).toMatchObject({ receiptNo: 'SO-0099', customerName: 'Acme Trading', totalQuantity: 10, totalAmount: 100 })
  })

  it("Share lists the client's saved numbers and sends a WhatsApp message to the chosen contact in the chosen language", async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const user = userEvent.setup()
    open()
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'العربية' }))
    await user.click(within(dialog).getByRole('button', { name: 'Share' }))
    await user.click(await within(dialog).findByRole('radio', { name: /70 000003/ }))
    const send = within(dialog).getByRole('button', { name: 'Send on WhatsApp' })
    await waitFor(() => expect(send).toBeEnabled())
    await user.click(send)

    expect(mockRenderToPdf.mock.calls[0][0].props.lang).toBe('ar')
    const url = String(openSpy.mock.calls[0][0])
    expect(url.startsWith('https://wa.me/96170000003?text=')).toBe(true)
    expect(decodeURIComponent(url.split('text=')[1])).toBe('إيصال تسليم SO-0099 — فرح للفحم')
  })
})

describe('DailyReportActionDialog', () => {
  it('has no saved contacts (typed number only) and Print opens the daily report route in the chosen language', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    const user = userEvent.setup()
    renderWithClient(<DailyReportActionDialog open onClose={vi.fn()} date="2026-08-01" />)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('radio', { name: 'Bilingual' })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: 'العربية' }))
    await user.click(within(dialog).getByRole('button', { name: 'Print' }))
    expect(openSpy).toHaveBeenCalledWith('/reports/daily/2026-08-01?lang=ar', '_blank')
  })

  it('Share on a report with no recipients asks for a typed number', async () => {
    const report = { date: '2026-08-01' }
    const user = userEvent.setup()
    renderWithClient(<DailyReportActionDialog open onClose={vi.fn()} date="2026-08-01" />, [[['reports', 'daily', '2026-08-01'], report]])
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Share' }))
    expect(within(dialog).getByText(/No saved phone numbers/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Or type a number')).toBeInTheDocument()
  })
})

describe('InvoiceActionDialog', () => {
  it('Download PDF renders the invoice document in the chosen language', async () => {
    const invoice = {
      id: 'inv-1', displayId: 'SI-0042', currency: 'USD', total: '120.00', paidAmount: '0.00', balanceDue: '120.00',
      createdAt: '2026-08-01T00:00:00.000Z', issuedAt: null, dueDate: null, lines: [],
      client: { id: 'c1', name: 'Acme Trading', type: 'restaurant', currency: 'USD', phones: [] },
    }
    const user = userEvent.setup()
    renderWithClient(<InvoiceActionDialog open onClose={vi.fn()} invoiceId="inv-1" displayId="SI-0042" />, [[['invoices', 'inv-1'], invoice]])
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('Invoice SI-0042')
    await user.click(within(dialog).getByRole('radio', { name: 'العربية' }))
    await user.click(within(dialog).getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(mockRenderToPdf).toHaveBeenCalledTimes(1))
    expect(mockRenderToPdf.mock.calls[0][1]).toBe('Invoice SI-0042 (AR).pdf')
  })
})
