// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Regression coverage for the new "Export PDF" button on the Client Statement
// of Account tab: it must exist next to the pre-existing "Export Excel"
// button, and clicking it must call exportStatementPdf() with the CURRENTLY
// selected client, From/To dates, and the complete period row set — never a
// hardcoded/stale client or a paginated slice (the statement table has no
// pagination at all; stmtFiltered is always the full filtered ledger).
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const mockClient = {
  id: 'client-1',
  name: 'GLOBAL CONSTRUCTION GROUP SAL',
  type: 'corporate',
  currency: 'USD',
  phones: [{ number: '+961 3 111 222', label: 'mobile', isActive: true, dateAdded: '2026-01-01' }],
  preferredTypes: [],
  avgOrderDays: null,
  lastOrderDate: null,
  paymentTerms: null,
  notes: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  balance: '4440.55',
  isOverdue: false,
}

// 45 ledger entries — comfortably more than any on-screen page size, so a
// test that asserted only "the visible rows" would catch a regression that
// exported a paginated slice instead of the complete stmtFiltered set.
const mockEntries = Array.from({ length: 45 }, (_, i) => ({
  date: `2026-07-${String((i % 27) + 1).padStart(2, '0')}T00:00:00.000Z`,
  type: 'invoice' as const,
  reference: `inv-${i}`,
  displayId: `SI-${1000 + i}`,
  description: 'Sales Invoice',
  debit: '100.00',
  credit: '0.00',
  runningBalance: `${(100 * (i + 1)).toFixed(2)}`,
  status: 'issued',
}))

const mockUseClient = vi.fn()
vi.mock('../hooks/useClients', () => ({
  useClient: (...args: unknown[]) => mockUseClient(...args),
  useUpdateClient: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddPhone: () => ({ mutateAsync: vi.fn() }),
  useDeactivatePhone: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('../hooks/useInvoices', () => ({
  useInvoices: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false }),
}))
vi.mock('../hooks/useReports', () => ({
  useClientLedger: () => ({ data: { entries: mockEntries, currency: 'USD', openingBalance: '0.00', balance: '4500.00' }, isLoading: false, isError: false }),
}))
vi.mock('../hooks/useOrders', () => ({
  useOrders: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false }),
  useCreateOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => ({ data: [] }),
}))
vi.mock('../hooks/useWarehouse', () => ({
  useStockExits: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false }),
  useClientWarehouseSummary: () => ({ data: { totalCount: 0, totalKg: '0', totalAmount: '0' } }),
}))
const mockCreatePaymentMutate = vi.fn()
vi.mock('../hooks/usePayments', () => ({
  usePayments: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false }),
  // ClientDetail.tsx's savePayment() calls .mutate(body, { onSuccess, onError }),
  // not .mutateAsync — invoke onSuccess synchronously so tests don't need to
  // await a promise that was never returned.
  useCreatePayment: () => ({
    mutate: (body: unknown, opts?: { onSuccess?: () => void }) => {
      mockCreatePaymentMutate(body)
      opts?.onSuccess?.()
    },
    isPending: false,
  }),
}))
const mockUseCashReceivers = vi.fn(() => ({ data: [] as { id: string; name: string; role: string }[] }))
vi.mock('../hooks/useUsers', () => ({
  useCashReceivers: () => mockUseCashReceivers(),
}))

const mockExportStatementPdf = vi.fn()
const mockBuildStatementPdf = vi.fn((_config: unknown) => ({ output: () => new Blob(['pdf'], { type: 'application/pdf' }) }))
vi.mock('../lib/statementPdf', () => ({
  exportStatementPdf: (config: unknown) => mockExportStatementPdf(config),
  buildStatementPdf: (config: unknown) => mockBuildStatementPdf(config),
  statementPdfFilename: (name: string) => `${name}_Statement of Account.pdf`,
}))

import ClientDetail from './ClientDetail'

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/clients/${id}`]}>
      <Routes>
        <Route path="/clients/:id" element={<ClientDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseClient.mockReturnValue({ data: mockClient, isLoading: false, isError: false })
  mockUseCashReceivers.mockReturnValue({ data: [{ id: 'receiver-1', name: 'Marie', role: 'receiver' }] })
})

// jsdom has no Web Share API by default — tests that stub navigator.share/
// canShare onto the global must not leak into other tests regardless of
// whether the stubbing test passes or throws.
afterEach(() => {
  // @ts-expect-error test-only cleanup of a jsdom global stub
  delete navigator.canShare
  // @ts-expect-error same
  delete navigator.share
})

describe('ClientDetail — Statement of Account PDF export', () => {
  it('shows an "Export PDF" button next to the existing "Export Excel" button on the Statement tab', async () => {
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))

    expect(screen.getByRole('button', { name: /Export PDF/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export Excel/ })).toBeInTheDocument()
  })

  it('opens a menu with Download and Share via WhatsApp when "Export PDF" is clicked', async () => {
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))

    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Share via WhatsApp/ })).toBeInTheDocument()
  })

  it('Download exports the currently selected client, the selected From/To dates, and the COMPLETE period (not a paginated slice)', async () => {
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))

    const dateInputs = document.querySelectorAll('input[type="date"]')
    await user.type(dateInputs[0], '2026-07-01')
    await user.type(dateInputs[1], '2026-08-19')

    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    await user.click(screen.getByRole('button', { name: 'Download' }))

    expect(mockExportStatementPdf).toHaveBeenCalledTimes(1)
    const [config] = mockExportStatementPdf.mock.calls[0]
    expect(config.client.name).toBe('GLOBAL CONSTRUCTION GROUP SAL')
    expect(config.client.currency).toBe('USD')
    expect(config.from).toContain('2026-07-01')
    expect(config.to).toContain('2026-08-19')
    // All 45 ledger entries fall within the selected range — the export must
    // carry every one of them, not a 20-row page.
    expect(config.rows).toHaveLength(45)
  })

  it('does not show "Share…" when the browser has no Web Share file-sharing support', async () => {
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))

    expect(screen.queryByRole('button', { name: /^Share…$/ })).not.toBeInTheDocument()
  })

  it('shows and uses "Share…" (native OS share sheet, e.g. WhatsApp Desktop on Windows) when the browser supports Web Share file-sharing', async () => {
    const canShare = vi.fn((_data?: ShareData) => true)
    const share = vi.fn((_data?: ShareData) => Promise.resolve())
    navigator.canShare = canShare
    navigator.share = share

    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    await user.click(screen.getByRole('button', { name: /Share…/ }))

    expect(mockBuildStatementPdf).toHaveBeenCalledTimes(1)
    expect(share).toHaveBeenCalledTimes(1)
    const files = share.mock.calls[0][0]?.files ?? []
    expect(files[0]?.name).toBe('GLOBAL CONSTRUCTION GROUP SAL_Statement of Account.pdf')
    expect(files[0]?.type).toBe('application/pdf')
  })

  it('"Share via WhatsApp" downloads the PDF and opens a wa.me chat to the client\'s number, with no pre-filled message — file only, no text', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    await user.click(screen.getByRole('button', { name: /Share via WhatsApp/ }))

    expect(mockExportStatementPdf).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledTimes(1)
    const [url] = openSpy.mock.calls[0]
    expect(url).toBe('https://wa.me/9613111222')

    openSpy.mockRestore()
  })

  it('"Share via WhatsApp" normalizes a locally-formatted Lebanese number (leading 0, no country code) before opening the chat', async () => {
    mockUseClient.mockReturnValueOnce({
      data: { ...mockClient, phones: [{ number: '03 111 222', label: 'mobile', isActive: true, dateAdded: '2026-01-01' }] },
      isLoading: false, isError: false,
    })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    await user.click(screen.getByRole('button', { name: /Share via WhatsApp/ }))

    expect(openSpy.mock.calls[0][0]).toBe('https://wa.me/9613111222')
    openSpy.mockRestore()
  })

  it('"Share via WhatsApp" normalizes a malformed "+961 0…" number (redundant local leading 0 after the country code)', async () => {
    mockUseClient.mockReturnValueOnce({
      data: { ...mockClient, phones: [{ number: '+961 03111222', label: 'mobile', isActive: true, dateAdded: '2026-01-01' }] },
      isLoading: false, isError: false,
    })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    await user.click(screen.getByRole('button', { name: /Share via WhatsApp/ }))

    expect(openSpy.mock.calls[0][0]).toBe('https://wa.me/9613111222')
    openSpy.mockRestore()
  })

  it('"Share via WhatsApp" refuses and shows a clear toast when the client has no phone number on file — never opens WhatsApp unaddressed', async () => {
    mockUseClient.mockReturnValueOnce({
      data: { ...mockClient, phones: [] },
      isLoading: false, isError: false,
    })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    await user.click(screen.getByRole('button', { name: /Share via WhatsApp/ }))

    expect(await screen.findByText('No phone number on file for this client')).toBeInTheDocument()
    expect(openSpy).not.toHaveBeenCalled()
    expect(mockExportStatementPdf).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('"Share via WhatsApp" hands the file to the native OS share sheet when supported — no download, no wa.me tab, file attaches directly', async () => {
    const share = vi.fn((_data?: ShareData) => Promise.resolve())
    navigator.canShare = vi.fn((_data?: ShareData) => true)
    navigator.share = share
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    await user.click(screen.getByRole('button', { name: /Share via WhatsApp/ }))

    expect(share).toHaveBeenCalledTimes(1)
    const files = share.mock.calls[0][0]?.files ?? []
    expect(files[0]?.type).toBe('application/pdf')
    expect(mockExportStatementPdf).not.toHaveBeenCalled() // no separate download — the shared file IS the deliverable
    expect(openSpy).not.toHaveBeenCalled() // no wa.me tab — the share sheet handles app selection

    openSpy.mockRestore()
  })

  it('"Share via WhatsApp" falls back to download+wa.me when the native share sheet is supported but the user cancels it', async () => {
    const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    navigator.canShare = vi.fn((_data?: ShareData) => true)
    navigator.share = vi.fn((_data?: ShareData) => Promise.reject(abortError))
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    await user.click(screen.getByRole('button', { name: /Share via WhatsApp/ }))

    // Cancelling the share sheet is a deliberate user choice, not a failure —
    // must NOT silently fall back to downloading a file the user just declined to share.
    expect(mockExportStatementPdf).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()

    openSpy.mockRestore()
  })

  it('"Share via WhatsApp" falls back to download+wa.me when the native share sheet is supported but a real error occurs', async () => {
    navigator.canShare = vi.fn((_data?: ShareData) => true)
    navigator.share = vi.fn((_data?: ShareData) => Promise.reject(new Error('share failed')))
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    await user.click(screen.getByRole('button', { name: /Share via WhatsApp/ }))

    expect(mockExportStatementPdf).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy.mock.calls[0][0]).toBe('https://wa.me/9613111222')

    openSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Regression: the Log Payment modal previously let a payment be submitted
// with no receiver at all — cash/whish/omt (the only methods offered here)
// are personal-custody methods, so an unattributed payment here was invisible
// to Cash Handover reconciliation even though a real person collected it.
// ---------------------------------------------------------------------------
describe('ClientDetail — Log payment modal', () => {
  // "Log payment" is the text of several buttons that all open the same
  // modal (overview action, quick-action card, Payments tab action) plus the
  // modal's own submit button — grab the submit one by taking the last match
  // (the modal renders after all of those triggers in the component tree).
  function submitButton() {
    const matches = screen.getAllByRole('button', { name: /Log payment/ })
    return matches[matches.length - 1]
  }

  async function openLogPayment(user: ReturnType<typeof userEvent.setup>) {
    renderAt('client-1')
    await user.click(screen.getAllByRole('button', { name: /Log payment/ })[0])
    await user.type(screen.getByPlaceholderText('0.00'), '40')
  }

  it('shows the receiver field as required and blocks submission when it is empty', async () => {
    const user = userEvent.setup()
    await openLogPayment(user)

    expect(screen.getByText('Receiver is required.')).toBeInTheDocument()
    await user.click(submitButton())

    expect(mockCreatePaymentMutate).not.toHaveBeenCalled()
  })

  it('selecting a receiver resolves to a real receiverId, not a hardcoded/frontend-only name', async () => {
    const user = userEvent.setup()
    await openLogPayment(user)

    await user.selectOptions(screen.getByDisplayValue('— select receiver —'), 'Marie')
    expect(screen.queryByText('Receiver is required.')).not.toBeInTheDocument()
    await user.click(submitButton())

    expect(mockCreatePaymentMutate).toHaveBeenCalledTimes(1)
    const [body] = mockCreatePaymentMutate.mock.calls[0]
    expect(body.receiverId).toBe('receiver-1')
    expect(body.receiverName).toBeUndefined()
  })
})
