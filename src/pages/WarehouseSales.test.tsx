// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WarehouseSales from './WarehouseSales'

// ---------------------------------------------------------------------------
// Forensic-audit regression coverage (2026-08-27): "Warehouse sale created
// twice + receiver account not credited".
//
// Live reproduction against the real dev DB/backend proved two INDEPENDENT
// bugs in the registered-client Warehouse Sale flow:
//
//   1) The "Record this sale" button had no disabled/pending guard (unlike
//      every other submit button in this codebase, which all use
//      `disabled={mutation.isPending}`) and doSubmitSale() had no re-entrancy
//      guard either. Two near-simultaneous POST /walk-in-sales requests (a
//      double-click) each independently succeeded — two full invoices, two
//      stock exits, two payments, double revenue, double stock deducted.
//      Fixed with a synchronous submitInFlightRef guard in submitSale() plus
//      disabling the button while createWalkInSale/createExit/fifoDraw is
//      pending.
//
//   2) The "Received by" field was entirely optional in the UI, and
//      WalkInSalesService never enforced PaymentsService's own
//      RECEIVER_REQUIRED_METHODS rule. A cash/whish/omt sale with no receiver
//      picked was recorded as paid, but nobody's ledger account was ever
//      credited. Fixed server-side (walk-in-sales.service.ts now reuses
//      RECEIVER_REQUIRED_METHODS) and client-side (this file — submitSale()
//      now validates receiverRequired before calling the mutation).
//
// These are two separate root causes, verified independently, and this file
// tests each in isolation.
//
// FOLLOW-UP (same day): bug #1's frontend guard alone is UX protection, not a
// real cross-request guarantee — a second tab, a retrying proxy, or a direct
// API call never passes through submitInFlightRef at all. The real fix is
// server-side: WalkInSalesService.create() now accepts an idempotencyKey and,
// backed by a DB-level unique index, collapses a retried/duplicate request
// into the original result. This file additionally verifies the frontend's
// half of that contract — it generates and sends a stable key, and rotates it
// after each successful submission so two genuinely different sales are never
// accidentally deduplicated. The real dedup guarantee itself is proved by a
// live Postgres concurrency test (test/walk-in-sale-idempotency.integration-spec.ts),
// not here — this file cannot exercise two real concurrent HTTP requests.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

const CLIENT = { id: 'client-1', name: 'Walid Trading', type: 'wholesale', currency: 'USD' }
const BAG_TYPE = { id: 'bag-1', name: '25kg Standard', nominalKg: '25' }
const RECEIVER = { id: 'receiver-1', name: 'Abu Baker', role: 'receiver' }
const PACKED_STOCK_ID = 'ps-1'

const mockCreateWalkInSaleMutateAsync = vi.fn()
let createWalkInSaleIsPending = false

vi.mock('../hooks/useWalkInSales', () => ({
  useCreateWalkInSale: () => ({
    mutateAsync: mockCreateWalkInSaleMutateAsync,
    isPending: createWalkInSaleIsPending,
  }),
}))

const mockFifoDrawMutateAsync = vi.fn()

// Controllable per-test — defaults to empty (matches every pre-existing test
// below, none of which cares about sales-log content). Tests that DO care
// (the grouping-fix suite) override with .mockReturnValue(...).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUseGroupedStockExits = vi.fn((_params?: unknown): any => ({ data: { data: [] as any[], total: 0 }, isLoading: false }))

vi.mock('../hooks/useWarehouse', () => ({
  useAvailableStockLots: () => ({ data: [] }),
  usePackedStockSummary: () => ({ data: [{ bagTypeId: BAG_TYPE.id, totalBags: 50, availableBags: 50 }] }),
  useGroupedStockExits: (params: unknown) => mockUseGroupedStockExits(params),
  useCreateStockExit: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateStockExit: () => ({ mutate: vi.fn(), isPending: false }),
  useWalkInSummary: () => ({ data: { bags: 0, kg: '0' }, isLoading: false }),
  useWarehouseCashSummary: () => ({ data: { cashCollected: '0' }, isLoading: false, isError: false }),
  useOnAccountCount: () => ({ data: { onAccountCount: 0 }, isLoading: false }),
  useFifoDraw: () => ({ mutateAsync: mockFifoDrawMutateAsync }),
}))

vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => ({ data: [BAG_TYPE] }),
}))

vi.mock('../hooks/useClients', () => ({
  useClients: () => ({ data: { data: [CLIENT] } }),
}))

const mockUseCashReceivers = vi.fn(() => ({ data: [RECEIVER] }))
vi.mock('../hooks/useUsers', () => ({
  useCashReceivers: () => mockUseCashReceivers(),
}))

vi.mock('../context/RateContext', () => ({
  useRate: () => ({ rawRate: 89550 }),
}))

async function selectRegisteredBuyer(user: ReturnType<typeof userEvent.setup>) {
  const buyerInput = screen.getByPlaceholderText('Search clients or type new name…')
  await user.click(buyerInput)
  await user.type(buyerInput, 'Walid')
  await user.click(await screen.findByText('Walid Trading'))
}

async function fillPackedLine(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  const qtyInput = container.querySelector('.packed-line input.num[type="number"]') as HTMLInputElement
  await user.clear(qtyInput)
  await user.type(qtyInput, '5')
  const priceInput = container.querySelectorAll('.packed-line input.num[type="number"]')[1] as HTMLInputElement
  await user.clear(priceInput)
  await user.type(priceInput, '2.00')
}

beforeEach(() => {
  vi.clearAllMocks()
  createWalkInSaleIsPending = false
  mockFifoDrawMutateAsync.mockResolvedValue({
    draws: [{ packedStockId: PACKED_STOCK_ID, quantity: 5 }],
    fulfilled: true,
    requested: 5,
    available: 50,
  })
  mockCreateWalkInSaleMutateAsync.mockResolvedValue({ id: 'invoice-1' })
})

describe('WarehouseSales — receiver-required validation (bug #2)', () => {
  it('blocks submission and never calls the mutation when Cash is selected with no receiver picked', async () => {
    const user = userEvent.setup()
    const { container } = render(<WarehouseSales />)

    await selectRegisteredBuyer(user)
    await fillPackedLine(user, container)

    // Payment method defaults to Cash; enter an amount so a Payment would be created.
    const usdInput = screen.getAllByPlaceholderText('0.00').find(el => el.closest('.cs-row'))
    if (usdInput) {
      await user.clear(usdInput)
      await user.type(usdInput, '10')
    }

    // Deliberately do NOT touch "Received by" — it stays at "— select receiver —".
    await user.click(screen.getByRole('button', { name: /Record this sale/i }))

    await waitFor(() => {
      expect(screen.getByText(/Select who received the payment/i)).toBeInTheDocument()
    })
    expect(mockCreateWalkInSaleMutateAsync).not.toHaveBeenCalled()
  })

  it('allows submission once a receiver is picked for a Cash sale', async () => {
    const user = userEvent.setup()
    const { container } = render(<WarehouseSales />)

    await selectRegisteredBuyer(user)
    await fillPackedLine(user, container)
    const usdInput = screen.getAllByPlaceholderText('0.00').find(el => el.closest('.cs-row'))
    if (usdInput) {
      await user.clear(usdInput)
      await user.type(usdInput, '10')
    }
    await user.selectOptions(screen.getByDisplayValue('— select receiver —'), RECEIVER.id)

    await user.click(screen.getByRole('button', { name: /Record this sale/i }))

    await waitFor(() => {
      expect(mockCreateWalkInSaleMutateAsync).toHaveBeenCalledTimes(1)
    })
    const payload = mockCreateWalkInSaleMutateAsync.mock.calls[0][0]
    expect(payload.receiverId).toBe(RECEIVER.id)
  })

  // Regression (forensic audit, 2026-09): "Received by" used to be keyed by
  // display NAME, resolved to an id only at submit time via
  // `allReceivers.find(r => r.name === receiver)` — silently ambiguous
  // whenever two cash-capable users share a name (proven live against real
  // data: 41 duplicate "Test Owner" rows from leaked test fixtures credited
  // a real $2,000+ payment to the wrong person's ledger). The select is now
  // keyed by id, so picking the SECOND same-named option must submit ITS id.
  it('two receivers sharing the same display name — selecting the second one submits ITS id, never the first', async () => {
    mockUseCashReceivers.mockReturnValue({
      data: [
        { id: 'receiver-a', name: 'Test Owner', role: 'owner' },
        { id: 'receiver-b', name: 'Test Owner', role: 'owner' },
      ],
    })
    try {
      const user = userEvent.setup()
      const { container } = render(<WarehouseSales />)

      await selectRegisteredBuyer(user)
      await fillPackedLine(user, container)
      const usdInput = screen.getAllByPlaceholderText('0.00').find(el => el.closest('.cs-row'))
      if (usdInput) {
        await user.clear(usdInput)
        await user.type(usdInput, '10')
      }

      // Options render as "{name} ({role})" — both share identical text.
      const receiverOptions = screen.getAllByText('Test Owner (owner)')
      expect(receiverOptions).toHaveLength(2)
      await user.selectOptions(screen.getByDisplayValue('— select receiver —'), receiverOptions[1])
      await user.click(screen.getByRole('button', { name: /Record this sale/i }))

      await waitFor(() => expect(mockCreateWalkInSaleMutateAsync).toHaveBeenCalledTimes(1))
      const payload = mockCreateWalkInSaleMutateAsync.mock.calls[0][0]
      expect(payload.receiverId).toBe('receiver-b')
      expect(payload.receiverId).not.toBe('receiver-a')
    } finally {
      mockUseCashReceivers.mockReturnValue({ data: [RECEIVER] })
    }
  })
})

describe('WarehouseSales — double-submission guard (bug #1)', () => {
  it('rapid double-click on "Record this sale" only fires ONE createWalkInSale call', async () => {
    const user = userEvent.setup()
    // Never resolves during the test — simulates a slow network, the exact
    // window where the old code was vulnerable to a second click.
    let resolveMutation!: (v: unknown) => void
    mockCreateWalkInSaleMutateAsync.mockImplementation(
      () => new Promise(resolve => { resolveMutation = resolve }),
    )

    const { container } = render(<WarehouseSales />)
    await selectRegisteredBuyer(user)
    await fillPackedLine(user, container)
    await user.selectOptions(screen.getByDisplayValue('— select receiver —'), RECEIVER.id)

    const submitBtn = screen.getByRole('button', { name: /Record this sale/i })
    // Two rapid clicks, exactly like a real double-click — no waiting between them.
    await user.click(submitBtn)
    await user.click(submitBtn)

    expect(mockCreateWalkInSaleMutateAsync).toHaveBeenCalledTimes(1)
    resolveMutation({ id: 'invoice-1' })
  })
})

describe('WarehouseSales — idempotency key (frontend half of the real backend fix)', () => {
  it('sends a non-empty idempotencyKey with every sale', async () => {
    const user = userEvent.setup()
    const { container } = render(<WarehouseSales />)

    await selectRegisteredBuyer(user)
    await fillPackedLine(user, container)
    await user.selectOptions(screen.getByDisplayValue('— select receiver —'), RECEIVER.id)
    await user.click(screen.getByRole('button', { name: /Record this sale/i }))

    await waitFor(() => expect(mockCreateWalkInSaleMutateAsync).toHaveBeenCalledTimes(1))
    const payload = mockCreateWalkInSaleMutateAsync.mock.calls[0][0]
    expect(typeof payload.idempotencyKey).toBe('string')
    expect(payload.idempotencyKey.length).toBeGreaterThan(0)
  })

  it('rotates the idempotencyKey after a successful submission, so the NEXT sale is never mistaken for a retry of this one', async () => {
    const user = userEvent.setup()
    const { container } = render(<WarehouseSales />)

    // First sale.
    await selectRegisteredBuyer(user)
    await fillPackedLine(user, container)
    await user.selectOptions(screen.getByDisplayValue('— select receiver —'), RECEIVER.id)
    await user.click(screen.getByRole('button', { name: /Record this sale/i }))
    await waitFor(() => expect(mockCreateWalkInSaleMutateAsync).toHaveBeenCalledTimes(1))
    const firstKey = mockCreateWalkInSaleMutateAsync.mock.calls[0][0].idempotencyKey

    // Buyer/lines reset on success, but payment method/receiver deliberately
    // persist (convenience for logging several sales in a row for the same
    // receiver) — only re-select buyer and re-fill the line.
    await selectRegisteredBuyer(user)
    await fillPackedLine(user, container)
    await user.click(screen.getByRole('button', { name: /Record this sale/i }))
    await waitFor(() => expect(mockCreateWalkInSaleMutateAsync).toHaveBeenCalledTimes(2))
    const secondKey = mockCreateWalkInSaleMutateAsync.mock.calls[1][0].idempotencyKey

    expect(secondKey).not.toBe(firstKey)
  })
})

// ---------------------------------------------------------------------------
// Sale-history grouping fix (forensic audit, 2026-08-28): a walk-in sale whose
// FIFO draw spans more than one packed-stock lot previously showed up as
// MULTIPLE rows in the Sales log — one per StockExit — for what was really
// ONE invoice, one payment, one sale. WarehouseSales.tsx now consumes
// useGroupedStockExits() (GET /stock-exits/grouped), which already collapses
// those StockExit rows server-side; this file verifies the table actually
// renders ONE row per group, not per line.
// ---------------------------------------------------------------------------
describe('WarehouseSales — sale-history grouping fix', () => {
  afterEach(() => {
    mockUseGroupedStockExits.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false })
  })

  async function openSalesLog(user: ReturnType<typeof userEvent.setup>) {
    render(<WarehouseSales />)
    await user.click(screen.getByText('Sales log'))
  }

  it('a multi-line sale (2 packed-stock lots) renders as ONE table row with an "items" badge, not two rows', async () => {
    const user = userEvent.setup()
    mockUseGroupedStockExits.mockReturnValue({
      isLoading: false,
      data: {
        total: 1,
        data: [
          {
            id: 'inv-1', invoiceId: 'inv-1', invoiceDisplayId: 'SI-0001',
            date: '2026-08-20', recipient: 'Alice', loggedBy: { id: 'u1', name: 'Sam' },
            currency: 'USD', lineCount: 2, totalQtyBags: 7, totalKg: '70.000',
            lines: [
              { saleUnit: 'BAG', bagTypeId: BAG_TYPE.id, bagTypeName: BAG_TYPE.name, qty: 3, pricePerBag: '2.00', lineTotal: '6.00', charcoalType: 'Oak', grade: 'A', nominalKgPerBag: '10.000' },
              { saleUnit: 'BAG', bagTypeId: BAG_TYPE.id, bagTypeName: BAG_TYPE.name, qty: 4, pricePerBag: '2.00', lineTotal: '8.00', charcoalType: 'Oak', grade: 'A', nominalKgPerBag: '10.000' },
            ],
          },
        ],
      },
    })

    await openSalesLog(user)

    // Exactly one data row in the table body for this sale — the bug this
    // fix resolves would have rendered this as two.
    expect(screen.getAllByText('Alice')).toHaveLength(1)
    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument() // aggregated totalQtyBags
    expect(screen.getByText('70.0 kg')).toBeInTheDocument() // aggregated totalKg
  })

  it('a single-line sale still renders its bag type/lot details directly (no regression for the common case)', async () => {
    const user = userEvent.setup()
    mockUseGroupedStockExits.mockReturnValue({
      isLoading: false,
      data: {
        total: 1,
        data: [
          {
            id: 'inv-2', invoiceId: 'inv-2', invoiceDisplayId: 'SI-0002',
            date: '2026-08-21', recipient: 'Bob', loggedBy: { id: 'u1', name: 'Sam' },
            currency: 'USD', lineCount: 1, totalQtyBags: 5, totalKg: '50.000',
            lines: [
              { saleUnit: 'BAG', bagTypeId: BAG_TYPE.id, bagTypeName: BAG_TYPE.name, qty: 5, pricePerBag: '2.00', lineTotal: '10.00', charcoalType: 'Oak', grade: 'A', nominalKgPerBag: '10.000' },
            ],
          },
        ],
      },
    })

    await openSalesLog(user)

    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText(BAG_TYPE.name)).toBeInTheDocument()
    expect(screen.queryByText(/items$/)).not.toBeInTheDocument() // never grouped-badge for a single line
  })
})

// ---------------------------------------------------------------------------
// Forensic-audit regression coverage (2026-08-29): "Warehouse Sales Log
// misrepresenting multi-source sales" — a sale's FIFO draw can span more than
// one PackedStock row, and those rows can belong to DIFFERENT charcoal
// lots/types/grades. Both the sales-log table row and the sale-detail drawer
// must accurately represent every source actually consumed — never collapse
// to (or imply) just the first one.
//
// Real-data finding: the exact sale from the reported screenshot (28 Aug
// 2026, 200 × "5kg picking ayin", recipient Marc dib, Invoice SI-0649) was
// independently re-verified against live Postgres for this audit — its
// Invoice.lines array has exactly ONE line (100% Grade B; the FIFO draw for
// that sale never touched the Grade-A packed-stock row from the same packing
// session). So that specific real sale's "PICKING AYIN / Grade B" display is
// factually correct, not a bug. What these tests prove instead is that the
// GENERAL mechanism — for any sale whose draw genuinely does span multiple
// sources — never falsely collapses to one, in either the table row or the
// drawer.
// ---------------------------------------------------------------------------
describe('WarehouseSales — charcoal source provenance (forensic audit, 2026-08-29)', () => {
  afterEach(() => {
    mockUseGroupedStockExits.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false })
  })

  async function openSalesLog(user: ReturnType<typeof userEvent.setup>) {
    render(<WarehouseSales />)
    await user.click(screen.getByText('Sales log'))
  }

  function makeLine(overrides: Record<string, unknown> = {}) {
    return {
      saleUnit: 'BAG', bagTypeId: BAG_TYPE.id, bagTypeName: BAG_TYPE.name,
      qty: 100, pricePerBag: '4.50', lineTotal: '450.00',
      charcoalType: 'PICKING AYIN', grade: 'B', nominalKgPerBag: '5.000',
      ...overrides,
    }
  }

  function mockOneRow(recipient: string, lines: ReturnType<typeof makeLine>[]) {
    mockUseGroupedStockExits.mockReturnValue({
      isLoading: false,
      data: {
        total: 1,
        data: [{
          id: 'inv-src', invoiceId: 'inv-src', invoiceDisplayId: 'SI-SRC',
          date: '2026-08-28', recipient, loggedBy: { id: 'u1', name: 'Sam' },
          currency: 'USD', lineCount: lines.length,
          totalQtyBags: lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
          totalKg: lines.reduce((s, l) => s + (Number(l.qty) || 0) * parseFloat(String(l.nominalKgPerBag ?? '0')), 0).toFixed(3),
          lines,
        }],
      },
    })
  }

  it('1) single source: table row AND drawer both show the real charcoal type/grade', async () => {
    const user = userEvent.setup()
    mockOneRow('Marc dib', [makeLine({ qty: 200, charcoalType: 'PICKING AYIN', grade: 'B' })])
    await openSalesLog(user)

    // Table row.
    expect(screen.getByText('PICKING AYIN')).toBeInTheDocument()
    expect(screen.getByText('Grade B')).toBeInTheDocument()
    expect(screen.queryByText('Mixed')).not.toBeInTheDocument()

    // Drawer — same underlying source data, no "Line N —" prefix for a single line.
    // Scoped to the drawer panel itself: the table row stays mounted behind
    // the open drawer, so an unscoped query would (correctly) find "PICKING
    // AYIN" twice — once in the row, once in the drawer.
    await user.click(screen.getByText('Marc dib'))
    const panel = within(document.querySelector('.lot-panel')!)
    expect(panel.getByText('Charcoal source')).toBeInTheDocument()
    expect(panel.getByText('PICKING AYIN')).toBeInTheDocument()
    expect(panel.getByText('Grade B')).toBeInTheDocument()
    expect(panel.queryByText(/^Line \d/)).not.toBeInTheDocument()
  })

  it('2) multiple lots, SAME charcoal type/grade: shows the real uniform source, NOT "Mixed" (distinguishes "multiple lots" from "multiple charcoal types")', async () => {
    const user = userEvent.setup()
    // Two separate FIFO draws (two different packedStockId/lotId rows) that
    // both happen to be PICKING AYIN Grade B — a genuinely uniform source.
    mockOneRow('Uniform Co', [
      makeLine({ qty: 80, charcoalType: 'PICKING AYIN', grade: 'B' }),
      makeLine({ qty: 120, charcoalType: 'PICKING AYIN', grade: 'B' }),
    ])
    await openSalesLog(user)

    // Must show the real single source, not the generic "Mixed" fallback —
    // "Mixed" would UNDER-inform here (it really is one type/grade).
    expect(screen.getByText('PICKING AYIN')).toBeInTheDocument()
    expect(screen.getByText('Grade B')).toBeInTheDocument()
    expect(screen.queryByText('Mixed')).not.toBeInTheDocument()
  })

  it('3) multiple DIFFERENT charcoal types: table shows "Mixed", never just the first type', async () => {
    const user = userEvent.setup()
    mockOneRow('Multi Type Co', [
      makeLine({ qty: 80, charcoalType: 'PICKING AYIN', grade: 'B' }),
      makeLine({ qty: 120, charcoalType: 'ayin pickings', grade: 'A' }),
    ])
    await openSalesLog(user)

    expect(screen.getByText('Mixed')).toBeInTheDocument()
    // The break/prove target: a regression that reads lines[0] only would
    // render the first type here instead of "Mixed".
    expect(screen.queryByText('PICKING AYIN')).not.toBeInTheDocument()
  })

  it('4) multiple DIFFERENT grades, same type: table shows "Mixed", never just the first grade', async () => {
    const user = userEvent.setup()
    mockOneRow('Multi Grade Co', [
      makeLine({ qty: 80, charcoalType: 'PICKING AYIN', grade: 'B' }),
      makeLine({ qty: 120, charcoalType: 'PICKING AYIN', grade: 'A' }),
    ])
    await openSalesLog(user)

    expect(screen.getByText('Mixed')).toBeInTheDocument()
    expect(screen.queryByText('Grade B')).not.toBeInTheDocument()
  })

  it('5) drawer for a multi-source sale shows EVERY source separately (Line 1 / Line 2), never collapses to one', async () => {
    const user = userEvent.setup()
    mockOneRow('Two Sources Ltd', [
      makeLine({ qty: 80, charcoalType: 'PICKING AYIN', grade: 'B' }),
      makeLine({ qty: 120, charcoalType: 'ayin pickings', grade: 'A' }),
    ])
    await openSalesLog(user)

    await user.click(screen.getByText('Two Sources Ltd'))
    // Both lines' own charcoal source values must be visible simultaneously —
    // proves the drawer never picks just one.
    expect(screen.getByText('PICKING AYIN')).toBeInTheDocument()
    expect(screen.getByText('Grade B')).toBeInTheDocument()
    expect(screen.getByText('ayin pickings')).toBeInTheDocument()
    expect(screen.getByText('Grade A')).toBeInTheDocument()
    expect(screen.getByText('Line 1 — Bag details')).toBeInTheDocument()
    expect(screen.getByText('Line 2 — Bag details')).toBeInTheDocument()
    // Two independent "Charcoal source" sections, one per line.
    expect(screen.getAllByText('Charcoal source')).toHaveLength(2)
  })

  it('6) missing/unknown source data: graceful fallback, never fabricated', async () => {
    const user = userEvent.setup()
    mockOneRow('Unknown Source LLC', [makeLine({ qty: 50, charcoalType: null, grade: null })])
    await openSalesLog(user)

    // Table: em-dash, not a fabricated "Mixed" or a blank grade. (getAllBy —
    // the row's Payment column also falls back to "—" when paidAmount isn't
    // provided by this mock, same honest-fallback behavior.)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)

    await user.click(screen.getByText('Unknown Source LLC'))
    expect(screen.getByText('Lot info not available')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Forensic audit (2026-08-31): "Warehouse Sale Logs: Complete Money & Receiver
// Information" — the log must show what the customer was charged, what they
// paid, by what method, who received it, how much was credited to that
// receiver's ledger account, and any remaining balance. These fields are
// sourced from the backend's findAllGrouped() response (stock-exits.service.ts)
// — saleTotal / paidAmount / remaining / status / payments[] — never
// recomputed client-side.
// ---------------------------------------------------------------------------
describe('WarehouseSales — sale log money & receiver information (forensic audit, 2026-08-31)', () => {
  afterEach(() => {
    mockUseGroupedStockExits.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false })
  })

  async function openSalesLog(user: ReturnType<typeof userEvent.setup>) {
    render(<WarehouseSales />)
    await user.click(screen.getByText('Sales log'))
  }

  function mockRow(overrides: Record<string, unknown> = {}) {
    mockUseGroupedStockExits.mockReturnValue({
      isLoading: false,
      data: {
        total: 1,
        data: [{
          id: 'inv-money', invoiceId: 'inv-money', invoiceDisplayId: 'SI-0827',
          date: '2026-08-29', recipient: 'Marc Dib', loggedBy: { id: 'u1', name: 'Sam' },
          client: { id: 'c1', name: 'Marc Dib' },
          currency: 'USD', lineCount: 1, totalQtyBags: 100, totalKg: '500.000',
          lines: [
            { saleUnit: 'BAG', bagTypeId: BAG_TYPE.id, bagTypeName: BAG_TYPE.name, qty: 100, pricePerBag: '5.00', lineTotal: '500.00', charcoalType: 'Oak', grade: 'A', nominalKgPerBag: '5.000' },
          ],
          saleTotal: '500.00', paidAmount: '500.00', remaining: '0.00', status: 'paid',
          payments: [
            { paymentId: 'pay-1', displayId: 'RV-0223', appliedAmount: '500.00', paymentAmount: '500.00', currency: 'USD', method: 'cash', receiverId: 'u-recv', receiverName: 'youssef', creditedAmount: '500.00' },
          ],
          ...overrides,
        }],
      },
    })
  }

  it('a fully-paid registered-client sale shows sale total, paid amount, method, receiver, and credited amount, and reads "Paid in full"', async () => {
    const user = userEvent.setup()
    mockRow()
    await openSalesLog(user)

    // Table's compact Payment column.
    expect(screen.getByText('$500.00')).toBeInTheDocument()
    expect(screen.getByText('youssef')).toBeInTheDocument()

    await user.click(screen.getByText('Marc Dib'))
    const panel = within(document.querySelector('.lot-panel')!)
    expect(panel.getByText('Total sale')).toBeInTheDocument()
    expect(panel.getByText('Cash')).toBeInTheDocument()
    expect(panel.getByText('Received by')).toBeInTheDocument()
    expect(panel.getByText('+$500.00')).toBeInTheDocument() // credited to receiver
    expect(panel.getByText('Paid in full')).toBeInTheDocument()
  })

  it('a partially-paid sale shows the correct remaining balance, not "Paid in full"', async () => {
    const user = userEvent.setup()
    mockRow({
      recipient: 'Walid', client: { id: 'c2', name: 'Walid' },
      saleTotal: '20.90', paidAmount: '10.00', remaining: '10.90', status: 'partially_paid',
      payments: [
        { paymentId: 'pay-2', displayId: 'RV-0500', appliedAmount: '10.00', paymentAmount: '10.00', currency: 'USD', method: 'cash', receiverId: 'u-recv', receiverName: 'youssef', creditedAmount: '10.00' },
      ],
    })
    await openSalesLog(user)

    await user.click(screen.getByText('Walid'))
    const panel = within(document.querySelector('.lot-panel')!)
    expect(panel.getByText('Remaining: $10.90')).toBeInTheDocument()
    expect(panel.queryByText('Paid in full')).not.toBeInTheDocument()
  })

  it('multiple payments on the same sale are each shown separately, with their own receiver and credited amount', async () => {
    const user = userEvent.setup()
    mockRow({
      recipient: 'Multi Pay Co', client: { id: 'c3', name: 'Multi Pay Co' },
      saleTotal: '100.00', paidAmount: '100.00', remaining: '0.00', status: 'paid',
      payments: [
        { paymentId: 'pay-3a', displayId: 'RV-0700', appliedAmount: '60.00', paymentAmount: '60.00', currency: 'USD', method: 'cash', receiverId: 'u-a', receiverName: 'Receiver A', creditedAmount: '60.00' },
        { paymentId: 'pay-3b', displayId: 'RV-0701', appliedAmount: '40.00', paymentAmount: '40.00', currency: 'USD', method: 'whish', receiverId: 'u-b', receiverName: 'Receiver B', creditedAmount: '40.00' },
      ],
    })
    await openSalesLog(user)

    await user.click(screen.getByText('Multi Pay Co'))
    const panel = within(document.querySelector('.lot-panel')!)
    expect(panel.getByText('Payment 1 · RV-0700')).toBeInTheDocument()
    expect(panel.getByText('Payment 2 · RV-0701')).toBeInTheDocument()
    expect(panel.getByText('Receiver A')).toBeInTheDocument()
    expect(panel.getByText('Receiver B')).toBeInTheDocument()
    expect(panel.getByText('+$60.00')).toBeInTheDocument()
    expect(panel.getByText('+$40.00')).toBeInTheDocument()
    expect(panel.getByText('Whish')).toBeInTheDocument()
  })

  it('a zero-payment ("on account") registered-client sale reports no payment/receiver, never a fabricated amount', async () => {
    const user = userEvent.setup()
    mockRow({
      recipient: 'On Account Co', client: { id: 'c4', name: 'On Account Co' },
      saleTotal: '20.90', paidAmount: '0.00', remaining: '20.90', status: 'issued', payments: [],
    })
    await openSalesLog(user)

    await user.click(screen.getByText('On Account Co'))
    const panel = within(document.querySelector('.lot-panel')!)
    expect(panel.getByText('No payment recorded — on account')).toBeInTheDocument()
    expect(panel.getByText('No receiver recorded')).toBeInTheDocument()
    expect(panel.getByText('Remaining: $20.90')).toBeInTheDocument()
  })

  it('an anonymous walk-in sale (no invoice) reports method as "Not recorded" — no method column exists for that path', async () => {
    const user = userEvent.setup()
    mockUseGroupedStockExits.mockReturnValue({
      isLoading: false,
      data: {
        total: 1,
        data: [{
          id: 'exit-anon', invoiceId: null, invoiceDisplayId: null,
          date: '2026-08-21', recipient: 'Walk-in customer', loggedBy: { id: 'u1', name: 'Sam' },
          client: null, currency: 'USD', lineCount: 1, totalQtyBags: 0, totalKg: '200.000',
          lines: [{ saleUnit: 'KG', kgQuantity: '200.000', charcoalType: 'Oak', grade: 'A' }],
          saleTotal: '400.00', paidAmount: '400.00', remaining: '0.00', status: 'recorded',
          payments: [
            { paymentId: null, displayId: null, appliedAmount: '400.00', paymentAmount: '400.00', currency: 'USD', method: null, receiverId: 'u-youssef', receiverName: 'youssef', creditedAmount: '400.00' },
          ],
          rawExit: { id: 'exit-anon', amount: '400.00' },
        }],
      },
    })
    await openSalesLog(user)

    await user.click(screen.getByText('Walk-in customer'))
    const panel = within(document.querySelector('.lot-panel')!)
    expect(panel.getByText('Not recorded')).toBeInTheDocument()
    expect(panel.getByText('youssef')).toBeInTheDocument()
    expect(panel.getByText('+$400.00')).toBeInTheDocument()
  })

  it('missing optional payment/receiver fields never crash the drawer', async () => {
    const user = userEvent.setup()
    mockRow({
      recipient: 'Sparse Co', client: null,
      saleTotal: null, paidAmount: '0.00', remaining: null, status: 'issued', payments: [],
    })
    await openSalesLog(user)

    await user.click(screen.getByText('Sparse Co'))
    const panel = within(document.querySelector('.lot-panel')!)
    expect(panel.getByText('Not set')).toBeInTheDocument() // Total sale
    expect(panel.getByText('No payment recorded — on account')).toBeInTheDocument()
  })
})
