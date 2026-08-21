// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

vi.mock('../hooks/useClients', () => ({
  useClient: () => ({ data: mockClient, isLoading: false, isError: false }),
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
vi.mock('../hooks/usePayments', () => ({
  usePayments: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false }),
  useCreatePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../hooks/useUsers', () => ({
  useCashReceivers: () => ({ data: [] }),
}))

const mockExportStatementPdf = vi.fn()
vi.mock('../lib/statementPdf', () => ({
  exportStatementPdf: (config: unknown) => mockExportStatementPdf(config),
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
})

describe('ClientDetail — Statement of Account PDF export', () => {
  it('shows an "Export PDF" button next to the existing "Export Excel" button on the Statement tab', async () => {
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))

    expect(screen.getByRole('button', { name: /Export PDF/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export Excel/ })).toBeInTheDocument()
  })

  it('exports the currently selected client, the selected From/To dates, and the COMPLETE period (not a paginated slice)', async () => {
    const user = userEvent.setup()
    renderAt('client-1')

    await user.click(screen.getByRole('button', { name: /Statement of account/ }))

    const dateInputs = document.querySelectorAll('input[type="date"]')
    await user.type(dateInputs[0], '2026-07-01')
    await user.type(dateInputs[1], '2026-08-19')

    await user.click(screen.getByRole('button', { name: /Export PDF/ }))

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
})
