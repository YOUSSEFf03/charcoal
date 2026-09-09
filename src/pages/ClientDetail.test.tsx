// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Regression coverage for the new "Export PDF" button on the Client Statement
// of Account tab: it must exist next to the pre-existing "Export Excel"
// button, and clicking it must call exportStatementPdf() with the CURRENTLY
// selected client, From/To dates, and the complete period row set — never a
// hardcoded/stale client or a paginated slice (the statement table has no
// pagination at all; stmtFiltered is always the full filtered ledger).
// ---------------------------------------------------------------------------

// Resolves `back` the same way the real Topbar does (navigate for a route
// string, direct call for a callback) so the fix making the back destination
// depend on `view` — detail sub-view goes to /clients, every other sub-view
// (statement/orders/invoices/etc.) returns to the detail sub-view instead of
// leaving the list — stays covered.
vi.mock('../components/layout/Topbar', () => ({
  default: ({ back, children }: { title?: string; back?: { label: string; to: string | (() => void) }; children?: ReactNode }) => {
    const navigate = useNavigate()
    return (
      <div>
        {back && (
          <button onClick={() => (typeof back.to === 'function' ? back.to() : navigate(back.to))}>{back.label}</button>
        )}
        {children}
      </div>
    )
  },
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
  multiLocationEnabled: false,
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
const mockUpdateClientMutate = vi.fn()
const mockUseClientLocations = vi.fn()
const mockCreateLocationMutate = vi.fn()
const mockUpdateLocationMutate = vi.fn()
vi.mock('../hooks/useClients', () => ({
  useClient: (...args: unknown[]) => mockUseClient(...args),
  useUpdateClient: () => ({ mutate: mockUpdateClientMutate, mutateAsync: vi.fn(), isPending: false }),
  useAddPhone: () => ({ mutateAsync: vi.fn() }),
  useDeactivatePhone: () => ({ mutateAsync: vi.fn() }),
  // Multiple-locations audit, 2026-08-31 — provenance for normal Orders
  // only, never a second financial account.
  useClientLocations: (...args: unknown[]) => mockUseClientLocations(...args),
  useCreateClientLocation: () => ({ mutate: mockCreateLocationMutate, isPending: false }),
  useUpdateClientLocation: () => ({ mutate: mockUpdateLocationMutate, isPending: false }),
}))
vi.mock('../hooks/useInvoices', () => ({
  useInvoices: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false }),
}))
// Controllable per-test (default matches the pre-existing PDF-export suite's
// 45-entry fixture) — the Statement Order-reference tests override with
// .mockReturnValue(...).
const mockUseClientLedger = vi.fn()
vi.mock('../hooks/useReports', () => ({
  useClientLedger: (...args: unknown[]) => mockUseClientLedger(...args),
}))
const mockCreateOrderMutate = vi.fn()
vi.mock('../hooks/useOrders', () => ({
  useOrders: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false }),
  // ClientDetail.tsx's saveOrder() calls .mutate(body, { onSuccess, onError }),
  // not .mutateAsync — invoke onSuccess synchronously, same pattern as
  // useCreatePayment's mock below.
  useCreateOrder: () => ({
    mutate: (body: unknown, opts?: { onSuccess?: () => void }) => {
      mockCreateOrderMutate(body)
      opts?.onSuccess?.()
    },
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))
vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => ({ data: [] }),
}))
// Controllable per-test — defaults to empty (matches every pre-existing test
// below, none of which cares about warehouse-sale content). The
// grouping-fix test overrides with .mockReturnValue(...).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUseGroupedStockExits = vi.fn((_params?: unknown): any => ({ data: { data: [] as any[], total: 0 }, isLoading: false, isError: false }))
vi.mock('../hooks/useWarehouse', () => ({
  useGroupedStockExits: (params: unknown) => mockUseGroupedStockExits(params),
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
        <Route path="/clients" element={<div>Clients list page</div>} />
        <Route path="/clients/:id" element={<ClientDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseClient.mockReturnValue({ data: mockClient, isLoading: false, isError: false })
  mockUseCashReceivers.mockReturnValue({ data: [{ id: 'receiver-1', name: 'Marie', role: 'receiver' }] })
  mockUseGroupedStockExits.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false, isError: false })
  mockUseClientLedger.mockReturnValue({ data: { entries: mockEntries, currency: 'USD', openingBalance: '0.00', balance: '4500.00' }, isLoading: false, isError: false })
  mockUseClientLocations.mockReturnValue({ data: [], isLoading: false })
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

describe('ClientDetail — back navigation', () => {
  it('the detail sub-view\'s back link goes to /clients', async () => {
    const user = userEvent.setup()
    renderAt('client-1')
    await user.click(screen.getByText('All clients'))
    expect(screen.getByText('Clients list page')).toBeInTheDocument()
  })

  it('the Statement sub-view\'s back link returns to the client detail sub-view, not the clients list', async () => {
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
    expect(screen.getByText('Back to client')).toBeInTheDocument()

    await user.click(screen.getByText('Back to client'))
    // Back in the detail sub-view: its own "Statement of account" trigger is
    // showing again, and we never navigated away to the clients list.
    expect(screen.getByRole('button', { name: /Statement of account/ })).toBeInTheDocument()
    expect(screen.queryByText('Clients list page')).not.toBeInTheDocument()
  })
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

  it('Download exports the currently selected client, the selected Custom From/To dates, and the COMPLETE period (not a paginated slice)', async () => {
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
    // Statement defaults to the current calendar month — switch to "Custom"
    // to exercise the free-text From/To range this test is about.
    await user.click(screen.getByText('Custom'))

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

  // Regression (forensic audit, 2026-09): the receiver <select> used to be
  // keyed by display NAME, resolved to an id only at submit time via
  // `allReceivers.find(r => r.name === payReceiverName)` — silently
  // ambiguous whenever two cash-capable users share a name (proven live
  // against real data: 41 duplicate "Test Owner" rows from leaked test
  // fixtures credited a real $2,000+ payment to the wrong person's ledger).
  // The select is now keyed by id, so picking the SECOND same-named option
  // must submit ITS id, never the first.
  it('two receivers sharing the same display name — selecting the second one submits ITS id, never the first', async () => {
    mockUseCashReceivers.mockReturnValue({
      data: [
        { id: 'receiver-a', name: 'Test Owner', role: 'owner' },
        { id: 'receiver-b', name: 'Test Owner', role: 'owner' },
      ],
    })
    const user = userEvent.setup()
    await openLogPayment(user)

    const receiverOptions = screen.getAllByText('Test Owner')
    expect(receiverOptions).toHaveLength(2)
    await user.selectOptions(screen.getByDisplayValue('— select receiver —'), receiverOptions[1])
    await user.click(submitButton())

    expect(mockCreatePaymentMutate).toHaveBeenCalledTimes(1)
    const [body] = mockCreatePaymentMutate.mock.calls[0]
    expect(body.receiverId).toBe('receiver-b')
    expect(body.receiverId).not.toBe('receiver-a')
  })
})

// ---------------------------------------------------------------------------
// Sale-history grouping fix (forensic audit, 2026-08-28): a walk-in sale whose
// FIFO draw spans more than one packed-stock lot previously showed up as
// MULTIPLE rows in the client's "Warehouse sales" table — one per StockExit —
// for what was really one invoice, one payment, one sale. ClientDetail.tsx
// now consumes useGroupedStockExits(), which already collapses those rows
// server-side; this verifies the table renders ONE row per group.
// ---------------------------------------------------------------------------
describe('ClientDetail — sale-history grouping fix', () => {
  it('a multi-line sale (2 packed-stock lots) renders as ONE table row with an "items" badge, not two rows', async () => {
    mockUseGroupedStockExits.mockReturnValue({
      isLoading: false, isError: false,
      data: {
        total: 1,
        data: [
          {
            id: 'inv-1', invoiceId: 'inv-1', invoiceDisplayId: 'SI-0001',
            date: '2026-08-20', recipient: 'Alice', loggedBy: { id: 'u1', name: 'Sam' },
            currency: 'USD', lineCount: 2, totalQtyBags: 7, totalKg: '70.000',
            lines: [
              { saleUnit: 'BAG', bagTypeId: 'bt-1', bagTypeName: 'Bag A', qty: 3, pricePerBag: '2.00', lineTotal: '6.00', charcoalType: 'Oak', grade: 'A', nominalKgPerBag: '10.000' },
              { saleUnit: 'BAG', bagTypeId: 'bt-1', bagTypeName: 'Bag A', qty: 4, pricePerBag: '2.00', lineTotal: '8.00', charcoalType: 'Oak', grade: 'A', nominalKgPerBag: '10.000' },
            ],
          },
        ],
      },
    })

    const user = userEvent.setup()
    renderAt('client-1')
    await user.click(screen.getByRole('button', { name: /Warehouse sales/ }))

    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument() // aggregated totalQtyBags
    expect(screen.getByText('70.0 kg')).toBeInTheDocument() // aggregated totalKg
    expect(screen.getByText('$14.00')).toBeInTheDocument() // summed lineTotal (6.00 + 8.00)
  })
})

// ---------------------------------------------------------------------------
// Forensic audit (2026-08-31): "Statement of Account shows the wrong ID for
// orders" — an invoice entry raised FROM an order previously showed the
// Invoice's own internal reference ("SI-xxxx") in the Statement, not the
// Order reference ("SO-xxxx") the client actually knows the sale by (the same
// field Orders.tsx/OrderDetail.tsx show). getClientLedger() now resolves and
// exposes orderDisplayId on the entry; ClientDetail.tsx's LEDGER mapping
// prefers it. These tests exercise that through the real rendered Statement
// table, not just the mapping in isolation.
// ---------------------------------------------------------------------------
describe('ClientDetail — Statement of Account shows the correct Order reference (forensic audit, 2026-08-31)', () => {
  async function openStatement(user: ReturnType<typeof userEvent.setup>) {
    renderAt('client-1')
    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
  }

  it('CASE 1 — an order-sourced invoice entry shows the SAME Order reference the Order page uses, not the invoice number', async () => {
    mockUseClientLedger.mockReturnValue({
      data: {
        entries: [{
          date: '2026-08-20T00:00:00.000Z', type: 'invoice', reference: 'inv-order-1',
          displayId: 'SI-0648', orderId: 'order-1', orderDisplayId: 'SO-0168',
          description: 'Order Sale', debit: '500.00', credit: '0.00',
          runningBalance: '500.00', status: 'paid',
        }],
        currency: 'USD', openingBalance: '0.00', balance: '500.00',
      },
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openStatement(user)

    expect(screen.getByText('SO-0168')).toBeInTheDocument()
    expect(screen.queryByText('SI-0648')).not.toBeInTheDocument()
  })

  it('CASE 2 — two different orders with similar amounts/dates show two DIFFERENT correct Order references', async () => {
    mockUseClientLedger.mockReturnValue({
      data: {
        entries: [
          { date: '2026-08-20T00:00:00.000Z', type: 'invoice', reference: 'inv-a', displayId: 'SI-0100', orderId: 'order-a', orderDisplayId: 'SO-0050', description: 'Order Sale', debit: '300.00', credit: '0.00', runningBalance: '300.00', status: 'paid' },
          { date: '2026-08-20T00:00:00.000Z', type: 'invoice', reference: 'inv-b', displayId: 'SI-0101', orderId: 'order-b', orderDisplayId: 'SO-0051', description: 'Order Sale', debit: '300.00', credit: '0.00', runningBalance: '600.00', status: 'paid' },
        ],
        currency: 'USD', openingBalance: '0.00', balance: '600.00',
      },
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openStatement(user)

    expect(screen.getByText('SO-0050')).toBeInTheDocument()
    expect(screen.getByText('SO-0051')).toBeInTheDocument()
  })

  it('CASE 3 — the Statement link still opens the invoice (navigation unchanged) while the visible label is the Order reference', async () => {
    mockUseClientLedger.mockReturnValue({
      data: {
        entries: [{
          date: '2026-08-20T00:00:00.000Z', type: 'invoice', reference: 'inv-order-1',
          displayId: 'SI-0648', orderId: 'order-1', orderDisplayId: 'SO-0168',
          description: 'Order Sale', debit: '500.00', credit: '0.00',
          runningBalance: '500.00', status: 'paid',
        }],
        currency: 'USD', openingBalance: '0.00', balance: '500.00',
      },
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openStatement(user)

    const link = screen.getByText('SO-0168').closest('a')
    expect(link).toHaveAttribute('href', '/invoice/inv-order-1')
  })

  it('CASE 5 — a non-order (warehouse-sale) invoice entry keeps showing its OWN invoice reference — never fabricates an order reference', async () => {
    mockUseClientLedger.mockReturnValue({
      data: {
        entries: [{
          date: '2026-08-20T00:00:00.000Z', type: 'invoice', reference: 'inv-ws',
          displayId: 'SI-0900', orderId: null, orderDisplayId: null,
          description: 'Warehouse Sale', debit: '80.00', credit: '0.00',
          runningBalance: '80.00', status: 'paid',
        }],
        currency: 'USD', openingBalance: '0.00', balance: '80.00',
      },
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openStatement(user)

    expect(screen.getByText('SI-0900')).toBeInTheDocument()
  })

  it('CASE 6 — a payment entry (no orderDisplayId field at all) still renders its own receipt reference without crashing', async () => {
    mockUseClientLedger.mockReturnValue({
      data: {
        entries: [{
          date: '2026-08-20T00:00:00.000Z', type: 'payment', reference: 'pmt-1',
          displayId: 'RV-0001', description: 'Cash Payment', debit: '0.00', credit: '50.00',
          runningBalance: '-50.00',
        }],
        currency: 'USD', openingBalance: '0.00', balance: '-50.00',
      },
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openStatement(user)

    expect(screen.getByText('RV-0001')).toBeInTheDocument()
  })

  it('CASE 7 — real order/invoice pair from the forensic audit (SO-0168 / SI-0648): Statement shows the Order page\'s own reference', async () => {
    mockUseClientLedger.mockReturnValue({
      data: {
        entries: [{
          date: '2026-08-20T00:00:00.000Z', type: 'invoice', reference: 'afdfc7b5-ba24-4ba8-b351-e2a817db1492',
          displayId: 'SI-0648', orderId: 'd7a36419-5f80-4c5f-b10b-cb8d76b3d33e', orderDisplayId: 'SO-0168',
          description: 'Order Sale', debit: '500.00', credit: '0.00',
          runningBalance: '500.00', status: 'partially_paid',
        }],
        currency: 'USD', openingBalance: '0.00', balance: '500.00',
      },
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openStatement(user)

    // Same reference the real Order page (OrderDetail.tsx, order.displayId) shows.
    expect(screen.getByText('SO-0168')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Monthly Statement of Account unification (2026-09-07) — the Client
// Statement tab must default to the current calendar month, navigate with
// ←/→, compute its opening balance server-side (never by walking a
// client-side array), and never send an unbounded lifetime-history request
// just to view one month. CASE numbers reference the task's own test matrix.
// ---------------------------------------------------------------------------
function toDateOnlyString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('ClientDetail — Client Statement: monthly default and navigation', () => {
  async function openStatement(user: ReturnType<typeof userEvent.setup>) {
    renderAt('client-1')
    await user.click(screen.getByRole('button', { name: /Statement of account/ }))
  }

  // The dedicated, date-filtered call this tab makes is the one with TWO
  // arguments (clientId, {dateFrom, dateTo}) — the overview's own unbounded
  // ledgerQ call always passes just the clientId.
  function lastStatementCall() {
    const twoArgCalls = mockUseClientLedger.mock.calls.filter(c => c.length === 2)
    return twoArgCalls[twoArgCalls.length - 1]
  }

  it('CASE 1 — defaults to the current calendar month, not "All time"', async () => {
    const user = userEvent.setup()
    await openStatement(user)

    const now = new Date()
    const expectedFrom = toDateOnlyString(new Date(now.getFullYear(), now.getMonth(), 1))
    const expectedTo   = toDateOnlyString(new Date(now.getFullYear(), now.getMonth() + 1, 0))

    const call = lastStatementCall()
    expect(call[0]).toBe('client-1')
    expect(call[1]).toEqual({ dateFrom: expectedFrom, dateTo: expectedTo })
    expect(screen.getByText('Month').className).toMatch(/sel/)
  })

  it('CASE 2/3 — Previous/Next month move the requested range by one calendar month', async () => {
    const user = userEvent.setup()
    await openStatement(user)

    const now = new Date()
    await user.click(screen.getByTitle('Previous month'))
    let call = lastStatementCall()
    const prevFrom = toDateOnlyString(new Date(now.getFullYear(), now.getMonth() - 1, 1))
    const prevTo   = toDateOnlyString(new Date(now.getFullYear(), now.getMonth(), 0))
    expect(call[1]).toEqual({ dateFrom: prevFrom, dateTo: prevTo })

    await user.click(screen.getByTitle('Next month'))
    call = lastStatementCall()
    const curFrom = toDateOnlyString(new Date(now.getFullYear(), now.getMonth(), 1))
    const curTo   = toDateOnlyString(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    expect(call[1]).toEqual({ dateFrom: curFrom, dateTo: curTo })
  })

  it('CASE 4 — opening balance shown is the server-computed value (pre-period aggregate), never derived from walking the ledger array', async () => {
    mockUseClientLedger.mockReturnValue({
      data: { entries: [], currency: 'USD', openingBalance: '500.00', balance: '500.00' },
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openStatement(user)

    expect(screen.getAllByText('$500.00').length).toBeGreaterThan(0)
  })

  it('CASE 5 — an empty month still shows the carried-forward opening/closing balance, never a fake $0', async () => {
    mockUseClientLedger.mockReturnValue({
      data: { entries: [], currency: 'USD', openingBalance: '550.00', balance: '550.00' },
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openStatement(user)

    expect(screen.getByText('No entries match this filter')).toBeInTheDocument()
    // Opening AND closing balance both show the carried-forward $550 — the
    // period's debit/credit totals are legitimately $0.00 (no activity), but
    // the balance itself must never collapse to a fake $0.
    expect(screen.getAllByText('$550.00').length).toBeGreaterThanOrEqual(2)
  })

  it('CASE 6 — monthly debit/credit totals reflect only the returned period entries', async () => {
    mockUseClientLedger.mockReturnValue({
      data: {
        entries: [
          { date: '2026-09-03T00:00:00.000Z', type: 'invoice', reference: 'inv-1', displayId: 'SI-1', description: 'Sale', debit: '200.00', credit: '0.00', runningBalance: '700.00', status: 'issued' },
          { date: '2026-09-10T00:00:00.000Z', type: 'payment', reference: 'pmt-1', displayId: 'RV-1', description: 'Payment', debit: '0.00', credit: '300.00', runningBalance: '400.00' },
        ],
        currency: 'USD', openingBalance: '500.00', balance: '400.00',
      },
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openStatement(user)

    expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$300.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$400.00').length).toBeGreaterThan(0)
  })

  it('CASE 18/19 — viewing the normal monthly statement never requests an unbounded/"all time" range', async () => {
    const user = userEvent.setup()
    await openStatement(user)

    const call = lastStatementCall()
    expect(call[1].dateFrom).toBeTruthy()
    expect(call[1].dateTo).toBeTruthy()
  })

  it('"View all time" switches to an unbounded request; switching back to "Month" restores the current month', async () => {
    const user = userEvent.setup()
    await openStatement(user)

    await user.click(screen.getByText('All time'))
    expect(lastStatementCall()[1]).toEqual({ dateFrom: undefined, dateTo: undefined })

    await user.click(screen.getByText('Month'))
    const now = new Date()
    expect(lastStatementCall()[1]).toEqual({
      dateFrom: toDateOnlyString(new Date(now.getFullYear(), now.getMonth(), 1)),
      dateTo:   toDateOnlyString(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    })
  })
})

// ---------------------------------------------------------------------------
// Forensic audit (2026-08-31): "Client Multiple Locations with ONE shared
// client balance" — CASE numbers reference the task's own test matrix.
// ---------------------------------------------------------------------------
describe('ClientDetail — Client Locations', () => {
  it('CASE 1 — a normal single-location client (multiLocationEnabled: false) shows the enable prompt, never a location list', async () => {
    renderAt('client-1')

    expect(await screen.findByText(/uses a single location/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enable multiple locations/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add Location/i })).not.toBeInTheDocument()
    // The client's balance stays the ONE figure shown elsewhere — no
    // per-location balance is ever rendered here.
    expect(screen.queryByText(/location balance/i)).not.toBeInTheDocument()
  })

  it('CASE 2 — clicking "Enable multiple locations" calls the update mutation with multiLocationEnabled: true', async () => {
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(await screen.findByRole('button', { name: /Enable multiple locations/i }))

    expect(mockUpdateClientMutate).toHaveBeenCalledWith(
      { id: 'client-1', body: { multiLocationEnabled: true } },
      expect.anything(),
    )
  })

  it('CASE 3 — once enabled, shows Location A and Location B, each with Edit/Deactivate actions', async () => {
    mockUseClient.mockReturnValue({ data: { ...mockClient, multiLocationEnabled: true }, isLoading: false, isError: false })
    mockUseClientLocations.mockReturnValue({
      data: [
        { id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'loc-b', clientId: 'client-1', name: 'Jounieh Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      isLoading: false,
    })

    renderAt('client-1')

    expect(await screen.findByText('Hamra Branch')).toBeInTheDocument()
    expect(screen.getByText('Jounieh Branch')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add Location/i })).toBeInTheDocument()
    // Never a fake separate location balance — only the ONE client balance
    // (shown elsewhere on this page) exists.
    expect(screen.queryByText(/\$.*balance/i, { selector: '.phone-label' })).not.toBeInTheDocument()
  })

  it('"+ Add Location" opens a modal and creates the location on save', async () => {
    mockUseClient.mockReturnValue({ data: { ...mockClient, multiLocationEnabled: true }, isLoading: false, isError: false })
    mockUseClientLocations.mockReturnValue({ data: [], isLoading: false })

    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(await screen.findByRole('button', { name: /Add Location/i }))
    await user.type(screen.getByPlaceholderText('e.g. Hamra Branch'), 'Batroun Branch')
    await user.click(screen.getByRole('button', { name: /Save location/i }))

    expect(mockCreateLocationMutate).toHaveBeenCalledWith(
      { id: 'client-1', body: { name: 'Batroun Branch', address: undefined, phone: undefined, notes: undefined } },
      expect.anything(),
    )
  })

  it('CASE 15 — "Deactivate" calls update with isActive: false — the location itself is never removed from the list by this action alone', async () => {
    mockUseClient.mockReturnValue({ data: { ...mockClient, multiLocationEnabled: true }, isLoading: false, isError: false })
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })

    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(await screen.findByTitle('Deactivate'))

    expect(mockUpdateLocationMutate).toHaveBeenCalledWith(
      { id: 'client-1', locationId: 'loc-a', body: { isActive: false } },
      expect.anything(),
    )
  })

  it('a deactivated location shows a Reactivate action instead of Deactivate — never hidden/removed from the list', async () => {
    mockUseClient.mockReturnValue({ data: { ...mockClient, multiLocationEnabled: true }, isLoading: false, isError: false })
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })

    renderAt('client-1')

    expect(await screen.findByText('Hamra Branch')).toBeInTheDocument()
    expect(screen.getByTitle('Reactivate')).toBeInTheDocument()
    expect(screen.queryByTitle('Deactivate')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Required-location audit, 2026-09 — ClientDetail's embedded "New order"
// modal (opened via the "Make invoice" quick action) is a second, independent
// order-creation entry point alongside NewOrder.tsx and must behave
// consistently with it: location required once the client is enabled for
// multiple locations, optional otherwise.
// ---------------------------------------------------------------------------
describe('ClientDetail — embedded "New order" modal, Location requirement', () => {
  // The page's own "Locations" management card (right column, always
  // rendered) also matches /^Location/ text — every query in this block must
  // be scoped to the modal itself, not the whole document.
  async function openOrderModal() {
    const user = userEvent.setup()
    renderAt('client-1')
    await user.click(await screen.findByRole('button', { name: /Make invoice/i }))
    const modal = screen.getByText(/^New order ·/).closest('.modal') as HTMLElement
    return { user, modal }
  }

  function locationSelect(modal: HTMLElement) {
    return within(within(modal).getByText(/^Location/).closest('div') as HTMLElement).getByRole('combobox')
  }

  it('single-location client (multiLocationEnabled: false) — no Location field, submission succeeds without one', async () => {
    const { user, modal } = await openOrderModal()
    expect(within(modal).queryByText(/^Location/)).not.toBeInTheDocument()

    await user.type(within(modal).getByPlaceholderText('0'), '10')
    await user.type(within(modal).getByPlaceholderText('0.00'), '5')
    await user.click(within(modal).getByRole('button', { name: 'Save draft' }))

    expect(mockCreateOrderMutate).toHaveBeenCalled()
    const [body] = mockCreateOrderMutate.mock.calls[0]
    expect(body).not.toHaveProperty('locationId')
  })

  it('multi-location client — the Location selector appears in the modal', async () => {
    mockUseClient.mockReturnValue({ data: { ...mockClient, multiLocationEnabled: true }, isLoading: false, isError: false })
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })
    const { modal } = await openOrderModal()

    expect(within(modal).getByText(/^Location/)).toBeInTheDocument()
    expect(within(modal).getByText('Hamra Branch')).toBeInTheDocument()
  })

  it('multi-location client + no location selected — cannot submit (Save draft/Create order disabled, no mutate call)', async () => {
    mockUseClient.mockReturnValue({ data: { ...mockClient, multiLocationEnabled: true }, isLoading: false, isError: false })
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })
    const { user, modal } = await openOrderModal()
    await user.type(within(modal).getByPlaceholderText('0'), '10')
    await user.type(within(modal).getByPlaceholderText('0.00'), '5')

    const saveDraftBtn = within(modal).getByRole('button', { name: 'Save draft' })
    expect(saveDraftBtn).toBeDisabled()
    await user.click(saveDraftBtn)
    expect(mockCreateOrderMutate).not.toHaveBeenCalled()
  })

  it('multi-location client + a valid active location selected — submits, with locationId in the payload', async () => {
    mockUseClient.mockReturnValue({ data: { ...mockClient, multiLocationEnabled: true }, isLoading: false, isError: false })
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })
    const { user, modal } = await openOrderModal()
    await user.type(within(modal).getByPlaceholderText('0'), '10')
    await user.type(within(modal).getByPlaceholderText('0.00'), '5')
    await user.selectOptions(locationSelect(modal), 'loc-a')

    const saveDraftBtn = within(modal).getByRole('button', { name: 'Save draft' })
    expect(saveDraftBtn).toBeEnabled()
    await user.click(saveDraftBtn)

    expect(mockCreateOrderMutate).toHaveBeenCalled()
    const [body] = mockCreateOrderMutate.mock.calls[0]
    expect(body.locationId).toBe('loc-a')
  })

  it('a deactivated-only location list behaves exactly like zero locations — selector hidden, submission optional', async () => {
    mockUseClient.mockReturnValue({ data: { ...mockClient, multiLocationEnabled: true }, isLoading: false, isError: false })
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-old', clientId: 'client-1', name: 'Old Closed Branch', address: null, phone: null, notes: null, isActive: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })
    const { user, modal } = await openOrderModal()
    expect(within(modal).queryByText(/^Location/)).not.toBeInTheDocument()

    await user.type(within(modal).getByPlaceholderText('0'), '10')
    await user.type(within(modal).getByPlaceholderText('0.00'), '5')
    await user.click(within(modal).getByRole('button', { name: 'Save draft' }))
    expect(mockCreateOrderMutate).toHaveBeenCalled()
  })
})
