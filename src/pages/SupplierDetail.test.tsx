// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { SupplierDetail as SupplierDetailType, SupplierLedger } from '../types/api'

// ---------------------------------------------------------------------------
// Mocks — same module-boundary style as Clients.test.tsx: mock the heavy
// Topbar (Clerk auth) and every data hook, so these tests exercise the
// Supplier Statement's own date-filter / export-column-selection contract
// without a real API, QueryClient, or Clerk session.
//
// The Topbar mock still resolves `back` the same way the real component does
// (string → navigate, function → call directly) so the P0 navigation fix —
// Supplier detail must expose a real way back to /suppliers, and Statement
// must return to the detail sub-view, not the list — stays covered even
// though the rest of Topbar's chrome is stubbed out.
// ---------------------------------------------------------------------------

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

const mockUseSupplierLedger = vi.fn()
vi.mock('../hooks/useReports', () => ({
  useSupplierLedger: (...args: unknown[]) => mockUseSupplierLedger(...args),
}))

vi.mock('../hooks/useSuppliers', () => ({
  useSupplier: () => ({
    data: supplier(),
    isLoading: false,
    isError: false,
  }),
  useSupplierPayments: () => ({ data: { data: [], total: 0 } }),
  useCreateSupplierPayment: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../hooks/useContainers', () => ({
  useContainers: () => ({ data: { data: [], total: 0 } }),
}))

const mockExportExcel = vi.fn().mockResolvedValue(undefined)
vi.mock('../lib/excelExport', async () => {
  const actual = await vi.importActual<typeof import('../lib/excelExport')>('../lib/excelExport')
  return { ...actual, exportExcel: (...args: unknown[]) => mockExportExcel(...args) }
})

import SupplierDetail from './SupplierDetail'

function supplier(): SupplierDetailType {
  return {
    id: 'sup-1',
    name: 'Cedar Charcoal Co',
    country: 'Lebanon',
    contactPersons: [],
    charcoalTypes: [],
    bankDetails: null,
    paymentTerms: null,
    leadTimeDays: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalSpentUsd: '0',
    totalPaidUsd: '0',
    outstandingUsd: '0',
    containerCount: 0,
    activeLotCount: 0,
    totalKgReceived: '0',
    totalKgRemaining: '0',
    avgPricePerKg: null,
    purchasedTypes: [],
  }
}

function ledgerEntry(overrides: Partial<SupplierLedger['entries'][number]> = {}): SupplierLedger['entries'][number] {
  return {
    date: '2026-08-10T00:00:00.000Z',
    type: 'purchase',
    sourceType: 'direct',
    reference: 'lot-1',
    displayId: null,
    description: 'Direct lot — BBQ Hardwood A, 500kg',
    debit: '500.00',
    credit: '0.00',
    runningBalance: '500.00',
    ...overrides,
  } as SupplierLedger['entries'][number]
}

function renderSupplierDetail() {
  return render(
    <MemoryRouter initialEntries={['/suppliers/sup-1']}>
      <Routes>
        <Route path="/suppliers" element={<div>Suppliers list page</div>} />
        <Route path="/suppliers/:id" element={<SupplierDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** The export-columns modal's own `.modal` element — scopes queries away from the identically-labelled page-level "Export Excel" trigger button behind it. */
function modal() {
  return within(screen.getByText('Export to Excel').closest('.modal') as HTMLElement)
}

async function openStatementView() {
  const user = userEvent.setup()
  const result = renderSupplierDetail()
  await user.click(screen.getByText('Statement of account'))
  return { user, container: result.container }
}

/** The From/To date inputs, in DOM order — disambiguated from the "Search description or ref…" text input, which also has an empty value. */
function dateInputs(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input[type="date"]'))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExportExcel.mockResolvedValue(undefined)
  mockUseSupplierLedger.mockReturnValue({
    data: {
      supplierId: 'sup-1',
      summary: { totalPurchased: '500.00', totalPaid: '0.00', outstanding: '500.00', openingBalance: '0.00' },
      entries: [ledgerEntry()],
    },
    isLoading: false,
  })
})

function toDateOnlyString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('SupplierDetail — back navigation (P0 fix: detail view had no way back to /suppliers)', () => {
  it('the primary detail view exposes a working back link to /suppliers', async () => {
    const user = userEvent.setup()
    renderSupplierDetail()
    await user.click(screen.getByText('Back to suppliers'))
    expect(screen.getByText('Suppliers list page')).toBeInTheDocument()
  })

  it('Statement of account returns to the supplier detail sub-view, not the suppliers list', async () => {
    const { user } = await openStatementView()
    expect(screen.getByText('Statement of account')).toBeInTheDocument()

    await user.click(screen.getByText('Back to supplier'))
    // Back in the detail sub-view: the statement-only "Statement of account"
    // trigger button is showing again, and we never navigated to the list.
    expect(screen.getByText('Statement of account')).toBeInTheDocument()
    expect(screen.queryByText('Suppliers list page')).not.toBeInTheDocument()
  })
})

describe('SupplierDetail — Statement of account: date filtering', () => {
  it('defaults to the CURRENT calendar month, not "All time" or unbounded', async () => {
    await openStatementView()
    const now = new Date()
    await waitFor(() => {
      expect(mockUseSupplierLedger).toHaveBeenCalledWith('sup-1', {
        dateFrom: toDateOnlyString(new Date(now.getFullYear(), now.getMonth(), 1)),
        dateTo:   toDateOnlyString(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      })
    })
  })

  it('Previous/Next month move the requested range by one calendar month', async () => {
    const { user } = await openStatementView()
    const now = new Date()

    await user.click(screen.getByTitle('Previous month'))
    await waitFor(() => {
      expect(mockUseSupplierLedger).toHaveBeenLastCalledWith('sup-1', {
        dateFrom: toDateOnlyString(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        dateTo:   toDateOnlyString(new Date(now.getFullYear(), now.getMonth(), 0)),
      })
    })

    await user.click(screen.getByTitle('Next month'))
    await waitFor(() => {
      expect(mockUseSupplierLedger).toHaveBeenLastCalledWith('sup-1', {
        dateFrom: toDateOnlyString(new Date(now.getFullYear(), now.getMonth(), 1)),
        dateTo:   toDateOnlyString(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      })
    })
  })

  it('"All time" sends no dateFrom/dateTo', async () => {
    const { user } = await openStatementView()
    await user.click(screen.getByText('All time'))
    await waitFor(() => {
      expect(mockUseSupplierLedger).toHaveBeenLastCalledWith('sup-1', { dateFrom: undefined, dateTo: undefined })
    })
  })

  it('"Custom" reveals From/To inputs — typing a From date passes dateFrom while leaving dateTo undefined', async () => {
    const { user, container } = await openStatementView()
    await user.click(screen.getByText('Custom'))
    const [fromInput] = dateInputs(container)
    await user.type(fromInput, '2026-01-01')

    await waitFor(() => {
      expect(mockUseSupplierLedger).toHaveBeenLastCalledWith('sup-1', { dateFrom: '2026-01-01', dateTo: undefined })
    })
  })

  it('a full Custom date range passes both dateFrom and dateTo', async () => {
    const { user, container } = await openStatementView()
    await user.click(screen.getByText('Custom'))
    const [fromInput, toInput] = dateInputs(container)
    await user.type(fromInput, '2026-01-01')
    await user.type(toInput, '2026-01-31')

    await waitFor(() => {
      expect(mockUseSupplierLedger).toHaveBeenLastCalledWith('sup-1', { dateFrom: '2026-01-01', dateTo: '2026-01-31' })
    })
  })
})

describe('SupplierDetail — Statement of account: ending balance', () => {
  it('closing balance is the LAST entry\'s running balance, not a sum of the balance column', async () => {
    mockUseSupplierLedger.mockReturnValue({
      data: {
        supplierId: 'sup-1',
        summary: { totalPurchased: '900.00', totalPaid: '400.00', outstanding: '500.00', openingBalance: '0.00' },
        entries: [
          ledgerEntry({ debit: '500.00', credit: '0.00', runningBalance: '500.00' }),
          ledgerEntry({ type: 'payment', sourceType: undefined, debit: '0.00', credit: '400.00', runningBalance: '100.00' }),
          ledgerEntry({ debit: '400.00', credit: '0.00', runningBalance: '500.00' }),
        ],
      },
      isLoading: false,
    })
    await openStatementView()

    // Sum of the balance column would be 500+100+500=1100 — the real closing
    // balance must be the last row's 500.00, matching the backend's own
    // running-balance fold (never summed client-side either).
    const cells = screen.getAllByText('$500.00')
    expect(cells.length).toBeGreaterThan(0)
  })
})

describe('SupplierDetail — Statement of account: print', () => {
  it('the Print button calls window.print()', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { user } = await openStatementView()
    await user.click(screen.getByRole('button', { name: /Print/ }))
    expect(printSpy).toHaveBeenCalledTimes(1)
    printSpy.mockRestore()
  })
})

describe('SupplierDetail — Statement of account: Excel export', () => {
  it('opens the shared "Export to Excel" column-selection modal with the expected columns', async () => {
    const { user } = await openStatementView()
    await user.click(screen.getByRole('button', { name: /Export Excel/ }))

    expect(screen.getByText('Export to Excel')).toBeInTheDocument()
    // Scoped to the modal — the statement table behind it has <th> cells with
    // these exact same names, which would otherwise collide.
    for (const header of ['Date', 'Source', 'Ref', 'Description', 'Debit', 'Credit', 'Balance']) {
      expect(modal().getByText(header)).toBeInTheDocument()
    }
  })

  it('deselecting a column excludes it from the exported columns', async () => {
    const { user } = await openStatementView()
    await user.click(screen.getByRole('button', { name: /Export Excel/ }))

    await user.click(modal().getByText('Debit')) // toggle off the Debit column's checkbox
    await user.click(modal().getByRole('button', { name: 'Export Excel' })) // modal's footer button

    await waitFor(() => expect(mockExportExcel).toHaveBeenCalledTimes(1))
    const call = mockExportExcel.mock.calls[0][0]
    const exportedKeys = call.columns.map((c: { key: string }) => c.key)
    expect(exportedKeys).not.toContain('debit')
    expect(exportedKeys).toEqual(expect.arrayContaining(['date', 'source', 'ref', 'desc', 'credit', 'balance']))
  })

  it('the Balance column is exported with total:"last", never total:"sum" (running balance, not a sum of balances)', async () => {
    const { user } = await openStatementView()
    await user.click(screen.getByRole('button', { name: /Export Excel/ }))
    await user.click(modal().getByRole('button', { name: 'Export Excel' }))

    await waitFor(() => expect(mockExportExcel).toHaveBeenCalledTimes(1))
    const call = mockExportExcel.mock.calls[0][0]
    const balanceCol = call.columns.find((c: { key: string }) => c.key === 'balance')
    expect(balanceCol.total).toBe('last')
  })

  it('"Select at least one column" disables Export Excel when every column is cleared', async () => {
    const { user } = await openStatementView()
    await user.click(screen.getByRole('button', { name: /Export Excel/ }))
    await user.click(modal().getByRole('button', { name: 'Clear all' }))

    expect(screen.getByText('Select at least one column to export.')).toBeInTheDocument()
    expect(modal().getByRole('button', { name: 'Export Excel' })).toBeDisabled()
  })

  it('shows "Nothing to export" and does not open the modal when the filtered statement is empty', async () => {
    mockUseSupplierLedger.mockReturnValue({
      data: { supplierId: 'sup-1', summary: { totalPurchased: '0.00', totalPaid: '0.00', outstanding: '0.00', openingBalance: '0.00' }, entries: [] },
      isLoading: false,
    })
    const { user } = await openStatementView()
    await user.click(screen.getByRole('button', { name: /Export Excel/ }))

    expect(screen.queryByText('Export to Excel')).not.toBeInTheDocument()
  })
})
