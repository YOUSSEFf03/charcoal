import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReportsService, DEFAULT_LOOKBACK_DAYS, buildDateFilter, buildDateFilterWithDefault } from './reports.service';
import { ReportsController } from './reports.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ClientBalanceService } from '../clients/client-balance.service';
import { RolesGuard } from '../auth/roles.guard';
import { Reflector } from '@nestjs/core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }
function dec(v: string) { return { toString: () => v }; }

describe('ReportsService', () => {
  let service: ReportsService;

  const mockSettings = {
    getExchangeRate: fn(),
  };

  const mockPrisma = {
    invoice:              { findMany: fn(), aggregate: fn() },
    stockExit:            { findMany: fn(), aggregate: fn() },
    bagPurchase:          { findMany: fn(), aggregate: fn() },
    packingSession:       { findMany: fn(), aggregate: fn(), count: fn() },
    driverTrip:           { findMany: fn(), aggregate: fn() },
    stockLot:             { findMany: fn(), count: fn() },
    container:            { findMany: fn(), count: fn() },
    containerProductLine: { findMany: fn() },
    supplier:             { findUnique: fn() },
    supplierPayment:      { findMany: fn() },
    client:               { findUnique: fn() },
    payment:              { findMany: fn(), aggregate: fn() },
    worker:               { findUnique: fn() },
    workerPayment:        { findMany: fn(), aggregate: fn() },
    workerCost:           { aggregate: fn() },
    generalExpense:       { aggregate: fn() },
    cashHandoverExpense:  { aggregate: fn() },
    packedStock:          { findMany: fn(), findUnique: fn(), update: fn() },
    stockAdjustment:      { create: fn() },
    user:                 { findUnique: fn() },
    $queryRaw:            fn(),
    $transaction:         fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.$transaction.mockImplementation(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(mockPrisma);
    });

    // Default exchange rate — individual tests override this when they need a specific rate.
    mockSettings.getExchangeRate.mockResolvedValue(89550);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService,  useValue: mockPrisma   },
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  // =========================================================================
  // buildDateFilter() / buildDateFilterWithDefault() — Asia/Beirut business-day
  // boundaries. Regression coverage for the report date-filter fix: dateTo used
  // to become plain UTC midnight (new Date(to)), silently excluding almost the
  // entire selected end day for DateTime columns (issuedAt, completedAt,
  // arrivalDate, createdAt). Fixed fields (businessGte/businessLt) are Asia/Beirut
  // calendar-day boundaries, businessLt exclusive. gte/lte are UNCHANGED — still
  // plain UTC midnight, still correct for @db.Date columns.
  // =========================================================================

  describe('buildDateFilter() / buildDateFilterWithDefault()', () => {
    it('1. no dates: returns undefined', () => {
      expect(buildDateFilter(undefined, undefined)).toBeUndefined();
    });

    it('2. only dateFrom: gte/businessGte set, no lte/businessLt', () => {
      const f = buildDateFilter('2026-08-08', undefined)!;
      expect(f.gte).toEqual(new Date('2026-08-08'));
      expect(f.businessGte).toBeInstanceOf(Date);
      expect(f.lte).toBeUndefined();
      expect(f.businessLt).toBeUndefined();
    });

    it('3. only dateTo: lte/businessLt set, no gte/businessGte', () => {
      const f = buildDateFilter(undefined, '2026-08-08')!;
      expect(f.lte).toEqual(new Date('2026-08-08'));
      expect(f.businessLt).toBeInstanceOf(Date);
      expect(f.gte).toBeUndefined();
      expect(f.businessGte).toBeUndefined();
    });

    it('4. same-day dateFrom=dateTo: businessGte < businessLt, exactly 24h apart', () => {
      const f = buildDateFilter('2026-08-08', '2026-08-08')!;
      expect(f.businessGte!.getTime()).toBeLessThan(f.businessLt!.getTime());
      expect(f.businessLt!.getTime() - f.businessGte!.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('5. a record at the start of the Beirut day (00:00:00.000) is included', () => {
      const f = buildDateFilter('2026-08-08', '2026-08-08')!;
      const record = f.businessGte!; // exactly the boundary itself
      expect(record.getTime()).toBeGreaterThanOrEqual(f.businessGte!.getTime());
      expect(record.getTime()).toBeLessThan(f.businessLt!.getTime());
    });

    it('6. a record 1ms after the start of the Beirut day is included', () => {
      const f = buildDateFilter('2026-08-08', '2026-08-08')!;
      const record = new Date(f.businessGte!.getTime() + 1);
      expect(record.getTime()).toBeGreaterThanOrEqual(f.businessGte!.getTime());
      expect(record.getTime()).toBeLessThan(f.businessLt!.getTime());
    });

    it('7. a record in the middle of the Beirut day (12:00 local) is included', () => {
      const f = buildDateFilter('2026-08-08', '2026-08-08')!;
      const noonBeirut = new Date(f.businessGte!.getTime() + 12 * 60 * 60 * 1000);
      expect(noonBeirut.getTime()).toBeGreaterThanOrEqual(f.businessGte!.getTime());
      expect(noonBeirut.getTime()).toBeLessThan(f.businessLt!.getTime());
    });

    it('8. a record at the last millisecond of the Beirut day (23:59:59.999 local) is included — this is the original reported bug', () => {
      const f = buildDateFilter('2026-08-08', '2026-08-08')!;
      const lastMs = new Date(f.businessLt!.getTime() - 1);
      expect(lastMs.getTime()).toBeGreaterThanOrEqual(f.businessGte!.getTime());
      expect(lastMs.getTime()).toBeLessThan(f.businessLt!.getTime());
    });

    it('9. a record exactly at the start of the NEXT Beirut day is excluded', () => {
      const f = buildDateFilter('2026-08-08', '2026-08-08')!;
      const startOfNextDay = f.businessLt!;
      // The comparison operator at every call site is `<`, not `<=` — the
      // boundary value itself must not satisfy "included in Aug 8".
      expect(startOfNextDay.getTime() < f.businessLt!.getTime()).toBe(false);
    });

    it('10. multi-day range: businessLt is the day AFTER dateTo, not dateTo itself', () => {
      const f = buildDateFilter('2026-08-01', '2026-08-31')!;
      // businessGte should land on Aug 1, businessLt on Sep 1 (Beirut), not Aug 31.
      const gteBeirutDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(f.businessGte!);
      const ltBeirutDate  = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(f.businessLt!);
      expect(gteBeirutDate).toBe('2026-08-01');
      expect(ltBeirutDate).toBe('2026-09-01');
    });

    it('11. Asia/Beirut → UTC boundary: resolves the correct historical offset for both winter (UTC+2) and summer (UTC+3) — proves no offset is hardcoded', () => {
      // January — Beirut standard time, UTC+2. Midnight Jan 15 Beirut = Jan 14 22:00 UTC.
      const winter = buildDateFilter('2026-01-15', undefined)!;
      expect(winter.businessGte!.toISOString()).toBe('2026-01-14T22:00:00.000Z');

      // August — Beirut daylight time, UTC+3. Midnight Aug 8 Beirut = Aug 7 21:00 UTC.
      const summer = buildDateFilter('2026-08-08', undefined)!;
      expect(summer.businessGte!.toISOString()).toBe('2026-08-07T21:00:00.000Z');
    });

    it('12. @db.Date fields (gte/lte) are completely unaffected by the fix — still plain UTC midnight', () => {
      const f = buildDateFilter('2026-08-08', '2026-08-08')!;
      expect(f.gte).toEqual(new Date('2026-08-08'));
      expect(f.lte).toEqual(new Date('2026-08-08'));
      // And they must differ from the new Beirut-aware fields — proving the two
      // are genuinely independent, not aliases of each other.
      expect(f.gte!.getTime()).not.toBe(f.businessGte!.getTime());
      expect(f.lte!.getTime()).not.toBe(f.businessLt!.getTime());
    });

    it('buildDateFilterWithDefault: no-args behavior is unchanged by the fix — still now − DEFAULT_LOOKBACK_DAYS, no upper bound', () => {
      const f = buildDateFilterWithDefault(undefined, undefined);
      expect(f.lte).toBeUndefined();
      expect(f.businessLt).toBeUndefined();
      const daysAgo = (Date.now() - f.gte!.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysAgo).toBeGreaterThan(DEFAULT_LOOKBACK_DAYS - 1);
      expect(daysAgo).toBeLessThan(DEFAULT_LOOKBACK_DAYS + 1);
      // businessGte mirrors gte exactly in the no-args path (no date string to convert).
      expect(f.businessGte).toEqual(f.gte);
    });

    it('buildDateFilterWithDefault: explicit dates delegate straight to buildDateFilter (both gte/lte and businessGte/businessLt present)', () => {
      const f = buildDateFilterWithDefault('2026-08-08', '2026-08-08');
      expect(f.gte).toEqual(new Date('2026-08-08'));
      expect(f.businessGte).toBeInstanceOf(Date);
      expect(f.businessLt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // getProfitLoss — all 6 lines; all aggregations pushed to DB / SQL
  // =========================================================================

  describe('getProfitLoss()', () => {
    /**
     * Set up all mocks for one getProfitLoss() call.
     *
     * BUG-K/L/M (P5): walk-in revenue, bag cost, and fuel cost moved from Prisma
     * aggregates to raw SQL so each row is converted by its own currency. $queryRaw is
     * now called 8× inside Promise.all in this order:
     *   1. invoice_revenue   (accrual basis: SUM(total); BUG-J divides LBP by per-invoice snapshot)
     *   2. walk_in_revenue   (BUG-K: divides LBP exits by global rate)
     *   3. cogs
     *   4. bag_cost          (BUG-L: divides LBP purchases by global rate)
     *   5. variance_cost
     *   6. fuel_cost         (BUG-M: divides LBP fuel by global rate)
     *   7. other_expenses    (BUG-M: divides LBP incidentals by global rate)
     *   8. cash_collected    (Phase 3: SUM(payment.amount), divides LBP by global rate)
     *
     * walkInAmount / bagCostTotal / fuelCost / cashCollected params are interpreted as the
     * POST-conversion scalar the DB would return (matching the legacy tests' intent).
     *
     * Net Profit's four new components (sessionEarnings, workerCostAmount,
     * generalExpenseAmount, handoverExpenseAmount) are Prisma `.aggregate()` calls,
     * NOT `$queryRaw` — they default to '0' here so every pre-existing Gross-Profit
     * test (which knows nothing about Net Profit) keeps passing unmodified; only
     * tests that care about Net Profit need to pass these explicitly.
     */
    function setupPnL({
      invoiceRevenue  = '0',
      walkInAmount    = null as string | null,
      cogsRaw         = '0',
      bagCostTotal    = null as string | null,
      varianceCostRaw = '0',
      fuelCost        = null as string | null,
      otherExpenses   = '0',
      cashCollected   = '0',
      sessionEarnings       = '0',
      workerCostAmount      = '0',
      generalExpenseAmount  = '0',
      handoverExpenseAmount = '0',
    } = {}) {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ invoice_revenue: invoiceRevenue }])
        .mockResolvedValueOnce([{ walk_in_revenue: walkInAmount ?? '0' }])
        .mockResolvedValueOnce([{ cogs: cogsRaw }])
        .mockResolvedValueOnce([{ bag_cost: bagCostTotal ?? '0' }])
        .mockResolvedValueOnce([{ variance_cost: varianceCostRaw }])
        .mockResolvedValueOnce([{ fuel_cost: fuelCost ?? '0' }])
        .mockResolvedValueOnce([{ other_expenses: otherExpenses }])
        .mockResolvedValueOnce([{ cash_collected: cashCollected }]);

      mockPrisma.packingSession.aggregate.mockResolvedValue({ _sum: { sessionEarnings: dec(sessionEarnings) } });
      mockPrisma.workerCost.aggregate.mockResolvedValue({ _sum: { amount: dec(workerCostAmount) } });
      mockPrisma.generalExpense.aggregate.mockResolvedValue({ _sum: { amount: dec(generalExpenseAmount) } });
      mockPrisma.cashHandoverExpense.aggregate.mockResolvedValue({ _sum: { amount: dec(handoverExpenseAmount) } });
    }

    it('returns gross_profit field with correct structure', async () => {
      setupPnL({ invoiceRevenue: '100.00' });

      const result = await service.getProfitLoss({});

      expect(result).toHaveProperty('grossProfit');
      expect(result).toHaveProperty('cashCollected');
      expect(result.revenue).toBe('100.00');
      expect(result.grossProfit).toBe('100.00');
    });

    it('computes all 7 lines using correct DB paths', async () => {
      setupPnL({
        invoiceRevenue:  '500.00',
        cogsRaw:         '50.00',
        bagCostTotal:    '20.00',
        varianceCostRaw: '2.00',
        fuelCost:        '15.00',
        otherExpenses:   '5.00',
        cashCollected:   '300.00',
      });

      const result = await service.getProfitLoss({});

      // revenue=500, cogs=50, bagCost=20, varianceCost=2, deliveryCost=15+5=20
      // gross_profit = 500 - 50 - 20 - 2 - 20 = 408
      // cashCollected is reported separately and does NOT affect gross_profit.
      expect(result.revenue).toBe('500.00');
      expect(result.cogs).toBe('50.00');
      expect(result.bagCost).toBe('20.00');
      expect(result.varianceCost).toBe('2.00');
      expect(result.deliveryCost).toBe('20.00');
      expect(result.grossProfit).toBe('408.00');
      expect(result.cashCollected).toBe('300.00');
    });

    it('E2E: all 6 P&L lines exact, container expenses not double-counted', async () => {
      // ── SCENARIO ─────────────────────────────────────────────────────────
      // Container: 20,000 kg at $0.20/kg + $1,000 expenses → costPerKg=$0.25
      //   The $1,000 lives inside costPerKg — NOT separately in delivery_cost.
      // Session: 110 kg consumed → 20 bags × 5kg = 100kg out; varianceKg=+10
      // Sale: 15 bags at $2.50 → revenue=$37.50; COGS=15×5×0.25=$18.75 (SQL)
      // Bag purchase: $2.00; delivery fuel: $5.00
      //
      // Expected:
      //   revenue=$37.50  cogs=$18.75  bagCost=$2.00
      //   varianceCost=$2.50 (10×0.25, SQL lateral)
      //   deliveryCost=$5.00  grossProfit=$9.25
      //
      // Double-counting proof: if $1,000 were added to deliveryCost,
      //   grossProfit would be −$990.75 — asserting $9.25 proves no double-count.
      // ─────────────────────────────────────────────────────────────────────
      setupPnL({
        invoiceRevenue:  '37.50',
        walkInAmount:    null,
        cogsRaw:         '18.75',
        bagCostTotal:    '2.00',
        varianceCostRaw: '2.50',   // SQL lateral: 10 kg × ($0.25 weighted avg)
        fuelCost:        '5.00',
        otherExpenses:   '0',
      });

      const result = await service.getProfitLoss({});

      expect(result.revenue).toBe('37.50');
      expect(result.cogs).toBe('18.75');
      expect(result.bagCost).toBe('2.00');
      expect(result.varianceCost).toBe('2.50');
      expect(result.deliveryCost).toBe('5.00');
      expect(result.grossProfit).toBe('9.25');

      // Verify DB paths — no in-memory folds on growth tables. BUG-K/L/M moved bag cost,
      // walk-in revenue, and fuel to raw SQL, so all aggregation is now $queryRaw-based.
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.bagPurchase.findMany).not.toHaveBeenCalled();
      // These three were the original OOM paths — all must be absent:
      expect(mockPrisma.invoice.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.packingSession.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.driverTrip.findMany).not.toHaveBeenCalled();
    });

    it('walk-in revenue added to invoice revenue via SQL (BUG-K)', async () => {
      setupPnL({
        invoiceRevenue: '100.00',
        walkInAmount:   '25.00',
      });

      const result = await service.getProfitLoss({});

      expect(result.revenue).toBe('125.00');
      // BUG-K: walk-in revenue is the 2nd raw query now (was a Prisma aggregate).
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    // Helper: collect all Date values bound into any $queryRaw call's tagged-template.
    function rawDateValues(): Date[] {
      return mockPrisma.$queryRaw.mock.calls
        .flatMap((c: any[]) => ((c[0] as any)?.values ?? []) as unknown[])
        .filter((v: unknown): v is Date => v instanceof Date);
    }

    it('applies a default date range when no dates are given', async () => {
      setupPnL({ invoiceRevenue: '0' });

      await service.getProfitLoss({});

      // BUG-K/L/M: date bounds are now interpolated into the raw queries. The default
      // lookback (~now − DEFAULT_LOOKBACK_DAYS) must appear as a bound Date value.
      const dates = rawDateValues();
      expect(dates.length).toBeGreaterThan(0);
      const daysAgo = (Date.now() - Math.min(...dates.map((d) => d.getTime()))) / (1000 * 60 * 60 * 24);
      expect(daysAgo).toBeGreaterThan(DEFAULT_LOOKBACK_DAYS - 1);
      expect(daysAgo).toBeLessThan(DEFAULT_LOOKBACK_DAYS + 1);
    });

    it('passes explicit date range straight through without clamping', async () => {
      setupPnL({ invoiceRevenue: '0' });

      await service.getProfitLoss({ dateFrom: '2024-01-01', dateTo: '2024-03-31' });

      const dates = rawDateValues().map((d) => d.getTime());
      expect(dates).toContain(new Date('2024-01-01').getTime());
      expect(dates).toContain(new Date('2024-03-31').getTime());
    });

    // ── Date-filter fix regression (Asia/Beirut business-day boundaries) ───────
    it('same-day range: invoice_revenue and fuel/other-expenses (completedAt) queries use Beirut-aware businessGte/businessLt, not plain UTC gte/lte', async () => {
      setupPnL({ invoiceRevenue: '0' });

      await service.getProfitLoss({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      const expected = buildDateFilter('2026-08-08', '2026-08-08')!;
      // Call 0 = invoice_revenue (issuedAt — the exact column the original bug excluded).
      const invoiceRevenueValues = (mockPrisma.$queryRaw.mock.calls[0][0] as any).values as unknown[];
      expect(invoiceRevenueValues).toContainEqual(expected.businessGte);
      expect(invoiceRevenueValues).toContainEqual(expected.businessLt);
      expect(invoiceRevenueValues).not.toContainEqual(expected.gte); // old UTC-midnight value must NOT leak in
      expect(invoiceRevenueValues).not.toContainEqual(expected.lte);

      // Calls 5 and 6 = fuel_cost / other_expenses (driver_trips.completedAt — also broken before the fix).
      for (const callIndex of [5, 6]) {
        const values = (mockPrisma.$queryRaw.mock.calls[callIndex][0] as any).values as unknown[];
        expect(values).toContainEqual(expected.businessGte);
        expect(values).toContainEqual(expected.businessLt);
      }
    });

    it('same-day range: walk-in/COGS/bag-cost/variance/cash-collected queries (@db.Date columns) still use the original plain UTC gte/lte — unaffected by the fix', async () => {
      setupPnL({ invoiceRevenue: '0' });

      await service.getProfitLoss({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      const expected = buildDateFilter('2026-08-08', '2026-08-08')!;
      // Calls 1 (walk-in), 2 (cogs), 3 (bag_cost), 4 (variance), 7 (cash_collected) — all @db.Date.
      for (const callIndex of [1, 2, 3, 4, 7]) {
        const values = (mockPrisma.$queryRaw.mock.calls[callIndex][0] as any).values as unknown[];
        expect(values).toContainEqual(expected.gte);
        expect(values).toContainEqual(expected.lte);
      }
    });

    // ── TEST A2 ───────────────────────────────────────────────────────────────
    // A walk-in sale via WalkInSalesService produces a walk_in StockExit with
    // amount=null AND an invoice.  Revenue must come from the invoice only.
    // The walk-in aggregate (which filters amount: { not: null }) returns 0,
    // so the total is 120 — not 240 (invoice + exit double-counted).
    it('A2: getProfitLoss — walk-in sale via WalkInSalesService contributes revenue via invoice, not via exit', async () => {
      // Invoice: status=paid, lineTotal=120 USD  → invoice_revenue = '120.00'
      // Walk-in exit for the same sale:  amount=null  → aggregate _sum.amount = null → 0
      setupPnL({
        invoiceRevenue: '120.00',
        walkInAmount:   null,   // WalkInSalesService always writes amount=null
      });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      // Invoice counted once. The walk-in SQL (BUG-K) filters amount IS NOT NULL, so the
      // amount=null exit returns 0 → revenue is the invoice only.
      expect(result.revenue).toBe('120.00');

      // Total revenue is NOT 240 — no double-counting
      expect(result.revenue).not.toBe('240.00');
      expect(parseFloat(result.revenue)).toBe(120);
    });

    // ── TEST A3 ───────────────────────────────────────────────────────────────
    // An anonymous walk-in exit (no invoice) has amount set to a real value.
    // The walk-in aggregate MUST count it so anonymous walk-in revenue is captured.
    it('A3: getProfitLoss — anonymous walk-in exit with amount set IS counted in walk-in revenue', async () => {
      // No invoice revenue; one anonymous walk_in exit with amount=50
      setupPnL({
        invoiceRevenue: '0',
        walkInAmount:   '50.00',   // anonymous exit — amount is explicit
      });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      // Walk-in revenue = 50; invoice revenue = 0 → total = 50. BUG-K SQL counts the
      // non-null anonymous exit amount, converted by its stored currency.
      expect(result.revenue).toBe('50.00');
    });

    // ── TEST A4 ───────────────────────────────────────────────────────────────
    // A walk_in exit with amount=null (as produced by WalkInSalesService)
    // contributes exactly 0 to the walk-in revenue aggregate.
    it('A4: getProfitLoss — walk-in exit with amount=null contributes 0 to walk-in revenue', async () => {
      setupPnL({
        invoiceRevenue: '0',
        walkInAmount:   null,   // null → aggregate _sum.amount is null → Decimal('0')
      });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      // With invoice_revenue=0 and the walk-in SQL returning 0 (amount=null excluded by
      // BUG-K's `amount IS NOT NULL` filter), total revenue=0.
      expect(result.revenue).toBe('0.00');
    });

    // ── TEST B1 ───────────────────────────────────────────────────────────────
    // A USD invoice with lineTotal=100 must pass through the SQL CASE WHEN
    // unchanged (no division). The mock simulates what the DB would return
    // after the CASE WHEN: 100.00 (USD path, no conversion).
    it('B1: getProfitLoss — USD invoice lineTotal is counted at face value (no conversion applied)', async () => {
      mockSettings.getExchangeRate.mockResolvedValue(89550);
      // SQL CASE WHEN: currency='USD' → lineTotal passes through → DB returns 100.00
      setupPnL({ invoiceRevenue: '100.00' });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      expect(result.revenue).toBe('100.00');
    });

    // ── TEST B2 ───────────────────────────────────────────────────────────────
    // An LBP invoice with lineTotal=89550 divided by rate 89550 = 1 USD.
    // The mock simulates what the DB returns after the CASE WHEN SQL conversion.
    it('B2: getProfitLoss — LBP invoice lineTotal is converted to USD before summing', async () => {
      mockSettings.getExchangeRate.mockResolvedValue(89550);
      // SQL CASE WHEN: currency='LBP' → 89550 / 89550 = 1.00 → DB returns '1.00'
      setupPnL({ invoiceRevenue: '1.00' });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      expect(result.revenue).toBe('1.00');

      // Verify the rate was wired into the SQL: the first $queryRaw call should
      // receive a tagged-template array whose serialised form contains the rate value.
      const rawCall = mockPrisma.$queryRaw.mock.calls[0][0];
      // Prisma.sql returns a tagged-template object with a `values` array.
      // The rate (89550) must appear somewhere in that values array.
      const sqlValues: unknown[] = (rawCall as any).values ?? [];
      const ratePresent = sqlValues.some((v) => {
        const n = typeof v === 'object' && v !== null && 'toString' in v
          ? Number((v as any).toString())
          : Number(v);
        return n === 89550;
      });
      expect(ratePresent).toBe(true);
    });

    // ── TEST B3 ───────────────────────────────────────────────────────────────
    // Mixed invoices: USD 100 + LBP 89550. The SQL CASE WHEN converts LBP→USD
    // inside the DB and sums them: 100 + 1 = 101. The mock returns the
    // post-conversion scalar, confirming JS does no further transformation.
    it('B3: getProfitLoss — mixed USD + LBP invoices produce correct USD total', async () => {
      mockSettings.getExchangeRate.mockResolvedValue(89550);
      // SQL does: USD 100 + (LBP 89550 / 89550) = 100 + 1 = 101 → '101.00'
      setupPnL({ invoiceRevenue: '101.00' });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      expect(result.revenue).toBe('101.00');
    });

    // ── TEST B4 ───────────────────────────────────────────────────────────────
    // Uses a non-default rate (44775) to prove the rate is not hardcoded.
    // LBP invoice lineTotal=44775 / rate 44775 = 1 USD.
    it('B4: getProfitLoss — exchange rate from SettingsService is actually used in the SQL query', async () => {
      mockSettings.getExchangeRate.mockResolvedValue(44775);
      // SQL CASE WHEN: currency='LBP' → 44775 / 44775 = 1.00 → DB returns '1.00'
      setupPnL({ invoiceRevenue: '1.00' });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      expect(result.revenue).toBe('1.00');

      // The rate 44775 must appear in the SQL parameter values — not 89550 (the default).
      const rawCall = mockPrisma.$queryRaw.mock.calls[0][0];
      const sqlValues: unknown[] = (rawCall as any).values ?? [];
      const customRatePresent = sqlValues.some((v) => {
        const n = typeof v === 'object' && v !== null && 'toString' in v
          ? Number((v as any).toString())
          : Number(v);
        return n === 44775;
      });
      expect(customRatePresent).toBe(true);
    });

    // ── TEST B5 ───────────────────────────────────────────────────────────────
    // getExchangeRate must be called exactly once per getProfitLoss invocation —
    // not once per SQL query, not cached across calls.
    it('B5: getProfitLoss — getExchangeRate is called exactly once per getProfitLoss invocation', async () => {
      mockSettings.getExchangeRate.mockResolvedValue(89550);

      // First call
      setupPnL({ invoiceRevenue: '100.00' });
      await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      // Second call — chain another set of mocked values
      setupPnL({ invoiceRevenue: '200.00' });
      await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      // One call per getProfitLoss invocation, two invocations → exactly 2
      expect(mockSettings.getExchangeRate).toHaveBeenCalledTimes(2);
    });

    // ── TEST C1 ───────────────────────────────────────────────────────────────
    // Accrual basis (Phase 2): an 'issued' (unpaid) invoice now contributes its FULL
    // total to revenue — the opposite of the old cash-basis rule, which excluded it.
    it('C1: getProfitLoss — issued (unpaid) invoice contributes its FULL total to revenue', async () => {
      // status='issued', paidAmount=0, total=500 — accrual SQL sums total → DB returns 500.
      setupPnL({ invoiceRevenue: '500.00' });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      expect(result.revenue).toBe('500.00');
    });

    // ── TEST C2 ───────────────────────────────────────────────────────────────
    // A fully 'paid' invoice has paidAmount === total (both 80). Accrual sums total;
    // for a paid invoice the value coincides with the old cash-basis figure by
    // definition — this confirms the paid case is unaffected by the basis change.
    it('C2: getProfitLoss — paid invoice contributes its full total (paidAmount coincides for paid invoices)', async () => {
      // status='paid', paidAmount=80, total=80 — DB returns '80.00'
      setupPnL({ invoiceRevenue: '80.00' });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      expect(result.revenue).toBe('80.00');
    });

    // ── TEST C3 ───────────────────────────────────────────────────────────────
    // A 'partially_paid' invoice has paidAmount=120 but total=300. Under accrual,
    // revenue must reflect the FULL 300 — not just the 120 actually collected.
    it('C3: getProfitLoss — partially_paid invoice contributes its FULL total, not just the collected portion', async () => {
      // Accrual SQL sums total=300 (not paidAmount=120) — DB returns '300.00'
      setupPnL({ invoiceRevenue: '300.00' });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      expect(result.revenue).toBe('300.00');
      // The old cash-basis figure (paidAmount=120) must NOT appear
      expect(parseFloat(result.revenue)).not.toBe(120);
    });

    // ── TEST C4 ───────────────────────────────────────────────────────────────
    // Three invoices: issued total=500 (fully counted now), partial total=300
    // (paidAmount=120, fully counted), paid total=80. Accrual sums all three
    // non-draft/non-cancelled invoices: 500 + 300 + 80 = 880.
    it('C4: getProfitLoss — revenue basis is accrual — issued, partial, and paid invoices all contribute their full totals', async () => {
      setupPnL({ invoiceRevenue: '880.00' });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      expect(result.revenue).toBe('880.00');
      // The old cash-basis figure (partial's paidAmount=120 + paid's 80 = 200,
      // excluding issued entirely) must NOT appear.
      expect(parseFloat(result.revenue)).not.toBe(200);
    });

    // ── TEST C5 ───────────────────────────────────────────────────────────────
    // LBP partially_paid invoice: paidAmount=89550, total=268650, rate=89550.
    // Accrual SQL converts: total / rate = 268650 / 89550 = 3 USD.
    // Confirms the LBP→USD division is applied to total, not paidAmount.
    // If paidAmount were used: 89550 / 89550 = 1 USD — the old (now wrong) answer.
    it('C5: getProfitLoss — LBP partially_paid invoice is converted using total (not paidAmount)', async () => {
      mockSettings.getExchangeRate.mockResolvedValue(89550);
      // SQL: total(268650 LBP) / rate(89550) = 3.00 USD — NOT paidAmount(89550)/89550 = 1.00
      setupPnL({ invoiceRevenue: '3.00' });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      expect(result.revenue).toBe('3.00');
      // paidAmount-based conversion (1.00) must NOT appear
      expect(parseFloat(result.revenue)).not.toBe(1.0);
    });

    // ── TEST C6 (new, Phase 2) ─────────────────────────────────────────────────
    // Verifies the actual SQL structure: sums "total" (not "paidAmount") and the
    // status whitelist includes 'issued' alongside 'partially_paid' and 'paid'.
    it('C6: getProfitLoss — invoice-revenue SQL sums total and includes issued/partially_paid/paid', async () => {
      setupPnL({ invoiceRevenue: '0' });
      await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      const invoiceSql = mockPrisma.$queryRaw.mock.calls[0][0] as any;
      const sqlText = (invoiceSql.strings ?? []).join(' ');

      expect(sqlText).toContain('"total"');
      expect(sqlText).not.toContain('"paidAmount"');
      expect(sqlText).toContain("'issued'");
      expect(sqlText).toContain("'partially_paid'");
      expect(sqlText).toContain("'paid'");
      expect(sqlText).not.toContain("'draft'");
      expect(sqlText).not.toContain("'cancelled'");
    });

    // ── TEST C7 (new, Phase 6 safety check) ───────────────────────────────────
    // Draft and cancelled invoices must never be included in the status whitelist,
    // regardless of any other filter — checked directly against the SQL text so a
    // future edit can't silently widen the WHERE clause.
    it('C7: getProfitLoss — draft and cancelled invoices are excluded by construction (not just by DB data)', async () => {
      setupPnL({ invoiceRevenue: '0' });
      await service.getProfitLoss({});

      const invoiceSql = mockPrisma.$queryRaw.mock.calls[0][0] as any;
      const sqlText = (invoiceSql.strings ?? []).join(' ');
      const statusListMatch = sqlText.match(/IN \(([^)]*)\)/);

      expect(statusListMatch).not.toBeNull();
      const statusList = statusListMatch![1];
      expect(statusList).not.toContain('draft');
      expect(statusList).not.toContain('cancelled');
    });

    // ── TEST C8 (new, Phase 3) ─────────────────────────────────────────────────
    // cashCollected is reported alongside revenue but must NEVER affect grossProfit —
    // it is a cash-flow figure, not a profitability one.
    it('C8: getProfitLoss — cashCollected is reported but does not affect grossProfit', async () => {
      setupPnL({ invoiceRevenue: '500.00', cashCollected: '3000.00' });

      const result = await service.getProfitLoss({});

      expect(result.cashCollected).toBe('3000.00');
      // grossProfit = revenue(500) - cogs(0) - bagCost(0) - varianceCost(0) - deliveryCost(0) = 500
      // NOT reduced or increased by the 3000 collected.
      expect(result.grossProfit).toBe('500.00');
    });

    // ── TEST C9 (Phase 5 validation scenario) ─────────────────────────────────
    // The exact scenario from the task: $3,000 charcoal sale, invoice issued,
    // $0 paid, COGS=$2,300, no bag cost, $48.92 variance loss, no delivery cost.
    // Expected: revenue=$3,000, grossProfit≈$651.08, cashCollected=$0.
    it('C9: getProfitLoss — validation scenario: $3,000 issued invoice with $0 paid yields ~$651 gross profit', async () => {
      setupPnL({
        invoiceRevenue:  '3000.00', // accrual: full $3,000 total, even though paidAmount=0
        cogsRaw:         '2300.00',
        varianceCostRaw: '48.92',
        cashCollected:   '0.00',    // nothing paid yet
      });

      const result = await service.getProfitLoss({ dateFrom: '2026-07-01', dateTo: '2026-07-31' });

      expect(result.revenue).toBe('3000.00');
      expect(result.cogs).toBe('2300.00');
      expect(result.varianceCost).toBe('48.92');
      expect(result.grossProfit).toBe('651.08'); // 3000 - 2300 - 0 - 48.92 - 0
      expect(result.cashCollected).toBe('0.00');
    });

    // ── BUG-J ───────────────────────────────────────────────────────────────
    // The invoice-revenue query must reference each invoice's OWN snapshot column so a
    // later global-rate change does not move historical revenue. We assert the column
    // name appears in the raw SQL (the 1st query) — the conversion divides by
    // COALESCE(inv."exchangeRateSnapshot", <global>).
    it('BUG-J: invoice-revenue SQL divides LBP by the per-invoice exchangeRateSnapshot', async () => {
      setupPnL({ invoiceRevenue: '0' });
      await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      const invoiceSql = (mockPrisma.$queryRaw.mock.calls[0][0] as any);
      const sqlText = (invoiceSql.strings ?? []).join(' ');
      expect(sqlText).toContain('exchangeRateSnapshot');
    });

    // ── BUG-K ───────────────────────────────────────────────────────────────
    // Walk-in revenue is now its own raw query (2nd call) and must carry the global rate
    // for per-row LBP conversion. An LBP exit of 89550 at rate 89550 yields 1.00 USD; the
    // mocked post-conversion scalar proves the value flows into revenue.
    it('BUG-K: walk-in exit revenue is a rate-aware raw query feeding revenue', async () => {
      mockSettings.getExchangeRate.mockResolvedValue(89550);
      setupPnL({ invoiceRevenue: '0', walkInAmount: '1.00' }); // 89550 LBP / 89550 = 1 USD

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });
      expect(result.revenue).toBe('1.00');

      // 2nd raw query (walk-in) must have the rate bound for the LBP CASE.
      const walkInValues: unknown[] = (mockPrisma.$queryRaw.mock.calls[1][0] as any).values ?? [];
      expect(walkInValues.some((v) => Number((v as any)?.toString?.() ?? v) === 89550)).toBe(true);
    });

    // ── BUG-L ───────────────────────────────────────────────────────────────
    // Bag cost is now a raw query (4th call). An LBP purchase converts to USD, not face.
    it('BUG-L: bag cost is a rate-aware raw query and reduces gross profit by the USD value', async () => {
      mockSettings.getExchangeRate.mockResolvedValue(89550);
      // LBP bag purchase 895500 / 89550 = 10 USD (post-conversion scalar).
      setupPnL({ invoiceRevenue: '100.00', bagCostTotal: '10.00' });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });
      expect(result.bagCost).toBe('10.00');
      expect(result.grossProfit).toBe('90.00'); // 100 − 10, NOT 100 − 895500

      const bagValues: unknown[] = (mockPrisma.$queryRaw.mock.calls[3][0] as any).values ?? [];
      expect(bagValues.some((v) => Number((v as any)?.toString?.() ?? v) === 89550)).toBe(true);
    });

    // ── BUG-M ───────────────────────────────────────────────────────────────
    // Fuel (6th call) and otherExpenses (7th call) are rate-aware raw queries. LBP fuel
    // and incidentals convert to USD before reducing gross profit.
    it('BUG-M: fuel + otherExpenses are rate-aware raw queries feeding delivery cost', async () => {
      mockSettings.getExchangeRate.mockResolvedValue(89550);
      // LBP fuel 447750/89550 = 5 USD; LBP incidental 268650/89550 = 3 USD.
      setupPnL({ invoiceRevenue: '100.00', fuelCost: '5.00', otherExpenses: '3.00' });

      const result = await service.getProfitLoss({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });
      expect(result.deliveryCost).toBe('8.00'); // 5 + 3 in USD
      expect(result.grossProfit).toBe('92.00'); // 100 − 8

      const fuelValues: unknown[] = (mockPrisma.$queryRaw.mock.calls[5][0] as any).values ?? [];
      const otherValues: unknown[] = (mockPrisma.$queryRaw.mock.calls[6][0] as any).values ?? [];
      expect(fuelValues.some((v) => Number((v as any)?.toString?.() ?? v) === 89550)).toBe(true);
      expect(otherValues.some((v) => Number((v as any)?.toString?.() ?? v) === 89550)).toBe(true);
    });

    // =========================================================================
    // Net Profit — additive second tier. Gross Profit above must never change.
    // netProfit = grossProfit - laborCost - generalExpense - handoverExpense.
    // =========================================================================
    describe('Net Profit (laborCost / generalExpense / handoverExpense / netProfit)', () => {
      it('N1: Gross Profit regression — existing fields are byte-identical when all three new categories are zero', async () => {
        setupPnL({
          invoiceRevenue: '500.00', cogsRaw: '50.00', bagCostTotal: '20.00',
          varianceCostRaw: '2.00', fuelCost: '15.00', otherExpenses: '5.00', cashCollected: '300.00',
        });

        const result = await service.getProfitLoss({});

        // Identical to the pre-existing "computes all 7 lines" test above — proves
        // Gross Profit's formula/output was never touched by this change.
        expect(result.revenue).toBe('500.00');
        expect(result.cogs).toBe('50.00');
        expect(result.bagCost).toBe('20.00');
        expect(result.varianceCost).toBe('2.00');
        expect(result.deliveryCost).toBe('20.00');
        expect(result.grossProfit).toBe('408.00');
        expect(result.cashCollected).toBe('300.00');
      });

      it('N2: PackingSession.sessionEarnings contributes to laborCost', async () => {
        setupPnL({ invoiceRevenue: '100.00', sessionEarnings: '62.00' });

        const result = await service.getProfitLoss({});

        expect(result.laborCost).toBe('62.00');
        expect(mockPrisma.packingSession.aggregate).toHaveBeenCalledWith(
          expect.objectContaining({ _sum: { sessionEarnings: true } }),
        );
      });

      it('N3: WorkerCost contributes correctly, summed WITH sessionEarnings (not replacing it)', async () => {
        setupPnL({ invoiceRevenue: '100.00', sessionEarnings: '62.00', workerCostAmount: '30.00' });

        const result = await service.getProfitLoss({});

        // 62 (piece earnings) + 30 (WorkerCost: daily_wage/bonus/fuel/food/etc) = 92.
        expect(result.laborCost).toBe('92.00');
        expect(mockPrisma.workerCost.aggregate).toHaveBeenCalledWith(
          expect.objectContaining({ _sum: { amount: true } }),
        );
      });

      it('N4: WorkerPayment does NOT create an additional P&L expense — never queried by getProfitLoss at all', async () => {
        setupPnL({ invoiceRevenue: '100.00', sessionEarnings: '100.00' });
        // Worker earned $100, of which $70 was already paid out — if WorkerPayment
        // leaked into labor cost, laborCost would be reduced (or netProfit inflated)
        // by that $70. It must not: labor cost stays the full accrued $100 regardless
        // of what mock value WorkerPayment aggregation would produce.
        mockPrisma.workerPayment.aggregate.mockResolvedValue({ _sum: { amount: dec('70.00') } });

        const result = await service.getProfitLoss({});

        expect(result.laborCost).toBe('100.00');
        expect(mockPrisma.workerPayment.aggregate).not.toHaveBeenCalled();
        expect(mockPrisma.workerPayment.findMany).not.toHaveBeenCalled();
      });

      it('N5: one-time GeneralExpense in the selected period is included', async () => {
        setupPnL({ invoiceRevenue: '100.00', generalExpenseAmount: '250.00' });

        const result = await service.getProfitLoss({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });

        expect(result.generalExpense).toBe('250.00');
      });

      it('N6: GeneralExpense uses the SAME Option-B recurrence helper as the Expenses page (no divergent implementation)', async () => {
        setupPnL({ invoiceRevenue: '100.00' });
        await service.getProfitLoss({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });

        const where = mockPrisma.generalExpense.aggregate.mock.calls[0][0].where;
        const recurringClause = where.OR.find((c: any) => c.isRecurring === true);
        const oneTimeClause   = where.OR.find((c: any) => c.isRecurring === false);
        // Recurring: only an upper bound (Option B) — no lower bound at all.
        expect(recurringClause.date).toEqual({ lte: new Date('2026-08-31') });
        expect(recurringClause.date.gte).toBeUndefined();
        // One-time: bounded both sides.
        expect(oneTimeClause.date).toEqual({ gte: new Date('2026-08-01'), lte: new Date('2026-08-31') });
      });

      it('N6b: a recurring GeneralExpense dated August is excluded from a July P&L window', async () => {
        setupPnL({ invoiceRevenue: '0' });
        await service.getProfitLoss({ dateFrom: '2026-07-01', dateTo: '2026-07-31' });

        const where = mockPrisma.generalExpense.aggregate.mock.calls[0][0].where;
        const recurringClause = where.OR.find((c: any) => c.isRecurring === true);
        // July's upper bound (Jul 31) is before the row's August date — Prisma's
        // `lte: Jul 31` will never match an August-dated row.
        expect(recurringClause.date.lte < new Date('2026-08-01')).toBe(true);
      });

      it('N6c: a recurring GeneralExpense dated August is included in an August P&L window', async () => {
        setupPnL({ invoiceRevenue: '0' });
        await service.getProfitLoss({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });

        const where = mockPrisma.generalExpense.aggregate.mock.calls[0][0].where;
        const recurringClause = where.OR.find((c: any) => c.isRecurring === true);
        expect(recurringClause.date.lte >= new Date('2026-08-01')).toBe(true);
      });

      it('N6d: a recurring GeneralExpense dated August is included in a later September P&L window', async () => {
        setupPnL({ invoiceRevenue: '0' });
        await service.getProfitLoss({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });

        const where = mockPrisma.generalExpense.aggregate.mock.calls[0][0].where;
        const recurringClause = where.OR.find((c: any) => c.isRecurring === true);
        expect(recurringClause.date.lte >= new Date('2026-08-01')).toBe(true);
      });

      it('N7: CashHandoverExpense is filtered via the PARENT CashHandover.date (it has no date column of its own)', async () => {
        setupPnL({ invoiceRevenue: '100.00', handoverExpenseAmount: '20.00' });

        const result = await service.getProfitLoss({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });

        expect(result.handoverExpense).toBe('20.00');
        const where = mockPrisma.cashHandoverExpense.aggregate.mock.calls[0][0].where;
        expect(where).toEqual({
          cashHandover: { date: { gte: new Date('2026-08-01'), lte: new Date('2026-08-31') } },
        });
      });

      it('N8: ContainerExpense is never separately queried by getProfitLoss (stays inside COGS via costPerKg)', async () => {
        setupPnL({ invoiceRevenue: '100.00', cogsRaw: '18.75' });
        await service.getProfitLoss({});
        // No containerExpense model is even present on the mock — if the
        // implementation ever queried it, this test module would throw
        // "Cannot read properties of undefined" the same way N4 would for
        // an accidental WorkerPayment read. Passing silently proves it's absent.
        expect((mockPrisma as any).containerExpense).toBeUndefined();
      });

      it('N9: SupplierPayment is never queried by getProfitLoss (settles AP, not a P&L expense)', async () => {
        setupPnL({ invoiceRevenue: '100.00' });
        await service.getProfitLoss({});
        expect(mockPrisma.supplierPayment.findMany).not.toHaveBeenCalled();
      });

      it('N10: BagPurchase is not added a second time — bagCost feeds grossProfit only, once', async () => {
        setupPnL({ invoiceRevenue: '100.00', bagCostTotal: '20.00' });
        const result = await service.getProfitLoss({});
        // grossProfit = 100 - 20(bag) ; netProfit = grossProfit - 0 - 0 - 0 (no
        // second-tier costs set) — bagCost must not appear again in netProfit's subtraction.
        expect(result.grossProfit).toBe('80.00');
        expect(result.netProfit).toBe('80.00');
      });

      it('N11: delivery cost (fuel + otherExpenses) stays inside Gross Profit only, not re-subtracted for Net Profit', async () => {
        setupPnL({ invoiceRevenue: '100.00', fuelCost: '15.00', otherExpenses: '5.00' });
        const result = await service.getProfitLoss({});
        expect(result.deliveryCost).toBe('20.00');
        expect(result.grossProfit).toBe('80.00');
        expect(result.netProfit).toBe('80.00'); // no second-tier costs set — must equal grossProfit exactly
      });

      it('N12: Net Profit arithmetic — netProfit = grossProfit - laborCost - generalExpense - handoverExpense', async () => {
        setupPnL({
          invoiceRevenue: '1000.00', cogsRaw: '100.00',
          sessionEarnings: '62.00', workerCostAmount: '30.00',
          generalExpenseAmount: '40.00', handoverExpenseAmount: '20.00',
        });

        const result = await service.getProfitLoss({});

        // grossProfit = 1000 - 100 = 900
        // laborCost = 62 + 30 = 92 ; generalExpense = 40 ; handoverExpense = 20
        // netProfit = 900 - 92 - 40 - 20 = 748
        expect(result.grossProfit).toBe('900.00');
        expect(result.laborCost).toBe('92.00');
        expect(result.generalExpense).toBe('40.00');
        expect(result.handoverExpense).toBe('20.00');
        expect(result.netProfit).toBe('748.00');
      });

      it('N13: zero case — if all three new expense categories are zero, netProfit === grossProfit', async () => {
        setupPnL({ invoiceRevenue: '500.00', cogsRaw: '50.00', bagCostTotal: '20.00', varianceCostRaw: '2.00', fuelCost: '15.00', otherExpenses: '5.00' });
        const result = await service.getProfitLoss({});
        expect(result.grossProfit).toBe('408.00');
        expect(result.netProfit).toBe(result.grossProfit);
      });

      it('N14: date boundary — labor/general/handover use the SAME plain gte/lte as bagCost/varianceCost (@db.Date columns, not Beirut businessGte/businessLt)', async () => {
        setupPnL({ invoiceRevenue: '0' });
        await service.getProfitLoss({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

        const sessionWhere = mockPrisma.packingSession.aggregate.mock.calls[0][0].where;
        const costWhere    = mockPrisma.workerCost.aggregate.mock.calls[0][0].where;
        const handoverWhere = mockPrisma.cashHandoverExpense.aggregate.mock.calls[0][0].where;

        // Plain UTC-midnight Date objects — identical construction to buildDateFilter's
        // gte/lte (NOT zonedMidnightUtc/businessGte, which is only for genuine
        // DateTime columns like issuedAt/completedAt).
        expect(sessionWhere.date).toEqual({ gte: new Date('2026-08-08'), lte: new Date('2026-08-08') });
        expect(costWhere.date).toEqual({ gte: new Date('2026-08-08'), lte: new Date('2026-08-08') });
        expect(handoverWhere.cashHandover.date).toEqual({ gte: new Date('2026-08-08'), lte: new Date('2026-08-08') });
      });

      it('N15: multi-category fixture — all three new cost categories populated simultaneously, exact result', async () => {
        setupPnL({
          invoiceRevenue: '7419.00', cogsRaw: '4443.05', bagCostTotal: '0',
          varianceCostRaw: '15.48', fuelCost: '0', otherExpenses: '0',
          sessionEarnings: '62.00', workerCostAmount: '30.00',
          generalExpenseAmount: '0', handoverExpenseAmount: '20.00',
        });

        const result = await service.getProfitLoss({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });

        // grossProfit = 7419.00 - 4443.05 - 0 - 15.48 - 0 = 2960.47
        // laborCost = 62 + 30 = 92.00 ; generalExpense = 0 ; handoverExpense = 20
        // netProfit = 2960.47 - 92.00 - 0 - 20 = 2848.47
        expect(result.grossProfit).toBe('2960.47');
        expect(result.laborCost).toBe('92.00');
        expect(result.generalExpense).toBe('0.00');
        expect(result.handoverExpense).toBe('20.00');
        expect(result.netProfit).toBe('2848.47');
      });
    });
  });

  // =========================================================================
  // getDailyRevenue — zero-filled day buckets. $queryRaw is called 2× inside
  // Promise.all: 1. invoice revenue (issuedAt), 2. walk-in revenue (se.date).
  // =========================================================================

  describe('getDailyRevenue()', () => {
    function setupDailyRevenue(invoiceRows: { day: string; revenue: string }[] = [], walkInRows: { day: string; revenue: string }[] = []) {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce(invoiceRows)
        .mockResolvedValueOnce(walkInRows);
    }

    it('zero-fills every day in the requested range', async () => {
      setupDailyRevenue();
      const result = await service.getDailyRevenue({ dateFrom: '2026-08-01', dateTo: '2026-08-03' });
      expect(result.data.map((d) => d.date)).toEqual(
        expect.arrayContaining(['2026-08-01', '2026-08-02', '2026-08-03']),
      );
      expect(result.totalRevenue).toBe('0.00');
    });

    // ── Date-filter fix regression ───────────────────────────────────────────
    it('same-day range: invoice query (issuedAt) uses Beirut-aware businessGte/businessLt (exclusive), not plain UTC gte/lte', async () => {
      setupDailyRevenue();
      await service.getDailyRevenue({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      const expected = buildDateFilter('2026-08-08', '2026-08-08')!;
      const invoiceValues = (mockPrisma.$queryRaw.mock.calls[0][0] as any).values as unknown[];
      expect(invoiceValues).toContainEqual(expected.businessGte);
      expect(invoiceValues).toContainEqual(expected.businessLt);
      expect(invoiceValues).not.toContainEqual(expected.gte);
      expect(invoiceValues).not.toContainEqual(expected.lte);
    });

    it('same-day range: walk-in query (se.date) still uses plain UTC gte/lte — unaffected by the fix', async () => {
      setupDailyRevenue();
      await service.getDailyRevenue({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      const expected = buildDateFilter('2026-08-08', '2026-08-08')!;
      const walkInValues = (mockPrisma.$queryRaw.mock.calls[1][0] as any).values as unknown[];
      expect(walkInValues).toContainEqual(expected.gte);
      expect(walkInValues).toContainEqual(expected.lte);
    });

    // ── Bucketing fix regression (getDailyRevenue timezone/day-bucketing audit) ─
    // These are unit tests against a MOCKED $queryRaw — they prove the service
    // correctly aggregates/zero-fills whatever day key the SQL returns, and that
    // the SQL template itself now contains the fixed expression. They do NOT by
    // themselves prove Postgres's AT TIME ZONE behavior — that's proven separately
    // against the real database (see the live verification in the task report).

    it('SQL change: the invoice query groups by the double AT TIME ZONE conversion, not plain UTC date_trunc', async () => {
      setupDailyRevenue();
      await service.getDailyRevenue({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      const invoiceSql = (mockPrisma.$queryRaw.mock.calls[0][0] as any).sql as string;
      expect(invoiceSql).toContain(`AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Beirut'`);
      expect(invoiceSql).not.toMatch(/date_trunc\('day', inv\."issuedAt"\)/); // old, unqualified form must be gone
    });

    it('SQL unchanged: the walk-in query still groups by plain se."date" — no AT TIME ZONE', async () => {
      setupDailyRevenue();
      await service.getDailyRevenue({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      const walkInSql = (mockPrisma.$queryRaw.mock.calls[1][0] as any).sql as string;
      expect(walkInSql).not.toContain('AT TIME ZONE');
      expect(walkInSql).toContain(`date_trunc('day', se."date")`);
    });

    // A. Summer boundary: SQL (once fixed) returns bucket "2026-08-08" for the
    // 2026-08-07T21:00:00Z row — verify the service places it there, not "08-07".
    it('A. summer boundary (Beirut 00:00 exactly): bucket 2026-08-08, not 2026-08-07', async () => {
      setupDailyRevenue([{ day: '2026-08-08', revenue: '100.00' }]);
      const result = await service.getDailyRevenue({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      expect(result.data.find((d) => d.date === '2026-08-08')?.revenue).toBe('100.00');
      expect(result.data.find((d) => d.date === '2026-08-07')).toBeUndefined();
    });

    // F. Same-day report + boundary invoice: included by the filter AND correctly bucketed.
    it('F. same-day report: a Beirut-midnight-boundary invoice is included and lands under 2026-08-08, never 2026-08-07', async () => {
      setupDailyRevenue([{ day: '2026-08-08', revenue: '42.00' }]); // SQL's own bucketing, now Beirut-aware
      const result = await service.getDailyRevenue({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      expect(result.totalRevenue).toBe('42.00');
      expect(result.data).toEqual([{ date: '2026-08-08', revenue: '42.00' }]);
    });

    // G. Multiple invoices on both sides of the boundary land in their correct distinct buckets.
    it('G. multiple invoices spanning the boundary land in distinct correct buckets', async () => {
      setupDailyRevenue([
        { day: '2026-08-07', revenue: '10.00' }, // genuinely Beirut Aug-7 (e.g. 20:59 UTC)
        { day: '2026-08-08', revenue: '20.00' }, // genuinely Beirut Aug-8 (e.g. 21:01 UTC prior day, or mid-day)
      ]);
      const result = await service.getDailyRevenue({ dateFrom: '2026-08-07', dateTo: '2026-08-08' });

      expect(result.data.find((d) => d.date === '2026-08-07')?.revenue).toBe('10.00');
      expect(result.data.find((d) => d.date === '2026-08-08')?.revenue).toBe('20.00');
      expect(result.totalRevenue).toBe('30.00');
    });

    // H. Zero-fill / range invariant: only in-range dates appear — no artificial
    // out-of-range bucket like the old workaround's "2026-08-07" phantom.
    it('H. zero-fill contains ONLY dates within [dateFrom, dateTo] — no out-of-range bucket', async () => {
      setupDailyRevenue();
      const result = await service.getDailyRevenue({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      expect(result.data).toEqual([{ date: '2026-08-08', revenue: '0.00' }]);
      expect(result.data.map((d) => d.date)).not.toContain('2026-08-07');
      expect(result.data.map((d) => d.date)).not.toContain('2026-08-09');
    });

    it('range invariant: every bucket key satisfies dateFrom <= key <= dateTo for a multi-day range', async () => {
      setupDailyRevenue();
      const result = await service.getDailyRevenue({ dateFrom: '2026-08-01', dateTo: '2026-08-05' });

      for (const row of result.data) {
        expect(row.date >= '2026-08-01').toBe(true);
        expect(row.date <= '2026-08-05').toBe(true);
      }
      expect(result.data.map((d) => d.date)).toEqual([
        '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05',
      ]);
    });

    // I. Walk-in regression — se.date-based revenue unaffected by the bucketing fix.
    it('I. walk-in revenue (se.date) is summed and bucketed exactly as before', async () => {
      setupDailyRevenue([], [{ day: '2026-08-08', revenue: '77.00' }]);
      const result = await service.getDailyRevenue({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      expect(result.data.find((d) => d.date === '2026-08-08')?.revenue).toBe('77.00');
      expect(result.totalRevenue).toBe('77.00');
    });

    // Sum invariant — critical: SUM(data[].revenue) must always equal totalRevenue.
    it('sum invariant: SUM(data[].revenue) === totalRevenue, combining invoice + walk-in + multiple days', async () => {
      setupDailyRevenue(
        [{ day: '2026-08-01', revenue: '100.00' }, { day: '2026-08-03', revenue: '50.00' }],
        [{ day: '2026-08-02', revenue: '25.00' }],
      );
      const result = await service.getDailyRevenue({ dateFrom: '2026-08-01', dateTo: '2026-08-03' });

      const summed = result.data.reduce((s, d) => s + parseFloat(d.revenue), 0);
      expect(summed.toFixed(2)).toBe(result.totalRevenue);
      expect(result.totalRevenue).toBe('175.00');
    });
  });

  // =========================================================================
  // getRevenueByCharcoalType — 3 SQL sources merged and summed by type;
  // Σ(data[].revenue) must equal getProfitLoss's revenue for the same inputs.
  // $queryRaw is called 3× inside Promise.all, in order:
  //   1. order_revenue      (ORDER invoices, grouped by ClientOrder.charcoalType)
  //   2. warehouse_revenue  (WAREHOUSE_SALE invoice lines, grouped by line.charcoalType)
  //   3. anon_walkin_revenue (amount-bearing walk-in exits, grouped by lot/packedStock chain)
  // =========================================================================

  describe('getRevenueByCharcoalType()', () => {
    function setupRevenueByType({
      orderRows = [] as { charcoal_type: string; revenue: string }[],
      warehouseRows = [] as { charcoal_type: string; revenue: string }[],
      anonRows = [] as { charcoal_type: string; revenue: string }[],
    } = {}) {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce(orderRows)
        .mockResolvedValueOnce(warehouseRows)
        .mockResolvedValueOnce(anonRows);
    }

    it('sums a single source correctly and reports it sorted descending', async () => {
      setupRevenueByType({
        orderRows: [
          { charcoal_type: 'BBQ Hardwood', revenue: '1000.00' },
          { charcoal_type: 'Shisha', revenue: '2500.00' },
        ],
      });
      const result = await service.getRevenueByCharcoalType({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      expect(result.data).toEqual([
        { charcoalType: 'Shisha', revenue: '2500.00' },
        { charcoalType: 'BBQ Hardwood', revenue: '1000.00' },
      ]);
      expect(result.totalRevenue).toBe('3500.00');
    });

    it('merges the same charcoal type across all three sources instead of overwriting', async () => {
      setupRevenueByType({
        orderRows:     [{ charcoal_type: 'BBQ Hardwood', revenue: '1000.00' }],
        warehouseRows: [{ charcoal_type: 'BBQ Hardwood', revenue: '250.00' }],
        anonRows:      [{ charcoal_type: 'BBQ Hardwood', revenue: '50.00' }],
      });
      const result = await service.getRevenueByCharcoalType({});
      expect(result.data).toEqual([{ charcoalType: 'BBQ Hardwood', revenue: '1300.00' }]);
      expect(result.totalRevenue).toBe('1300.00');
    });

    it('buckets WAREHOUSE_SALE lines with no stamped charcoalType as Uncategorized, not dropped', async () => {
      setupRevenueByType({
        warehouseRows: [{ charcoal_type: 'Uncategorized', revenue: '400.00' }],
      });
      const result = await service.getRevenueByCharcoalType({});
      expect(result.data).toEqual([{ charcoalType: 'Uncategorized', revenue: '400.00' }]);
      expect(result.totalRevenue).toBe('400.00');
    });

    it('reconciles to the same total getProfitLoss would report for identical underlying data', async () => {
      // Same three dollar figures a getProfitLoss() call would see as
      // invoiceRevenue (order-sourced portion + warehouse-sourced portion)
      // and walkInRevenue — just pre-split by type here instead of summed
      // to one number, proving the GROUP BY adds no double-count or loss.
      setupRevenueByType({
        orderRows:     [{ charcoal_type: 'BBQ Hardwood', revenue: '1000.00' }, { charcoal_type: 'Shisha', revenue: '500.00' }],
        warehouseRows: [{ charcoal_type: 'BBQ Hardwood', revenue: '300.00' }, { charcoal_type: 'Uncategorized', revenue: '75.50' }],
        anonRows:      [{ charcoal_type: 'Restaurant Grade', revenue: '124.50' }],
      });
      const result = await service.getRevenueByCharcoalType({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      // 1000 + 500 (orders) + 300 + 75.50 (warehouse lines) + 124.50 (anon walk-in)
      expect(result.totalRevenue).toBe('2000.00');
      const sumOfRows = result.data.reduce((s, r) => s + parseFloat(r.revenue), 0);
      expect(sumOfRows.toFixed(2)).toBe(result.totalRevenue);
    });

    it('resolves the exchange rate once and passes it to all three queries', async () => {
      setupRevenueByType();
      await service.getRevenueByCharcoalType({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      expect(mockSettings.getExchangeRate).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(3);
    });

    it('returns empty data and zero total when there is no revenue in range', async () => {
      setupRevenueByType();
      const result = await service.getRevenueByCharcoalType({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      expect(result.data).toEqual([]);
      expect(result.totalRevenue).toBe('0.00');
      expect(result.from).toBe('2026-05-01');
      expect(result.to).toBe('2026-05-31');
    });

    // ── Date-filter fix regression ───────────────────────────────────────────
    it('same-day range: order/warehouse queries (issuedAt) use Beirut-aware businessGte/businessLt; anon-walkin (se.date) keeps plain gte/lte', async () => {
      setupRevenueByType();
      await service.getRevenueByCharcoalType({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      const expected = buildDateFilter('2026-08-08', '2026-08-08')!;
      // Calls 0 (order/ORDER) and 1 (warehouse/WAREHOUSE_SALE) — both inv.issuedAt.
      for (const callIndex of [0, 1]) {
        const values = (mockPrisma.$queryRaw.mock.calls[callIndex][0] as any).values as unknown[];
        expect(values).toContainEqual(expected.businessGte);
        expect(values).toContainEqual(expected.businessLt);
      }
      // Call 2 (anon walk-in) — se.date, @db.Date, unaffected.
      const anonValues = (mockPrisma.$queryRaw.mock.calls[2][0] as any).values as unknown[];
      expect(anonValues).toContainEqual(expected.gte);
      expect(anonValues).toContainEqual(expected.lte);
    });
  });

  // =========================================================================
  // getCogsByCharcoalType — 1 SQL source, same WHERE/CASE/joins as
  // getProfitLoss's cogs query, just GROUP BY charcoal type.
  // =========================================================================

  describe('getCogsByCharcoalType()', () => {
    it('sums COGS per type and sorts descending', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { charcoal_type: 'BBQ Hardwood', cogs: '400.00' },
        { charcoal_type: 'Shisha', cogs: '900.00' },
      ]);
      const result = await service.getCogsByCharcoalType({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      expect(result.data).toEqual([
        { charcoalType: 'Shisha', cogs: '900.00' },
        { charcoalType: 'BBQ Hardwood', cogs: '400.00' },
      ]);
      expect(result.totalCogs).toBe('1300.00');
    });

    it('buckets a null charcoal_type (defensive — no lot/packedStock match) as Uncategorized', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ charcoal_type: null, cogs: '50.00' }]);
      const result = await service.getCogsByCharcoalType({});
      expect(result.data).toEqual([{ charcoalType: 'Uncategorized', cogs: '50.00' }]);
    });

    it('returns empty data and zero total when there is no COGS in range', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.getCogsByCharcoalType({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      expect(result.data).toEqual([]);
      expect(result.totalCogs).toBe('0.00');
    });

    it('does not resolve an exchange rate — costPerKg is USD-only, same basis as getProfitLoss COGS', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);
      await service.getCogsByCharcoalType({});
      expect(mockSettings.getExchangeRate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getPnlByCharcoalType — pure merge of getRevenueByCharcoalType() +
  // getCogsByCharcoalType(); both are mocked directly (spied) so this suite
  // tests only the merge/gross-profit/margin math, not the two SQL sources
  // underneath (already covered by their own describe blocks above).
  // =========================================================================

  describe('getPnlByCharcoalType()', () => {
    function mockParts(
      revenueData: { charcoalType: string; revenue: string }[],
      totalRevenue: string,
      cogsData: { charcoalType: string; cogs: string }[],
      totalCogs: string,
    ) {
      jest.spyOn(service, 'getRevenueByCharcoalType').mockResolvedValue({ from: null, to: null, data: revenueData, totalRevenue });
      jest.spyOn(service, 'getCogsByCharcoalType').mockResolvedValue({ from: null, to: null, data: cogsData, totalCogs });
    }

    it('merges revenue and cogs by type and computes gross profit + margin', async () => {
      mockParts(
        [{ charcoalType: 'BBQ Hardwood', revenue: '1000.00' }], '1000.00',
        [{ charcoalType: 'BBQ Hardwood', cogs: '400.00' }], '400.00',
      );
      const result = await service.getPnlByCharcoalType({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      expect(result.data).toEqual([
        { charcoalType: 'BBQ Hardwood', revenue: '1000.00', cogs: '400.00', grossProfit: '600.00', marginPct: '60.0' },
      ]);
      expect(result.totalRevenue).toBe('1000.00');
      expect(result.totalCogs).toBe('400.00');
      expect(result.totalGrossProfit).toBe('600.00');
      expect(result.totalMarginPct).toBe('60.0');
    });

    it('a type with revenue but no matching COGS rows gets cogs=0, not dropped', async () => {
      mockParts([{ charcoalType: 'Shisha', revenue: '500.00' }], '500.00', [], '0.00');
      const result = await service.getPnlByCharcoalType({});
      expect(result.data).toEqual([
        { charcoalType: 'Shisha', revenue: '500.00', cogs: '0.00', grossProfit: '500.00', marginPct: '100.0' },
      ]);
    });

    it('a type with COGS but no matching revenue rows gets revenue=0, not dropped (negative margin allowed)', async () => {
      mockParts([], '0.00', [{ charcoalType: 'Restaurant Grade', cogs: '200.00' }], '200.00');
      const result = await service.getPnlByCharcoalType({});
      expect(result.data).toEqual([
        { charcoalType: 'Restaurant Grade', revenue: '0.00', cogs: '200.00', grossProfit: '-200.00', marginPct: '0.0' },
      ]);
    });

    it('reconciles: Σ(per-type revenue/cogs) equals the two source methods\' own totals', async () => {
      mockParts(
        [{ charcoalType: 'BBQ Hardwood', revenue: '1000.00' }, { charcoalType: 'Shisha', revenue: '500.00' }], '1500.00',
        [{ charcoalType: 'BBQ Hardwood', cogs: '400.00' }, { charcoalType: 'Restaurant Grade', cogs: '50.00' }], '450.00',
      );
      const result = await service.getPnlByCharcoalType({});
      const sumRevenue = result.data.reduce((s, r) => s + parseFloat(r.revenue), 0);
      const sumCogs = result.data.reduce((s, r) => s + parseFloat(r.cogs), 0);
      expect(sumRevenue.toFixed(2)).toBe(result.totalRevenue);
      expect(sumCogs.toFixed(2)).toBe(result.totalCogs);
      expect(result.totalGrossProfit).toBe((sumRevenue - sumCogs).toFixed(2));
    });

    it('marginPct is 0.0 (not NaN/Infinity) when total revenue is zero', async () => {
      mockParts([], '0.00', [{ charcoalType: 'BBQ Hardwood', cogs: '10.00' }], '10.00');
      const result = await service.getPnlByCharcoalType({});
      expect(result.totalMarginPct).toBe('0.0');
    });

    it('delegates to the two underlying methods with the same filters — no re-derived query', async () => {
      const revenueSpy = jest.spyOn(service, 'getRevenueByCharcoalType').mockResolvedValue({ from: null, to: null, data: [], totalRevenue: '0.00' });
      const cogsSpy = jest.spyOn(service, 'getCogsByCharcoalType').mockResolvedValue({ from: null, to: null, data: [], totalCogs: '0.00' });
      await service.getPnlByCharcoalType({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      expect(revenueSpy).toHaveBeenCalledWith({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      expect(cogsSpy).toHaveBeenCalledWith({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
    });
  });

  // =========================================================================
  // getContainerCosts — paginated; returns { data, total, page, limit }
  // =========================================================================

  describe('getContainerCosts()', () => {
    function makeContainer(id: string) {
      return {
        id,
        number:      `CONT-${id}`,
        arrivalDate: new Date('2024-01-01'),
        supplier:    { name: 'Supplier A' },
        productLines: [{
          id: `pl-${id}`, charcoalType: 'BBQ', grade: 'A',
          paidBags: 100, giftBags: 0,
          kgPerBag: dec('20.000'), pricePerTon: dec('200.00'),
          createdAt: new Date(),
        }],
        expenses: [{ amount: dec('500.00') }],
        discount: null,
      };
    }

    it('returns paginated envelope { data, total, page, limit }', async () => {
      mockPrisma.container.findMany.mockResolvedValue([makeContainer('c1')]);
      mockPrisma.container.count.mockResolvedValue(5);

      const result = await service.getContainerCosts({ page: 1, limit: 1 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(5);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(1);
    });

    it('totals are unchanged when paginating (per-item values correct on page 2)', async () => {
      mockPrisma.container.findMany.mockResolvedValue([makeContainer('c2')]);
      mockPrisma.container.count.mockResolvedValue(10);

      const result = await service.getContainerCosts({ page: 2, limit: 1 });

      const line = result.data[0].productLines[0];
      // tonnage=100×20/1000=2t; expense=500; allInCostPerTon=200+500/2=450; /1000=0.45
      expect(line.computed.tonnage).toBe('2.000');
      expect(line.computed.allInCostPerKg).toBe('0.4500');
    });

    it('findMany always carries a take (query is bounded)', async () => {
      mockPrisma.container.findMany.mockResolvedValue([]);
      mockPrisma.container.count.mockResolvedValue(0);

      await service.getContainerCosts({ page: 1, limit: 20 });

      const args = mockPrisma.container.findMany.mock.calls[0][0];
      expect(args.take).toBe(20);
      expect(args.take).toBeDefined();
    });

    it('applies default date range when no dates given', async () => {
      mockPrisma.container.findMany.mockResolvedValue([]);
      mockPrisma.container.count.mockResolvedValue(0);

      await service.getContainerCosts({});

      const args = mockPrisma.container.findMany.mock.calls[0][0];
      expect(args.where.arrivalDate?.gte).toBeInstanceOf(Date);
    });

    // ── Date-filter fix regression ───────────────────────────────────────────
    it('same-day range: arrivalDate (DateTime) filter uses Beirut-aware businessGte/businessLt with an exclusive upper bound', async () => {
      mockPrisma.container.findMany.mockResolvedValue([]);
      mockPrisma.container.count.mockResolvedValue(0);

      await service.getContainerCosts({ dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      const expected = buildDateFilter('2026-08-08', '2026-08-08')!;
      const args = mockPrisma.container.findMany.mock.calls[0][0];
      expect(args.where.arrivalDate).toEqual({ gte: expected.businessGte, lt: expected.businessLt });
      // Must NOT be the old shape (lte, inclusive UTC midnight).
      expect(args.where.arrivalDate.lte).toBeUndefined();
    });
  });

  // =========================================================================
  // getStockValue — paginated; DB grand total via $queryRaw
  // =========================================================================

  describe('getStockValue()', () => {
    it('returns paginated envelope with totalValue from DB', async () => {
      mockPrisma.stockLot.findMany.mockResolvedValue([
        { id: 'l1', charcoalType: 'BBQ', grade: 'A', kgRemaining: dec('100.000'), costPerKg: dec('0.2500') },
      ]);
      mockPrisma.stockLot.count.mockResolvedValue(20);
      mockPrisma.$queryRaw.mockResolvedValue([{ total_value: '2500.00' }]);

      const result = await service.getStockValue(1, 1);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(20);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(1);
      expect(result.totalValue).toBe('2500.00');
      expect(result.data[0].lotValue).toBe('25.00');
    });
  });

  // =========================================================================
  // getVariance — paginated; DB aggregates for grand totals; bounded take
  // =========================================================================

  describe('getVariance()', () => {
    function setupVariance({
      totalVarianceKg   = '0',
      totalVarianceCost = '0',
      sessions          = [] as any[],
      sessionCount      = 0,
      byCharcoalTypeRows = [] as { charcoal_type: string; sessions: number; kg_used: string; variance_kg: string }[],
    } = {}) {
      mockPrisma.packingSession.aggregate.mockResolvedValue(
        { _sum: { varianceKg: dec(totalVarianceKg) } },
      );
      // $queryRaw is called twice, in order: 1) total_variance_cost, 2) variance-by-charcoal-type rows.
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ total_variance_cost: totalVarianceCost }])
        .mockResolvedValueOnce(byCharcoalTypeRows);
      mockPrisma.packingSession.findMany.mockResolvedValue(sessions);
      mockPrisma.packingSession.count.mockResolvedValue(sessionCount);
    }

    it('returns paginated envelope { data, total, page, limit }', async () => {
      setupVariance({ sessionCount: 10 });

      const result = await service.getVariance({ page: 1, limit: 5 });

      expect(result).toHaveProperty('data');
      expect(result.total).toBe(10);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(5);
      expect(result.totalVarianceKg).toBe('0.000');
      expect(result.totalVarianceCost).toBe('0.00');
    });

    it('grand totals come from DB aggregate + $queryRaw, not in-memory fold', async () => {
      setupVariance({ totalVarianceKg: '42.500', totalVarianceCost: '12.75', sessionCount: 3 });

      const result = await service.getVariance({});

      expect(result.totalVarianceKg).toBe('42.500');
      expect(result.totalVarianceCost).toBe('12.75');
      expect(mockPrisma.packingSession.aggregate).toHaveBeenCalled();
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it('paginated findMany always carries a bounded take', async () => {
      setupVariance({ sessionCount: 5 });

      await service.getVariance({ page: 1, limit: 50 });

      const args = mockPrisma.packingSession.findMany.mock.calls[0][0];
      expect(args.take).toBe(50);
      expect(args.take).toBeDefined();
    });

    it('applies default date range when no dates given', async () => {
      setupVariance({ sessionCount: 0 });

      await service.getVariance({});

      const aggCall = mockPrisma.packingSession.aggregate.mock.calls[0][0];
      expect(aggCall.where.date?.gte).toBeInstanceOf(Date);
    });

    // Regression: date is a @db.Date column filtered with plain gte/lte, same
    // category as bagCost/varianceCost in getProfitLoss. buildDateFilterWithDefault()
    // also returns businessGte/businessLt (Asia/Beirut DateTime boundaries, for
    // genuine DateTime columns like invoice.issuedAt) — passing that object
    // wholesale as `date: dateFilter` leaks those as unrecognized keys into
    // Prisma's PackingSessionWhereInput validation and throws
    // PrismaClientValidationError at runtime against a real database (the jest
    // mock here doesn't validate shape, so this only surfaces live — see
    // getContainerCosts' arrivalDate comment for the same footgun called out
    // explicitly). where.date must carry ONLY gte/lte, on every call shape:
    // no dates given (default lookback), dateFrom only, dateTo only, and both.
    it('never leaks businessGte/businessLt into the Prisma date filter — no dates given (default lookback)', async () => {
      setupVariance({ sessionCount: 0 });
      await service.getVariance({});
      const aggCall = mockPrisma.packingSession.aggregate.mock.calls.at(-1)[0];
      expect(Object.keys(aggCall.where.date)).toEqual(['gte']);
    });

    it('never leaks businessGte/businessLt into the Prisma date filter — dateFrom only', async () => {
      setupVariance({ sessionCount: 0 });
      await service.getVariance({ dateFrom: '2026-08-01' });
      const aggCall = mockPrisma.packingSession.aggregate.mock.calls.at(-1)[0];
      expect(Object.keys(aggCall.where.date).sort()).toEqual(['gte']);
    });

    it('never leaks businessGte/businessLt into the Prisma date filter — dateTo only', async () => {
      setupVariance({ sessionCount: 0 });
      await service.getVariance({ dateTo: '2026-08-17' });
      const aggCall = mockPrisma.packingSession.aggregate.mock.calls.at(-1)[0];
      expect(Object.keys(aggCall.where.date).sort()).toEqual(['lte']);
    });

    it('never leaks businessGte/businessLt into the Prisma date filter — full range, both aggregate and findMany', async () => {
      setupVariance({ sessionCount: 0 });
      await service.getVariance({ dateFrom: '2026-08-01', dateTo: '2026-08-17' });
      const aggCall = mockPrisma.packingSession.aggregate.mock.calls.at(-1)[0];
      expect(Object.keys(aggCall.where.date).sort()).toEqual(['gte', 'lte']);
      const findManyCall = mockPrisma.packingSession.findMany.mock.calls.at(-1)[0];
      expect(Object.keys(findManyCall.where.date).sort()).toEqual(['gte', 'lte']);
    });

    it('applies both dateFrom and dateTo bounds together with a worker filter', async () => {
      setupVariance({ sessionCount: 1 });

      await service.getVariance({ dateFrom: '2026-08-01', dateTo: '2026-08-17', workerId: 'w1' });

      const aggCall = mockPrisma.packingSession.aggregate.mock.calls.at(-1)[0];
      expect(aggCall.where.date.gte).toBeInstanceOf(Date);
      expect(aggCall.where.date.lte).toBeInstanceOf(Date);
      expect(aggCall.where.workerId).toBe('w1');
    });

    // ── byCharcoalType — additional, purely-additive full-table breakdown ────

    it('reconciles: Σ(byCharcoalType[].totalVarianceKg) equals totalVarianceKg exactly', async () => {
      setupVariance({
        totalVarianceKg: '5.000',
        byCharcoalTypeRows: [
          { charcoal_type: 'BBQ Hardwood', sessions: 3, kg_used: '600.000', variance_kg: '3.000' },
          { charcoal_type: 'Shisha', sessions: 2, kg_used: '400.000', variance_kg: '2.000' },
        ],
      });

      const result = await service.getVariance({});

      const sum = result.byCharcoalType.reduce((s, r) => s + parseFloat(r.totalVarianceKg), 0);
      expect(sum.toFixed(3)).toBe('5.000');
      expect(sum.toFixed(3)).toBe(result.totalVarianceKg);
    });

    it('does not drop or double-count negative (gain) variance when reconciling against a signed total', async () => {
      // Type A over-produced (gain, negative variance), type B lost material (positive) —
      // both are real and must both appear, netting to the same signed grand total.
      setupVariance({
        totalVarianceKg: '1.000',
        byCharcoalTypeRows: [
          { charcoal_type: 'BBQ Hardwood', sessions: 1, kg_used: '100.000', variance_kg: '-2.000' },
          { charcoal_type: 'Shisha', sessions: 1, kg_used: '100.000', variance_kg: '3.000' },
        ],
      });

      const result = await service.getVariance({});

      expect(result.byCharcoalType).toHaveLength(2);
      const sum = result.byCharcoalType.reduce((s, r) => s + parseFloat(r.totalVarianceKg), 0);
      expect(sum.toFixed(3)).toBe('1.000');
    });

    it('computes avgVariancePct as totalVarianceKg / kgUsed × 100 per type, not an average of session percentages', async () => {
      setupVariance({
        byCharcoalTypeRows: [
          { charcoal_type: 'BBQ Hardwood', sessions: 1, kg_used: '200.000', variance_kg: '4.000' },
        ],
      });

      const result = await service.getVariance({});

      expect(result.byCharcoalType[0].avgVariancePct).toBe('2.0'); // 4/200 * 100
    });

    it('shareOfTotalPct is computed against total ABSOLUTE variance so shares always sum to 100%, even with offsetting signs', async () => {
      setupVariance({
        byCharcoalTypeRows: [
          { charcoal_type: 'BBQ Hardwood', sessions: 1, kg_used: '100.000', variance_kg: '-3.000' },
          { charcoal_type: 'Shisha', sessions: 1, kg_used: '100.000', variance_kg: '1.000' },
        ],
      });

      const result = await service.getVariance({});

      // |−3| and |1| → total abs = 4 → shares 75.0% / 25.0%, summing to 100%.
      const shares = result.byCharcoalType.map(r => parseFloat(r.shareOfTotalPct));
      expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
    });

    it('sorts by variance magnitude descending, not by sign', async () => {
      setupVariance({
        byCharcoalTypeRows: [
          { charcoal_type: 'Small positive', sessions: 1, kg_used: '10.000', variance_kg: '1.000' },
          { charcoal_type: 'Large negative', sessions: 1, kg_used: '10.000', variance_kg: '-9.000' },
        ],
      });

      const result = await service.getVariance({});

      expect(result.byCharcoalType.map(r => r.charcoalType)).toEqual(['Large negative', 'Small positive']);
    });

    it('a session touching two charcoal types is counted once under each — not a bug, both contributed', async () => {
      setupVariance({
        byCharcoalTypeRows: [
          { charcoal_type: 'BBQ Hardwood', sessions: 1, kg_used: '60.000', variance_kg: '0.600' },
          { charcoal_type: 'Shisha', sessions: 1, kg_used: '40.000', variance_kg: '0.400' },
        ],
      });

      const result = await service.getVariance({});

      expect(result.byCharcoalType.find(r => r.charcoalType === 'BBQ Hardwood')?.sessions).toBe(1);
      expect(result.byCharcoalType.find(r => r.charcoalType === 'Shisha')?.sessions).toBe(1);
    });

    it('returns an empty byCharcoalType array (not undefined) when there are no sessions', async () => {
      setupVariance({});

      const result = await service.getVariance({});

      expect(result.byCharcoalType).toEqual([]);
    });

    it('adding byCharcoalType does not change any existing field', async () => {
      setupVariance({
        totalVarianceKg: '10.000', totalVarianceCost: '5.00', sessionCount: 7,
        byCharcoalTypeRows: [{ charcoal_type: 'BBQ Hardwood', sessions: 1, kg_used: '50.000', variance_kg: '10.000' }],
      });

      const result = await service.getVariance({ page: 2, limit: 20 });

      expect(result.total).toBe(7);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(20);
      expect(result.totalVarianceKg).toBe('10.000');
      expect(result.totalVarianceCost).toBe('5.00');
    });
  });

  // =========================================================================
  // getClientLedger — runningBalance computed correctly; unchanged shape
  // =========================================================================

  describe('getClientLedger()', () => {
    // Default: no Fill Client pickups. Individual tests below override this
    // when they specifically exercise the client_bags_fill debit path — every
    // pre-existing invoice/payment-only test is unaffected (0 contribution).
    beforeEach(() => {
      mockPrisma.stockExit.findMany.mockResolvedValue([]);
      mockPrisma.stockExit.aggregate.mockResolvedValue({ _sum: { amount: null } });
    });

    it('runningBalance: invoice $100 then payment $40 → final balance $60', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'client-1', currency: 'USD' });
      const invoiceDate = new Date('2024-01-01');
      const paymentDate = new Date('2024-01-05');

      mockPrisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-1', issuedAt: invoiceDate, createdAt: invoiceDate, total: dec('100.00') },
      ]);
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'pmt-1', date: paymentDate, amount: dec('40.00') },
      ]);

      const result = await service.getClientLedger('client-1', {});

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].type).toBe('invoice');
      expect(result.entries[0].runningBalance).toBe('100.00');
      expect(result.entries[1].type).toBe('payment');
      expect(result.entries[1].runningBalance).toBe('60.00');
      expect(result.balance).toBe('60.00');
    });

    it('throws NotFoundException when client does not exist', async () => {
      mockPrisma.client.findUnique.mockResolvedValue(null);
      await expect(service.getClientLedger('nonexistent', {})).rejects.toThrow(NotFoundException);
    });

    // ── Phase 5: cancelled invoices excluded ──────────────────────────────────
    it('P5: query filters out cancelled and draft invoices', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([]);

      await service.getClientLedger('c-1', {});

      const args = mockPrisma.invoice.findMany.mock.calls[0][0];
      expect(args.where.status).toEqual({ notIn: ['draft', 'cancelled'] });
    });

    // ── Phase 5: description built from source + lines (invoice) and method (payment) ─
    it('P5: description built for invoice (Order Sale) and payment (Cash Payment)', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      const invDate = new Date('2024-06-01');
      const pmtDate = new Date('2024-06-05');
      mockPrisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-1', displayId: 'INV-001', issuedAt: invDate, createdAt: invDate,
          total: dec('200.00'), source: 'ORDER', lines: [] },
      ]);
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'pmt-1', displayId: 'PAY-001', date: pmtDate,
          amount: dec('100.00'), method: 'cash' },
      ]);

      const result = await service.getClientLedger('c-1', {});

      expect(result.entries[0].description).toBe('Order Sale');
      expect(result.entries[0].displayId).toBe('INV-001');
      expect(result.entries[1].description).toBe('Cash Payment');
      expect(result.entries[1].displayId).toBe('PAY-001');
    });

    it('P5: description is "Warehouse Sale" when source is WAREHOUSE_SALE', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      const d = new Date('2024-07-01');
      mockPrisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-2', displayId: null, issuedAt: d, createdAt: d,
          total: dec('50.00'), source: 'WAREHOUSE_SALE', lines: [] },
      ]);
      mockPrisma.payment.findMany.mockResolvedValue([]);

      const result = await service.getClientLedger('c-1', {});

      expect(result.entries[0].description).toBe('Warehouse Sale');
    });

    it('P5: description falls back to "Payment" for unknown payment method', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'pmt-2', displayId: null, date: new Date('2024-06-10'),
          amount: dec('30.00'), method: 'barter' },
      ]);

      const result = await service.getClientLedger('c-1', {});

      expect(result.entries[0].description).toBe('Payment');
    });

    // ── Phase 5: opening balance computed from pre-period aggregate ───────────
    it('P5: openingBalance is 0 when no dateFrom is provided', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([]);

      const result = await service.getClientLedger('c-1', {});

      expect(result.openingBalance).toBe('0.00');
    });

    it('P5: openingBalance = priorInvoiceTotal − priorPaymentTotal when dateFrom is set', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { total: dec('300.00') } });
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: dec('100.00') } });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([]);

      const result = await service.getClientLedger('c-1', { dateFrom: '2024-06-01' });

      expect(result.openingBalance).toBe('200.00');
      expect(result.balance).toBe('200.00'); // no period entries, closing = opening
    });

    it('P5: opening balance aggregate excludes draft and cancelled invoices', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { total: dec('0.00') } });
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: dec('0.00') } });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([]);

      await service.getClientLedger('c-1', { dateFrom: '2024-06-01' });

      const aggArgs = mockPrisma.invoice.aggregate.mock.calls[0][0];
      expect(aggArgs.where.status).toEqual({ notIn: ['draft', 'cancelled'] });
    });

    // ── Date-filter fix regression ───────────────────────────────────────────
    it('same-day range: period-entries issuedAt filter uses Beirut-aware businessGte/businessLt (exclusive), payment.date keeps plain gte/lte', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { total: dec('0.00') } });
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: dec('0.00') } });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([]);

      await service.getClientLedger('c-1', { dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      const expected = buildDateFilter('2026-08-08', '2026-08-08')!;
      const invoiceArgs = mockPrisma.invoice.findMany.mock.calls[0][0];
      expect(invoiceArgs.where.issuedAt).toEqual({ gte: expected.businessGte, lt: expected.businessLt });

      const paymentArgs = mockPrisma.payment.findMany.mock.calls[0][0];
      expect(paymentArgs.where.date).toEqual({ gte: expected.gte, lte: expected.lte });
    });

    it('opening balance boundary (dateFilter.gte) is unchanged by the fix — still plain UTC midnight of dateFrom, not businessGte', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { total: dec('0.00') } });
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: dec('0.00') } });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([]);

      await service.getClientLedger('c-1', { dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      const expected = buildDateFilter('2026-08-08', '2026-08-08')!;
      const invAggArgs = mockPrisma.invoice.aggregate.mock.calls[0][0];
      const payAggArgs = mockPrisma.payment.aggregate.mock.calls[0][0];
      expect(invAggArgs.where.issuedAt).toEqual({ lt: expected.gte });
      expect(payAggArgs.where.date).toEqual({ lt: expected.gte });
    });

    // ── Phase 5: deterministic sort — debits before credits on same day ───────
    it('P5: on same date invoice appears before payment (debit before credit)', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      const sameDay = new Date('2024-09-01T12:00:00Z');
      mockPrisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-10', displayId: null, issuedAt: sameDay, createdAt: sameDay,
          total: dec('100.00'), source: null, lines: [] },
      ]);
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'pmt-10', displayId: null, date: sameDay,
          amount: dec('40.00'), method: 'cash' },
      ]);

      const result = await service.getClientLedger('c-1', {});

      expect(result.entries[0].type).toBe('invoice');
      expect(result.entries[1].type).toBe('payment');
      expect(result.entries[0].runningBalance).toBe('100.00');
      expect(result.entries[1].runningBalance).toBe('60.00');
    });

    // ── ClientDetail invoice-scalability audit: status exposed for open-count ──
    it('status: each invoice entry carries its own status — lets a caller derive an open-invoice count without a second query', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      const d = new Date('2024-08-01');
      mockPrisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-1', displayId: 'INV-001', issuedAt: d, createdAt: d, total: dec('100.00'), source: 'ORDER', lines: [], status: 'issued' },
        { id: 'inv-2', displayId: 'INV-002', issuedAt: d, createdAt: d, total: dec('50.00'),  source: 'ORDER', lines: [], status: 'paid' },
        { id: 'inv-3', displayId: 'INV-003', issuedAt: d, createdAt: d, total: dec('75.00'),  source: 'ORDER', lines: [], status: 'partially_paid' },
      ]);
      mockPrisma.payment.findMany.mockResolvedValue([]);

      const result = await service.getClientLedger('c-1', {});

      const invoiceEntries = result.entries.filter((e: any) => e.type === 'invoice');
      expect(invoiceEntries).toHaveLength(3);
      expect(invoiceEntries.map((e: any) => e.status)).toEqual(['issued', 'paid', 'partially_paid']);

      // Open-invoice count is exactly the derivation a caller (ClientDetail) is
      // expected to perform: status not in paid/cancelled. draft/cancelled are
      // already excluded upstream by the where clause, so only 'paid' needs to
      // be excluded here.
      const openCount = invoiceEntries.filter((e: any) => e.status !== 'paid' && e.status !== 'cancelled').length;
      expect(openCount).toBe(2); // issued + partially_paid; paid excluded
    });

    it('status: payment entries do not carry an invoice status field (undefined, not a stray value)', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'pmt-1', displayId: null, date: new Date('2024-08-02'), amount: dec('10.00'), method: 'cash' },
      ]);

      const result = await service.getClientLedger('c-1', {});

      expect(result.entries[0].type).toBe('payment');
      expect((result.entries[0] as any).status).toBeUndefined();
    });

    it('status: adding the status field does NOT change debit/credit/runningBalance math (accounting untouched)', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', currency: 'USD' });
      const d = new Date('2024-08-01');
      mockPrisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-1', displayId: 'INV-001', issuedAt: d, createdAt: d, total: dec('100.00'), source: 'ORDER', lines: [], status: 'partially_paid' },
      ]);
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'pmt-1', displayId: 'PAY-001', date: new Date('2024-08-02'), amount: dec('30.00'), method: 'cash' },
      ]);

      const result = await service.getClientLedger('c-1', {});

      expect(result.entries[0].debit).toBe('100.00');
      expect(result.entries[0].credit).toBe('0.00');
      expect(result.entries[0].runningBalance).toBe('100.00');
      expect(result.entries[1].runningBalance).toBe('70.00');
      expect(result.balance).toBe('70.00');
    });

    // ─────────────────────────────────────────────────────────────────────
    // Fill Client statement — StockExit(exitType='client_bags_fill',
    // amount NOT NULL) as debit entries. Same filter as
    // ClientBalanceService.computeBalance(); additive-only for normal clients.
    // ─────────────────────────────────────────────────────────────────────

    it('Fill Client: one pickup produces one debit ledger entry', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'fc-1', currency: 'USD' });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.stockExit.findMany.mockResolvedValue([
        { id: 'exit-1', date: new Date('2024-05-01'), amount: dec('80.00'),
          reason: JSON.stringify([{ specKey: '5_grade-a', size: 5, charcoal: 'Grade A', qty: 10 }]) },
      ]);

      const result = await service.getClientLedger('fc-1', {});

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].type).toBe('fill_pickup');
      expect(result.entries[0].debit).toBe('80.00');
      expect(result.entries[0].credit).toBe('0.00');
      expect(result.entries[0].runningBalance).toBe('80.00');
      expect(result.entries[0].description).toBe('Filled bags pickup — 10 bags (10× 5kg)');
      expect(result.balance).toBe('80.00');
    });

    it('Fill Client: one payment (no pickups) produces one credit ledger entry', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'fc-1', currency: 'USD' });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'pmt-1', displayId: null, date: new Date('2024-05-02'), amount: dec('20.00'), method: 'cash' },
      ]);
      mockPrisma.stockExit.findMany.mockResolvedValue([]);

      const result = await service.getClientLedger('fc-1', {});

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].type).toBe('payment');
      expect(result.entries[0].credit).toBe('20.00');
      expect(result.balance).toBe('-20.00');
    });

    it('Fill Client: pickup $80 then payment $30 → running balance $50', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'fc-1', currency: 'USD' });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'pmt-1', displayId: null, date: new Date('2024-05-05'), amount: dec('30.00'), method: 'cash' },
      ]);
      mockPrisma.stockExit.findMany.mockResolvedValue([
        { id: 'exit-1', date: new Date('2024-05-01'), amount: dec('80.00'), reason: null },
      ]);

      const result = await service.getClientLedger('fc-1', {});

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].type).toBe('fill_pickup');
      expect(result.entries[0].runningBalance).toBe('80.00');
      expect(result.entries[1].type).toBe('payment');
      expect(result.entries[1].runningBalance).toBe('50.00');
      expect(result.balance).toBe('50.00');
    });

    it('Fill Client opening balance: pickup before dateFrom contributes to openingBalance', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'fc-1', currency: 'USD' });
      mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { total: null } });
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
      mockPrisma.stockExit.aggregate.mockResolvedValue({ _sum: { amount: dec('80.00') } });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.stockExit.findMany.mockResolvedValue([]);

      const result = await service.getClientLedger('fc-1', { dateFrom: '2024-06-01' });

      expect(result.openingBalance).toBe('80.00');
      expect(result.balance).toBe('80.00'); // no period entries, closing = opening

      // Same filter as ClientBalanceService.computeBalance() — exitType +
      // amount NOT NULL — and bounded to strictly before dateFrom.
      const aggArgs = mockPrisma.stockExit.aggregate.mock.calls[0][0];
      expect(aggArgs.where.exitType).toBe('client_bags_fill');
      expect(aggArgs.where.amount).toEqual({ not: null });
      expect(aggArgs.where.date.lt).toBeInstanceOf(Date);
    });

    it('Fill Client date filtering: pickup outside the requested range is excluded from entries but reflected in opening balance', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'fc-1', currency: 'USD' });
      mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { total: null } });
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
      mockPrisma.stockExit.aggregate.mockResolvedValue({ _sum: { amount: dec('80.00') } });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([]);
      // In-range pickup only — the out-of-range one already left its mark via
      // the aggregate mock above (openingBalance), not via findMany.
      mockPrisma.stockExit.findMany.mockResolvedValue([
        { id: 'exit-2', date: new Date('2024-06-15'), amount: dec('25.00'), reason: null },
      ]);

      const result = await service.getClientLedger('fc-1', { dateFrom: '2024-06-01', dateTo: '2024-06-30' });

      expect(result.openingBalance).toBe('80.00');
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].debit).toBe('25.00');
      expect(result.entries[0].runningBalance).toBe('105.00');
      expect(result.balance).toBe('105.00');

      const findArgs = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(findArgs.where.date.gte).toBeInstanceOf(Date);
      expect(findArgs.where.date.lte).toBeInstanceOf(Date);
    });

    it('Fill Client ledger balance agrees with ClientBalanceService.computeBalance() for the same data', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'fc-1', currency: 'USD' });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'pmt-1', displayId: null, date: new Date('2024-05-05'), amount: dec('30.00'), method: 'cash' },
      ]);
      mockPrisma.stockExit.findMany.mockResolvedValue([
        { id: 'exit-1', date: new Date('2024-05-01'), amount: dec('80.00'), reason: null },
      ]);

      const ledgerResult = await service.getClientLedger('fc-1', {});

      // Same mocked Prisma, same underlying data — computeBalance() reads via
      // findMany (not aggregate), so it consumes the same stockExit/payment/
      // invoice findMany mocks already set above.
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      const balanceService = new ClientBalanceService(mockPrisma as any);
      const computedBalance = await balanceService.computeBalance('fc-1');

      expect(ledgerResult.balance).toBe(computedBalance.toFixed(2));
      expect(ledgerResult.balance).toBe('50.00');
    });

    it('Normal Client regression: statement is unaffected — client_bags_fill entries never leak in for a client with only invoices/payments', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-normal', currency: 'USD' });
      const invDate = new Date('2024-05-01');
      mockPrisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-1', displayId: 'INV-100', issuedAt: invDate, createdAt: invDate, total: dec('100.00'), source: 'ORDER', lines: [], status: 'issued' },
      ]);
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'pmt-1', displayId: 'PAY-100', date: new Date('2024-05-05'), amount: dec('40.00'), method: 'cash' },
      ]);
      // stockExit.findMany defaults to [] via the outer beforeEach — normal
      // clients genuinely never have client_bags_fill rows in production.

      const result = await service.getClientLedger('c-normal', {});

      expect(result.entries).toHaveLength(2);
      expect(result.entries.map((e: any) => e.type)).toEqual(['invoice', 'payment']);
      expect(result.balance).toBe('60.00');

      // The query is still issued (it's unconditional, not client-type-gated),
      // but scoped to exitType='client_bags_fill' so it can never match a
      // normal client's rows.
      const findArgs = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(findArgs.where.exitType).toBe('client_bags_fill');
    });

    it('Fill Client: multiple pickups all appear as debits, correctly ordered chronologically', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'fc-1', currency: 'USD' });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.stockExit.findMany.mockResolvedValue([
        { id: 'exit-1', date: new Date('2024-05-01'), amount: dec('50.00'), reason: null },
        { id: 'exit-2', date: new Date('2024-05-10'), amount: dec('30.00'), reason: null },
        { id: 'exit-3', date: new Date('2024-05-20'), amount: dec('20.00'), reason: null },
      ]);

      const result = await service.getClientLedger('fc-1', {});

      expect(result.entries).toHaveLength(3);
      expect(result.entries.every((e: any) => e.type === 'fill_pickup')).toBe(true);
      expect(result.entries.map((e: any) => e.runningBalance)).toEqual(['50.00', '80.00', '100.00']);
      expect(result.balance).toBe('100.00');
    });

    it('Fill Client: pickup and payment on the same date — debit (pickup) sorts before credit (payment)', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'fc-1', currency: 'USD' });
      const sameDay = new Date('2024-05-01');
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'pmt-1', displayId: null, date: sameDay, amount: dec('15.00'), method: 'cash' },
      ]);
      mockPrisma.stockExit.findMany.mockResolvedValue([
        { id: 'exit-1', date: sameDay, amount: dec('50.00'), reason: null },
      ]);

      const result = await service.getClientLedger('fc-1', {});

      expect(result.entries[0].type).toBe('fill_pickup');
      expect(result.entries[0].runningBalance).toBe('50.00');
      expect(result.entries[1].type).toBe('payment');
      expect(result.entries[1].runningBalance).toBe('35.00');
    });

    it('Fill Client: the stockExit query filters amount NOT NULL — a null-amount client_bags_fill row can never surface as a debit', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'fc-1', currency: 'USD' });
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.stockExit.findMany.mockResolvedValue([]);

      await service.getClientLedger('fc-1', {});

      const findArgs = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(findArgs.where.exitType).toBe('client_bags_fill');
      expect(findArgs.where.amount).toEqual({ not: null });
    });
  });

  // =========================================================================
  // getSupplierLedger — Supplier Statement of Account.
  // Debit sources: ContainerProductLine + StockLot(source='direct') only.
  // Credit source: SupplierPayment (LBP converted to USD).
  // Explicitly excludes ContainerExpense, ContainerDiscount, BagPurchase.
  // =========================================================================

  describe('getSupplierLedger()', () => {
    function noPriorRecords() {
      mockPrisma.containerProductLine.findMany.mockResolvedValue([]);
      mockPrisma.stockLot.findMany.mockResolvedValue([]);
      mockPrisma.supplierPayment.findMany.mockResolvedValue([]);
    }

    it('throws NotFoundException when supplier does not exist', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue(null);
      await expect(service.getSupplierLedger('missing-supplier', {})).rejects.toThrow(NotFoundException);
    });

    it('empty statement: supplier with no purchases and no payments', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1' });
      noPriorRecords();

      const result = await service.getSupplierLedger('s-1', {});

      expect(result.entries).toHaveLength(0);
      expect(result.summary).toEqual({
        totalPurchased: '0.00',
        totalPaid:      '0.00',
        outstanding:    '0.00',
        openingBalance: '0.00',
      });
    });

    it('statement generation: mixed sources produce correct entries, running balance, and summary', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1' });
      const lineDate = new Date('2024-01-01');
      const lotDate  = new Date('2024-01-10');
      const payDate  = new Date('2024-01-15');

      // Container product line: 100 paidBags × 25kg/bag = 2.5 tons × $500/ton = $1,250.
      mockPrisma.containerProductLine.findMany.mockResolvedValue([
        {
          id: 'line-1', charcoalType: 'BBQ Hardwood', grade: 'A', paidBags: 100,
          kgPerBag: dec('25.000'), pricePerTon: dec('500.00'), createdAt: lineDate,
          container: { id: 'cont-1', number: 'CONT-001' },
        },
      ]);
      // Direct lot: 1,000 kg × $0.80/kg = $800.
      mockPrisma.stockLot.findMany.mockResolvedValue([
        {
          id: 'lot-1', charcoalType: 'Shisha', grade: 'B',
          kgReceived: dec('1000.000'), costPerKg: dec('0.8000'), dateReceived: lotDate,
        },
      ]);
      mockPrisma.supplierPayment.findMany.mockResolvedValue([
        { id: 'pmt-1', displayId: null, date: payDate, amount: dec('500.00'), currency: 'USD', method: 'bank_transfer' },
      ]);

      const result = await service.getSupplierLedger('s-1', {});

      expect(result.entries).toHaveLength(3);
      // Chronological: line (Jan 1) → lot (Jan 10) → payment (Jan 15).
      expect(result.entries[0].type).toBe('purchase');
      expect(result.entries[0]).toMatchObject({ sourceType: 'container', debit: '1250.00', credit: '0.00', runningBalance: '1250.00' });
      expect(result.entries[1]).toMatchObject({ sourceType: 'direct', debit: '800.00', credit: '0.00', runningBalance: '2050.00' });
      expect(result.entries[2]).toMatchObject({ type: 'payment', debit: '0.00', credit: '500.00', runningBalance: '1550.00' });

      expect(result.summary).toEqual({
        totalPurchased: '2050.00',
        totalPaid:      '500.00',
        outstanding:    '1550.00',
        openingBalance: '0.00',
      });
    });

    it('mixed purchase sources: container and direct entries are both tagged with the correct sourceType', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1' });
      mockPrisma.containerProductLine.findMany.mockResolvedValue([
        { id: 'line-1', charcoalType: 'BBQ', grade: 'A', paidBags: 10, kgPerBag: dec('20.000'),
          pricePerTon: dec('100.00'), createdAt: new Date('2024-01-01'), container: { id: 'c-1', number: 'CONT-001' } },
      ]);
      mockPrisma.stockLot.findMany.mockResolvedValue([
        { id: 'lot-1', charcoalType: 'BBQ', grade: 'A', kgReceived: dec('500.000'),
          costPerKg: dec('1.0000'), dateReceived: new Date('2024-01-02') },
      ]);
      mockPrisma.supplierPayment.findMany.mockResolvedValue([]);

      const result = await service.getSupplierLedger('s-1', {});

      expect(result.entries.map((e: any) => e.sourceType)).toEqual(['container', 'direct']);
      // Container purchase links back to the container, not the line itself.
      expect(result.entries[0].reference).toBe('c-1');
      expect(result.entries[0].displayId).toBe('CONT-001');
      expect(result.entries[0].description).toContain('CONT-001');
      expect(result.entries[1].description).toContain('Direct purchase');
    });

    // ── Opening balance ──────────────────────────────────────────────────────
    it('opening balance: aggregates purchases and payments strictly before dateFrom', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1' });

      // Prior product line: 4 paidBags × 25kg = 0.1 ton × $1000/ton = $100.
      mockPrisma.containerProductLine.findMany.mockImplementation(({ where }: any) => {
        if (where.createdAt?.lt) {
          return Promise.resolve([
            { paidBags: 4, kgPerBag: dec('25.000'), pricePerTon: dec('1000.00') },
          ]);
        }
        return Promise.resolve([]); // period query returns nothing
      });
      // Prior direct lot: 50kg × $2/kg = $100.
      mockPrisma.stockLot.findMany.mockImplementation(({ where }: any) => {
        if (where.dateReceived?.lt) {
          return Promise.resolve([{ kgReceived: dec('50.000'), costPerKg: dec('2.0000') }]);
        }
        return Promise.resolve([]);
      });
      // Prior payment: $50.
      mockPrisma.supplierPayment.findMany.mockImplementation(({ where }: any) => {
        if (where.date?.lt) {
          return Promise.resolve([{ amount: dec('50.00'), currency: 'USD' }]);
        }
        return Promise.resolve([]);
      });

      const result = await service.getSupplierLedger('s-1', { dateFrom: '2024-02-01' });

      // openingBalance = 100 (line) + 100 (lot) − 50 (payment) = 150.
      expect(result.summary.openingBalance).toBe('150.00');
      expect(result.entries).toHaveLength(0);
    });

    it('openingBalance is 0.00 when no dateFrom is provided', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1' });
      noPriorRecords();

      const result = await service.getSupplierLedger('s-1', {});

      expect(result.summary.openingBalance).toBe('0.00');
      // No "prior" queries should even run without a dateFrom.
      expect(mockPrisma.containerProductLine.findMany).toHaveBeenCalledTimes(1);
    });

    // ── Currency conversion ──────────────────────────────────────────────────
    it('currency conversion: LBP payment is converted to USD using the global exchange rate', async () => {
      mockSettings.getExchangeRate.mockResolvedValue(89550);
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1' });
      mockPrisma.containerProductLine.findMany.mockResolvedValue([]);
      mockPrisma.stockLot.findMany.mockResolvedValue([]);
      // 89,550 LBP / 89,550 rate = 1.00 USD.
      mockPrisma.supplierPayment.findMany.mockResolvedValue([
        { id: 'pmt-1', displayId: null, date: new Date('2024-01-01'), amount: dec('89550'), currency: 'LBP', method: 'cash' },
      ]);

      const result = await service.getSupplierLedger('s-1', {});

      expect(result.entries[0].credit).toBe('1.00');
      expect(result.summary.totalPaid).toBe('1.00');
      // The raw LBP face value must never leak through unconverted.
      expect(result.summary.totalPaid).not.toBe('89550.00');
    });

    it('currency conversion: USD and LBP payments both contribute correctly to totalPaid', async () => {
      mockSettings.getExchangeRate.mockResolvedValue(89550);
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1' });
      mockPrisma.containerProductLine.findMany.mockResolvedValue([]);
      mockPrisma.stockLot.findMany.mockResolvedValue([]);
      mockPrisma.supplierPayment.findMany.mockResolvedValue([
        { id: 'pmt-usd', displayId: null, date: new Date('2024-01-01'), amount: dec('100.00'), currency: 'USD', method: 'cash' },
        { id: 'pmt-lbp', displayId: null, date: new Date('2024-01-02'), amount: dec('89550'),  currency: 'LBP', method: 'cash' },
      ]);

      const result = await service.getSupplierLedger('s-1', {});

      // 100 USD + (89550 LBP / 89550) = 100 + 1 = 101.
      expect(result.summary.totalPaid).toBe('101.00');
    });

    // ── Date filtering ───────────────────────────────────────────────────────
    it('date filtering: applies dateFrom/dateTo to all three period queries', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1' });
      noPriorRecords();

      await service.getSupplierLedger('s-1', { dateFrom: '2024-01-01', dateTo: '2024-01-31' });

      // With dateFrom set, the opening-balance queries run first (call index 0,
      // filtering strictly before dateFrom), then the period queries (call index 1,
      // the gte/lte range under test here).
      const lineArgs = mockPrisma.containerProductLine.findMany.mock.calls[1][0];
      const lotArgs  = mockPrisma.stockLot.findMany.mock.calls[1][0];
      const payArgs  = mockPrisma.supplierPayment.findMany.mock.calls[1][0];

      // containerProductLine.createdAt is a genuine DateTime column — Asia/Beirut
      // calendar-day boundaries, exclusive upper bound (the date-filter fix).
      const expected = buildDateFilter('2024-01-01', '2024-01-31')!;
      expect(lineArgs.where.createdAt).toEqual({ gte: expected.businessGte, lt: expected.businessLt });
      // stockLot.dateReceived and supplierPayment.date are @db.Date — plain
      // gte/lte, unaffected by the fix, still correct as before.
      expect(lotArgs.where.dateReceived).toEqual({ gte: new Date('2024-01-01'), lte: new Date('2024-01-31') });
      expect(payArgs.where.date).toEqual({ gte: new Date('2024-01-01'), lte: new Date('2024-01-31') });
      // Direct-lot query must still scope to source='direct' regardless of date filter.
      expect(lotArgs.where.source).toBe('direct');
    });

    it('opening balance boundary (dateFilter.gte) is unchanged by the fix — still plain UTC midnight of dateFrom, not businessGte', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1' });
      noPriorRecords();

      await service.getSupplierLedger('s-1', { dateFrom: '2026-08-08', dateTo: '2026-08-08' });

      const expected = buildDateFilter('2026-08-08', '2026-08-08')!;
      const lineAggArgs = mockPrisma.containerProductLine.findMany.mock.calls[0][0];
      const lotAggArgs  = mockPrisma.stockLot.findMany.mock.calls[0][0];
      const payAggArgs  = mockPrisma.supplierPayment.findMany.mock.calls[0][0];
      expect(lineAggArgs.where.createdAt).toEqual({ lt: expected.gte });
      expect(lotAggArgs.where.dateReceived).toEqual({ lt: expected.gte });
      expect(payAggArgs.where.date).toEqual({ lt: expected.gte });
    });

    // ── Same-day tie-break ───────────────────────────────────────────────────
    it('same-day purchases and payments: purchases sort before payments, mirroring the client ledger', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1' });
      const sameDay = new Date('2024-03-01');
      mockPrisma.containerProductLine.findMany.mockResolvedValue([
        { id: 'line-1', charcoalType: 'BBQ', grade: 'A', paidBags: 10, kgPerBag: dec('10.000'),
          pricePerTon: dec('100.00'), createdAt: sameDay, container: { id: 'c-1', number: 'CONT-001' } },
      ]);
      mockPrisma.stockLot.findMany.mockResolvedValue([]);
      mockPrisma.supplierPayment.findMany.mockResolvedValue([
        { id: 'pmt-1', displayId: null, date: sameDay, amount: dec('10.00'), currency: 'USD', method: 'cash' },
      ]);

      const result = await service.getSupplierLedger('s-1', {});

      expect(result.entries[0].type).toBe('purchase');
      expect(result.entries[1].type).toBe('payment');
    });

    // ── Negative balance ─────────────────────────────────────────────────────
    it('negative balance: a payment with no matching purchases produces a negative outstanding', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1' });
      mockPrisma.containerProductLine.findMany.mockResolvedValue([]);
      mockPrisma.stockLot.findMany.mockResolvedValue([]);
      mockPrisma.supplierPayment.findMany.mockResolvedValue([
        { id: 'pmt-1', displayId: null, date: new Date('2024-01-01'), amount: dec('500.00'), currency: 'USD', method: 'bank_transfer' },
      ]);

      const result = await service.getSupplierLedger('s-1', {});

      expect(result.summary.outstanding).toBe('-500.00');
      expect(result.entries[0].runningBalance).toBe('-500.00');
    });

    // ── Exclusions (Rule 3 / design review Phase 6) ──────────────────────────
    it('never queries ContainerExpense, ContainerDiscount, or BagPurchase', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1' });
      noPriorRecords();

      await service.getSupplierLedger('s-1', {});

      // These tables have no mock entries at all on mockPrisma's containerExpense/
      // containerDiscount access — if the service tried to call them it would throw
      // "Cannot read properties of undefined", which the test runner would surface
      // as a failure. Reaching this line with a clean result proves they're unused.
      expect(mockPrisma.bagPurchase.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.bagPurchase.aggregate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // submitPhysicalCount — adjustments created only for mismatches
  // =========================================================================

  describe('submitPhysicalCount()', () => {
    function setupTransaction(txMocks: { packedStocks?: Record<string, any> }) {
      const userMock      = fn(); userMock.mockResolvedValue({ id: 'db-user-id', clerkId: 'clerk-user-id' });
      const psLookupMock  = fn();
      psLookupMock.mockImplementation(({ where }: any) =>
        Promise.resolve(txMocks.packedStocks?.[where.id] ?? null),
      );
      const adjustmentCreateMock = fn();
      adjustmentCreateMock.mockImplementation((data: any) =>
        Promise.resolve({ id: 'adj-' + Math.random(), ...data.data }),
      );

      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          user:            { findUnique: userMock },
          packedStock:     { findUnique: psLookupMock, update: fn() },
          stockAdjustment: { create: adjustmentCreateMock },
        };
        return cb(tx);
      });
    }

    it('creates StockAdjustment for each item where actualQuantity !== systemQuantity', async () => {
      setupTransaction({ packedStocks: { 'ps-1': { id: 'ps-1', quantity: 100, reservedQuantity: 0 }, 'ps-2': { id: 'ps-2', quantity: 50, reservedQuantity: 0 } } });

      const result = await service.submitPhysicalCount(
        { items: [{ packedStockId: 'ps-1', actualQuantity: 80 }, { packedStockId: 'ps-2', actualQuantity: 60 }] },
        'clerk-user-id',
      );

      expect(result.adjustmentsCreated).toBe(2);
      expect(result.details).toHaveLength(2);
    });

    it('BUG-E: applies the count as an atomic delta, never an absolute set', async () => {
      const userMock = fn(); userMock.mockResolvedValue({ id: 'db-user-id' });
      const psFn = fn(); psFn.mockResolvedValue({ id: 'ps-1', quantity: 100, reservedQuantity: 0 });
      const updateFn = fn(); updateFn.mockResolvedValue({});
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb({
        user:            { findUnique: userMock },
        packedStock:     { findUnique: psFn, update: updateFn },
        stockAdjustment: { create: fn().mockImplementation((a: any) => Promise.resolve({ id: 'adj', ...a.data })) },
      }));

      await service.submitPhysicalCount(
        { items: [{ packedStockId: 'ps-1', actualQuantity: 80 }] },
        'clerk-user-id',
      );

      // Counted 80 vs live 100 → delta −20 applied atomically, NOT `quantity: 80`.
      const updateArg = updateFn.mock.calls[0][0];
      expect(updateArg.data.quantity).toEqual({ increment: -20 });
    });

    it('BUG-E: rejects a count that would drop quantity below reserved', async () => {
      setupTransaction({ packedStocks: { 'ps-1': { id: 'ps-1', quantity: 100, reservedQuantity: 90 } } });
      await expect(
        service.submitPhysicalCount(
          { items: [{ packedStockId: 'ps-1', actualQuantity: 80 }] }, // 80 < 90 reserved
          'clerk-user-id',
        ),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }) });
    });

    it('creates zero adjustments when all actualQuantity equals systemQuantity', async () => {
      setupTransaction({ packedStocks: { 'ps-1': { id: 'ps-1', quantity: 100 } } });

      const result = await service.submitPhysicalCount(
        { items: [{ packedStockId: 'ps-1', actualQuantity: 100 }] },
        'clerk-user-id',
      );

      expect(result.adjustmentsCreated).toBe(0);
    });

    it('sets approvedById = the DB user id from the authenticated user, not from body', async () => {
      const expectedUserId = 'owner-db-id';
      let capturedApprovedById: string | undefined;

      const userFn = fn(); userFn.mockResolvedValue({ id: expectedUserId });
      const psFn   = fn(); psFn.mockResolvedValue({ id: 'ps-1', quantity: 10 });
      const createFn = fn();
      createFn.mockImplementation((args: any) => {
        capturedApprovedById = args.data.approvedById;
        return Promise.resolve({ id: 'adj-1', ...args.data });
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb({
        user:            { findUnique: userFn },
        packedStock:     { findUnique: psFn, update: fn() },
        stockAdjustment: { create: createFn },
      }));

      await service.submitPhysicalCount(
        { items: [{ packedStockId: 'ps-1', actualQuantity: 5 }] },
        'clerk-user-id',
      );

      expect(capturedApprovedById).toBe(expectedUserId);
    });

    it('throws NotFoundException for unknown packedStockId', async () => {
      setupTransaction({ packedStocks: {} });
      await expect(
        service.submitPhysicalCount(
          { items: [{ packedStockId: 'ps-missing', actualQuantity: 5 }] },
          'clerk-user-id',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // getArSummary — 4 parallel queries: invoice.aggregate (totalInvoiced),
  // payment.aggregate (totalCollected), $queryRaw #1 (totalOutstanding +
  // openInvoiceCount), $queryRaw #2 (totalOverdue + overdueCount + oldestOverdueDays).
  //
  // BUG: totalOutstanding used to be SQL `SUM(total - paidAmount)` over open
  // invoices. Invoice.paidAmount is only updated when a payment is linked to
  // that invoice via invoiceId (payments.service.ts) — but invoiceId is
  // optional (CreatePaymentDto). A payment recorded against a client without
  // an invoiceId counted toward totalCollected but never cleared any
  // invoice's paidAmount, so a fully-paid client (via an unlinked payment)
  // still showed their full invoice total as outstanding — contradicting
  // both totalInvoiced − totalCollected and the client's own $0 balance
  // (ClientBalanceService, CONSTRAINT 15). Fixed: totalOutstanding is now
  // computed per-client as invoiced − ALL of that client's payments
  // (matching ClientBalanceService exactly), floored at 0 and summed.
  // =========================================================================

  describe('getArSummary()', () => {
    function setupArSummary({
      totalInvoiced = '0.00',
      totalCollected = '0.00',
      totalOutstanding = '0.00',
      openCount = '0',
      totalOverdue = '0.00',
      overdueCount = '0',
      oldestDays = '0',
    }: Partial<{
      totalInvoiced: string; totalCollected: string; totalOutstanding: string;
      openCount: string; totalOverdue: string; overdueCount: string; oldestDays: string;
    }> = {}) {
      // totalInvoiced and totalCollected are now raw SQL too (currency-conversion
      // fix — see the getArSummary doc comment), same $queryRaw call as the other
      // two — mocked in the exact order the service's Promise.all issues them.
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ total_invoiced: totalInvoiced }])
        .mockResolvedValueOnce([{ total_collected: totalCollected }])
        .mockResolvedValueOnce([{ total_outstanding: totalOutstanding, open_count: openCount }])
        .mockResolvedValueOnce([{ total_overdue: totalOverdue, overdue_count: overdueCount, oldest_days: oldestDays }]);
    }

    it('regression: invoice paid in full via a payment not linked to any invoiceId reports $0 outstanding (Al Nakheel scenario)', async () => {
      // The buggy SQL would have returned total_outstanding: '240.00' here because
      // it read Invoice.paidAmount, which an unlinked payment never touches. The
      // fixed SQL computes this from invoiced − all client payments and would
      // resolve it to '0.00' — this test locks in the service's contract with
      // whatever the SQL returns; the live-DB fix is verified separately.
      setupArSummary({ totalInvoiced: '240.00', totalCollected: '240.00', totalOutstanding: '0.00', openCount: '1' });

      const result = await service.getArSummary();

      expect(result.totalInvoiced).toBe('240.00');
      expect(result.totalCollected).toBe('240.00');
      expect(result.totalOutstanding).toBe('0.00');
      // Outstanding must reconcile with invoiced − collected whenever there's no credit balance.
      expect(parseFloat(result.totalInvoiced) - parseFloat(result.totalCollected))
        .toBeCloseTo(parseFloat(result.totalOutstanding), 2);
    });

    it('reports a partial balance when only some of the invoice is collected', async () => {
      setupArSummary({ totalInvoiced: '240.00', totalCollected: '100.00', totalOutstanding: '140.00', openCount: '1' });

      const result = await service.getArSummary();

      expect(result.totalInvoiced).toBe('240.00');
      expect(result.totalCollected).toBe('100.00');
      expect(result.totalOutstanding).toBe('140.00');
    });

    it('reports all zeros when there is no invoice/payment activity', async () => {
      setupArSummary();

      const result = await service.getArSummary();

      expect(result.totalInvoiced).toBe('0.00');
      expect(result.totalCollected).toBe('0.00');
      expect(result.totalOutstanding).toBe('0.00');
      expect(result.openInvoiceCount).toBe(0);
      expect(result.overdueCount).toBe(0);
      expect(result.oldestOverdueDays).toBe(0);
    });

    it('maps openInvoiceCount, overdueCount and oldestOverdueDays from their respective raw rows', async () => {
      setupArSummary({
        totalInvoiced: '500.00', totalCollected: '200.00', totalOutstanding: '300.00', openCount: '3',
        totalOverdue: '120.00', overdueCount: '2', oldestDays: '15',
      });

      const result = await service.getArSummary();

      expect(result.openInvoiceCount).toBe(3);
      expect(result.overdueCount).toBe(2);
      expect(result.oldestOverdueDays).toBe(15);
      expect(result.totalOverdue).toBe('120.00');
    });

    // -----------------------------------------------------------------------
    // Currency-mixing regression. Invoice.currency/Payment.currency are set
    // independently per row (not forced to match Client.currency), so every
    // aggregate here sums across potentially different currencies. Each SQL
    // query now converts LBP rows to USD (invoices via exchangeRateSnapshot,
    // payments via the current global rate) before summing — these tests
    // assert the exchange rate is actually threaded into every one of the 4
    // queries, not just resolved and ignored.
    // -----------------------------------------------------------------------

    it('resolves the exchange rate exactly once and threads it into every one of the 4 AR queries', async () => {
      mockSettings.getExchangeRate.mockResolvedValueOnce(75000);
      setupArSummary({ totalInvoiced: '100.00', totalCollected: '100.00', totalOutstanding: '0.00' });

      await service.getArSummary();

      expect(mockSettings.getExchangeRate).toHaveBeenCalledTimes(1);
      // Every call to $queryRaw must have received the resolved rate as one of
      // its template values — asserts the rate isn't silently dropped from any
      // of the 4 queries (e.g. a copy-paste that forgot to interpolate it).
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(4);
      for (const call of mockPrisma.$queryRaw.mock.calls) {
        const sqlFragment = call[0];
        expect(sqlFragment.values.some((v: unknown) => String(v) === '75000')).toBe(true);
      }
    });

    it('a USD-converted result correctly reflects a mix of USD and LBP source rows (contract check — actual conversion math is the raw SQL\'s job, verified live)', async () => {
      // The SQL itself does the CASE/NULLIF conversion; this test only locks in
      // that the service still reads total_invoiced/total_collected off the
      // now-raw-SQL result shape (not the old ._sum.total/._sum.amount shape),
      // so a regression that reverts to Prisma .aggregate() (currency-blind)
      // would be caught by TypeScript, and a regression that misreads the raw
      // result shape would be caught here.
      setupArSummary({ totalInvoiced: '5502.20', totalCollected: '2750.00', totalOutstanding: '2752.20' });

      const result = await service.getArSummary();

      expect(result.totalInvoiced).toBe('5502.20');
      expect(result.totalCollected).toBe('2750.00');
      expect(result.totalOutstanding).toBe('2752.20');
    });
  });

});

// ---------------------------------------------------------------------------
// Role enforcement tests — verify @Roles decorators via RolesGuard
// ---------------------------------------------------------------------------

describe('ReportsController — role enforcement', () => {
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  const mockService = {
    getProfitLoss:       fn(),
    getStockValue:       fn(),
    getVariance:         fn(),
    getContainerCosts:   fn(),
    getClientLedger:     fn(),
    getPhysicalCount:    fn(),
    submitPhysicalCount: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        { provide: ReportsService, useValue: mockService },
        Reflector,
        RolesGuard,
      ],
    }).compile();

    reflector  = module.get<Reflector>(Reflector);
    rolesGuard = new RolesGuard(reflector);
  });

  function mockContext(role: string, handlerName: string) {
    const handler = (ReportsController.prototype as any)[handlerName];
    return {
      switchToHttp: () => ({ getRequest: () => ({ user: { role, userId: 'user-id' } }) }),
      getHandler:   () => handler,
      getClass:     () => ReportsController,
    } as any;
  }

  it('profit-loss: accountant → ForbiddenException (CONSTRAINT 11)', () => {
    expect(() => rolesGuard.canActivate(mockContext('accountant', 'getProfitLoss'))).toThrow(ForbiddenException);
  });
  it('profit-loss: sales_rep → ForbiddenException (CONSTRAINT 11)', () => {
    expect(() => rolesGuard.canActivate(mockContext('sales_rep', 'getProfitLoss'))).toThrow(ForbiddenException);
  });
  it('profit-loss: owner → passes', () => {
    expect(rolesGuard.canActivate(mockContext('owner', 'getProfitLoss'))).toBe(true);
  });

  it('stock-value: sales_rep → ForbiddenException (CONSTRAINT 12)', () => {
    expect(() => rolesGuard.canActivate(mockContext('sales_rep', 'getStockValue'))).toThrow(ForbiddenException);
  });
  it('stock-value: worker → ForbiddenException (CONSTRAINT 12)', () => {
    expect(() => rolesGuard.canActivate(mockContext('worker', 'getStockValue'))).toThrow(ForbiddenException);
  });
  it('stock-value: accountant → passes', () => {
    expect(rolesGuard.canActivate(mockContext('accountant', 'getStockValue'))).toBe(true);
  });
});
