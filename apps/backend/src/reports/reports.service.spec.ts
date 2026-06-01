import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReportsService, DEFAULT_LOOKBACK_DAYS } from './reports.service';
import { ReportsController } from './reports.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../auth/roles.guard';
import { Reflector } from '@nestjs/core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }
function dec(v: string) { return { toString: () => v }; }

describe('ReportsService', () => {
  let service: ReportsService;

  const mockPrisma = {
    invoice:         { findMany: fn() },
    stockExit:       { findMany: fn(), aggregate: fn() },
    bagPurchase:     { findMany: fn(), aggregate: fn() },
    packingSession:  { findMany: fn(), aggregate: fn(), count: fn() },
    driverTrip:      { findMany: fn(), aggregate: fn() },
    stockLot:        { findMany: fn(), count: fn() },
    container:       { findMany: fn(), count: fn() },
    client:          { findUnique: fn() },
    payment:         { findMany: fn() },
    worker:          { findUnique: fn() },
    workerPayment:   { findMany: fn(), aggregate: fn() },
    packedStock:     { findMany: fn(), findUnique: fn(), update: fn() },
    stockAdjustment: { create: fn() },
    user:            { findUnique: fn() },
    $queryRaw:       fn(),
    $transaction:    fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.$transaction.mockImplementation(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(mockPrisma);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  // =========================================================================
  // getProfitLoss — all 6 lines; all aggregations pushed to DB / SQL
  // =========================================================================

  describe('getProfitLoss()', () => {
    /**
     * Set up all mocks for one getProfitLoss() call.
     *
     * $queryRaw is called 4× inside Promise.all in this order:
     *   1. invoice_revenue
     *   2. cogs
     *   3. variance_cost
     *   4. other_expenses
     */
    function setupPnL({
      invoiceRevenue  = '0',
      walkInAmount    = null as string | null,
      cogsRaw         = '0',
      bagCostTotal    = null as string | null,
      varianceCostRaw = '0',
      fuelCost        = null as string | null,
      otherExpenses   = '0',
    } = {}) {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ invoice_revenue: invoiceRevenue }])
        .mockResolvedValueOnce([{ cogs: cogsRaw }])
        .mockResolvedValueOnce([{ variance_cost: varianceCostRaw }])
        .mockResolvedValueOnce([{ other_expenses: otherExpenses }]);

      mockPrisma.stockExit.aggregate.mockResolvedValue(
        { _sum: { amount: walkInAmount ? dec(walkInAmount) : null } },
      );
      mockPrisma.bagPurchase.aggregate.mockResolvedValue(
        { _sum: { totalCost: bagCostTotal ? dec(bagCostTotal) : null } },
      );
      mockPrisma.driverTrip.aggregate.mockResolvedValue(
        { _sum: { fuelCost: fuelCost ? dec(fuelCost) : null } },
      );
    }

    it('returns gross_profit field with correct structure', async () => {
      setupPnL({ invoiceRevenue: '100.00' });

      const result = await service.getProfitLoss({});

      expect(result).toHaveProperty('grossProfit');
      expect(result.revenue).toBe('100.00');
      expect(result.grossProfit).toBe('100.00');
    });

    it('computes all 6 lines using correct DB paths', async () => {
      setupPnL({
        invoiceRevenue:  '500.00',
        cogsRaw:         '50.00',
        bagCostTotal:    '20.00',
        varianceCostRaw: '2.00',
        fuelCost:        '15.00',
        otherExpenses:   '5.00',
      });

      const result = await service.getProfitLoss({});

      // revenue=500, cogs=50, bagCost=20, varianceCost=2, deliveryCost=15+5=20
      // gross_profit = 500 - 50 - 20 - 2 - 20 = 408
      expect(result.revenue).toBe('500.00');
      expect(result.cogs).toBe('50.00');
      expect(result.bagCost).toBe('20.00');
      expect(result.varianceCost).toBe('2.00');
      expect(result.deliveryCost).toBe('20.00');
      expect(result.grossProfit).toBe('408.00');
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

      // Verify DB paths — no in-memory folds on growth tables
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.bagPurchase.aggregate).toHaveBeenCalled();
      expect(mockPrisma.bagPurchase.findMany).not.toHaveBeenCalled();
      // These three were the original OOM paths — all must be absent:
      expect(mockPrisma.invoice.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.packingSession.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.driverTrip.findMany).not.toHaveBeenCalled();
    });

    it('walk-in revenue added to invoice revenue via aggregate', async () => {
      setupPnL({
        invoiceRevenue: '100.00',
        walkInAmount:   '25.00',
      });

      const result = await service.getProfitLoss({});

      expect(result.revenue).toBe('125.00');
      expect(mockPrisma.stockExit.aggregate).toHaveBeenCalled();
    });

    it('applies a default date range when no dates are given', async () => {
      setupPnL({ invoiceRevenue: '0' });

      await service.getProfitLoss({});

      // The walk-in aggregate's where.date should have a gte set to
      // ~(now - DEFAULT_LOOKBACK_DAYS), proving the default was injected.
      const aggCall = mockPrisma.stockExit.aggregate.mock.calls[0][0];
      expect(aggCall.where.date?.gte).toBeInstanceOf(Date);

      const msAgo = Date.now() - aggCall.where.date.gte.getTime();
      const daysAgo = msAgo / (1000 * 60 * 60 * 24);
      expect(daysAgo).toBeGreaterThan(DEFAULT_LOOKBACK_DAYS - 1);
      expect(daysAgo).toBeLessThan(DEFAULT_LOOKBACK_DAYS + 1);
    });

    it('passes explicit date range straight through without clamping', async () => {
      setupPnL({ invoiceRevenue: '0' });

      await service.getProfitLoss({ dateFrom: '2024-01-01', dateTo: '2024-03-31' });

      const aggCall = mockPrisma.stockExit.aggregate.mock.calls[0][0];
      expect(aggCall.where.date.gte).toEqual(new Date('2024-01-01'));
      expect(aggCall.where.date.lte).toEqual(new Date('2024-03-31'));
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
    } = {}) {
      mockPrisma.packingSession.aggregate.mockResolvedValue(
        { _sum: { varianceKg: dec(totalVarianceKg) } },
      );
      mockPrisma.$queryRaw.mockResolvedValue([{ total_variance_cost: totalVarianceCost }]);
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
  });

  // =========================================================================
  // getClientLedger — runningBalance computed correctly; unchanged shape
  // =========================================================================

  describe('getClientLedger()', () => {
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
      setupTransaction({ packedStocks: { 'ps-1': { id: 'ps-1', quantity: 100 }, 'ps-2': { id: 'ps-2', quantity: 50 } } });

      const result = await service.submitPhysicalCount(
        { items: [{ packedStockId: 'ps-1', actualQuantity: 80 }, { packedStockId: 'ps-2', actualQuantity: 60 }] },
        'clerk-user-id',
      );

      expect(result.adjustmentsCreated).toBe(2);
      expect(result.details).toHaveLength(2);
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
  // getWorkerEarnings — DB aggregates for totals; sessions paginated
  // =========================================================================

  describe('getWorkerEarnings()', () => {
    it('throws NotFoundException when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);
      await expect(service.getWorkerEarnings('nonexistent', {})).rejects.toThrow(NotFoundException);
    });

    it('totals computed from DB aggregates — not in-memory folds', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue({ id: 'w-1', name: 'Ahmed' });
      mockPrisma.packingSession.aggregate.mockResolvedValue({ _sum: { sessionEarnings: dec('500.00') } });
      mockPrisma.workerPayment.aggregate.mockResolvedValue({ _sum: { amount: dec('200.00') } });
      mockPrisma.packingSession.count.mockResolvedValue(2);
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's-1', date: new Date(), sessionEarnings: dec('300.00') },
        { id: 's-2', date: new Date(), sessionEarnings: dec('200.00') },
      ]);
      mockPrisma.workerPayment.findMany.mockResolvedValue([
        { id: 'p-1', date: new Date(), amount: dec('200.00'), notes: null },
      ]);

      const result = await service.getWorkerEarnings('w-1', {});

      expect(result.totalEarned).toBe('500.00');
      expect(result.totalPaid).toBe('200.00');
      expect(result.totalOwed).toBe('300.00');
      expect(result.sessions.data).toHaveLength(2);
      expect(result.sessions.total).toBe(2);
      expect(result.sessions.page).toBe(1);
      expect(mockPrisma.packingSession.aggregate).toHaveBeenCalled();
      expect(mockPrisma.workerPayment.aggregate).toHaveBeenCalled();
    });

    it('pagination: page 2 returns different rows but same grand totals', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue({ id: 'w-1', name: 'Ahmed' });
      mockPrisma.packingSession.aggregate.mockResolvedValue({ _sum: { sessionEarnings: dec('1000.00') } });
      mockPrisma.workerPayment.aggregate.mockResolvedValue({ _sum: { amount: dec('400.00') } });
      mockPrisma.packingSession.count.mockResolvedValue(10);
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's-6', date: new Date(), sessionEarnings: dec('150.00') },
      ]);
      mockPrisma.workerPayment.findMany.mockResolvedValue([]);

      const result = await service.getWorkerEarnings('w-1', { page: 2, limit: 5 });

      expect(result.totalEarned).toBe('1000.00');
      expect(result.totalPaid).toBe('400.00');
      expect(result.totalOwed).toBe('600.00');
      expect(result.sessions.total).toBe(10);
      expect(result.sessions.page).toBe(2);
      expect(result.sessions.limit).toBe(5);
      expect(result.sessions.data).toHaveLength(1);
    });

    it('session findMany always carries a bounded take', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue({ id: 'w-1', name: 'Ahmed' });
      mockPrisma.packingSession.aggregate.mockResolvedValue({ _sum: { sessionEarnings: null } });
      mockPrisma.workerPayment.aggregate.mockResolvedValue({ _sum: { amount: null } });
      mockPrisma.packingSession.count.mockResolvedValue(0);
      mockPrisma.packingSession.findMany.mockResolvedValue([]);
      mockPrisma.workerPayment.findMany.mockResolvedValue([]);

      await service.getWorkerEarnings('w-1', { limit: 50 });

      const args = mockPrisma.packingSession.findMany.mock.calls[0][0];
      expect(args.take).toBe(50);
    });

    it('applies default date range when no dates given', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue({ id: 'w-1', name: 'Ahmed' });
      mockPrisma.packingSession.aggregate.mockResolvedValue({ _sum: { sessionEarnings: null } });
      mockPrisma.workerPayment.aggregate.mockResolvedValue({ _sum: { amount: null } });
      mockPrisma.packingSession.count.mockResolvedValue(0);
      mockPrisma.packingSession.findMany.mockResolvedValue([]);
      mockPrisma.workerPayment.findMany.mockResolvedValue([]);

      await service.getWorkerEarnings('w-1', {});

      const aggCall = mockPrisma.packingSession.aggregate.mock.calls[0][0];
      expect(aggCall.where.date?.gte).toBeInstanceOf(Date);
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
    getWorkerEarnings:   fn(),
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

  it('worker-earnings: accountant → ForbiddenException (CONSTRAINT 11)', () => {
    expect(() => rolesGuard.canActivate(mockContext('accountant', 'getWorkerEarnings'))).toThrow(ForbiddenException);
  });
  it('worker-earnings: sales_rep → ForbiddenException (CONSTRAINT 11)', () => {
    expect(() => rolesGuard.canActivate(mockContext('sales_rep', 'getWorkerEarnings'))).toThrow(ForbiddenException);
  });
  it('worker-earnings: owner → passes', () => {
    expect(rolesGuard.canActivate(mockContext('owner', 'getWorkerEarnings'))).toBe(true);
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
