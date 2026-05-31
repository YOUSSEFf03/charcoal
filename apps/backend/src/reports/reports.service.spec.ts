import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../auth/roles.guard';
import { Reflector } from '@nestjs/core';

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

function makeDecimal(value: string) {
  return { toString: () => value };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('ReportsService', () => {
  let service: ReportsService;

  const mockPrisma = {
    invoice: { findMany: fn() },
    stockExit: { findMany: fn() },
    bagPurchase: { findMany: fn() },
    packingSession: { findMany: fn() },
    driverTrip: { findMany: fn() },
    stockLot: { findMany: fn() },
    container: { findMany: fn() },
    client: { findUnique: fn() },
    payment: { findMany: fn() },
    worker: { findUnique: fn() },
    workerPayment: { findMany: fn() },
    packedStock: { findMany: fn(), findUnique: fn(), update: fn() },
    stockAdjustment: { create: fn() },
    user: { findUnique: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  // =========================================================================
  // getProfitLoss — owner only, gross_profit field present
  // =========================================================================

  describe('getProfitLoss()', () => {
    it('returns 200 with gross_profit field for owner', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([
        { lines: [{ lineTotal: '100.00' }], total: makeDecimal('100.00') },
      ]);
      mockPrisma.stockExit.findMany.mockResolvedValue([]);
      mockPrisma.bagPurchase.findMany.mockResolvedValue([]);
      mockPrisma.packingSession.findMany.mockResolvedValue([]);
      mockPrisma.driverTrip.findMany.mockResolvedValue([]);

      const result = await service.getProfitLoss({});

      expect(result).toHaveProperty('grossProfit');
      expect(result.grossProfit).toBe('100.00');
      expect(result.revenue).toBe('100.00');
    });

    it('computes gross_profit = revenue - cogs - bagCost - varianceCost - deliveryCost', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([
        { lines: [{ lineTotal: '500.00' }] },
      ]);
      mockPrisma.stockExit.findMany.mockResolvedValue([
        {
          quantity: 10,
          bagType: { nominalKg: makeDecimal('5.000') },
          packedStock: { lot: { costPerKg: makeDecimal('1.0000') } },
        },
      ]);
      mockPrisma.bagPurchase.findMany.mockResolvedValue([
        { totalCost: makeDecimal('20.00') },
      ]);
      mockPrisma.packingSession.findMany.mockResolvedValue([
        {
          varianceKg: makeDecimal('-2.000'),
          lot: { costPerKg: makeDecimal('1.0000') },
        },
      ]);
      mockPrisma.driverTrip.findMany.mockResolvedValue([
        { fuelCost: makeDecimal('15.00'), otherExpenses: [{ amount: '5.00' }] },
      ]);

      const result = await service.getProfitLoss({});

      // revenue=500, cogs=10×5×1=50, bagCost=20, varianceCost=2×1=2, deliveryCost=15+5=20
      // gross_profit = 500-50-20-2-20 = 408
      expect(result.grossProfit).toBe('408.00');
      expect(result.cogs).toBe('50.00');
      expect(result.bagCost).toBe('20.00');
      expect(result.varianceCost).toBe('2.00');
      expect(result.deliveryCost).toBe('20.00');
    });
  });

  // =========================================================================
  // getClientLedger — runningBalance computed correctly
  // =========================================================================

  describe('getClientLedger()', () => {
    it('runningBalance: invoice $100 then payment $40 → final balance $60', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({
        id: 'client-1',
        currency: 'USD',
      });

      const invoiceDate = new Date('2024-01-01');
      const paymentDate = new Date('2024-01-05');

      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          issuedAt: invoiceDate,
          createdAt: invoiceDate,
          total: makeDecimal('100.00'),
          lines: [],
        },
      ]);
      mockPrisma.payment.findMany.mockResolvedValue([
        {
          id: 'pmt-1',
          date: paymentDate,
          amount: makeDecimal('40.00'),
        },
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
    function setupTransaction(txMocks: {
      user?: any;
      packedStocks?: Record<string, any>;
    }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userMock = fn();
      userMock.mockResolvedValue(txMocks.user ?? { id: 'db-user-id', clerkId: 'clerk-user-id' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const psLookupMock = fn();
      psLookupMock.mockImplementation(({ where }: any) =>
        Promise.resolve(txMocks.packedStocks?.[where.id] ?? null),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adjustmentCreateMock = fn();
      adjustmentCreateMock.mockImplementation((data: any) =>
        Promise.resolve({ id: 'adj-' + Math.random(), ...data.data }),
      );

      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          user: { findUnique: userMock },
          packedStock: { findUnique: psLookupMock, update: fn() },
          stockAdjustment: { create: adjustmentCreateMock },
        };
        return cb(tx);
      });
    }

    it('creates StockAdjustment for each item where actualQuantity !== systemQuantity', async () => {
      setupTransaction({
        packedStocks: {
          'ps-1': { id: 'ps-1', quantity: 100 },
          'ps-2': { id: 'ps-2', quantity: 50 },
        },
      });

      const result = await service.submitPhysicalCount(
        { items: [
          { packedStockId: 'ps-1', actualQuantity: 80 },
          { packedStockId: 'ps-2', actualQuantity: 60 },
        ]},
        'clerk-user-id',
      );

      expect(result.adjustmentsCreated).toBe(2);
      expect(result.details).toHaveLength(2);
    });

    it('creates zero adjustments when all actualQuantity equals systemQuantity', async () => {
      setupTransaction({
        packedStocks: {
          'ps-1': { id: 'ps-1', quantity: 100 },
        },
      });

      const result = await service.submitPhysicalCount(
        { items: [{ packedStockId: 'ps-1', actualQuantity: 100 }] },
        'clerk-user-id',
      );

      expect(result.adjustmentsCreated).toBe(0);
      expect(result.details).toHaveLength(0);
    });

    it('sets approvedById = the DB user id derived from request.user.userId (not from body)', async () => {
      const expectedUserId = 'owner-db-id';
      let capturedApprovedById: string | undefined;

      const userFn = fn();
      userFn.mockResolvedValue({ id: expectedUserId });
      const psFn = fn();
      psFn.mockResolvedValue({ id: 'ps-1', quantity: 10 });
      const updateFn = fn();
      updateFn.mockResolvedValue({});
      const createFn = fn();
      createFn.mockImplementation((args: any) => {
        capturedApprovedById = args.data.approvedById;
        return Promise.resolve({ id: 'adj-1', ...args.data });
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          user: { findUnique: userFn },
          packedStock: { findUnique: psFn, update: updateFn },
          stockAdjustment: { create: createFn },
        };
        return cb(tx);
      });

      await service.submitPhysicalCount(
        { items: [{ packedStockId: 'ps-1', actualQuantity: 5 }] },
        'clerk-user-id',
      );

      expect(capturedApprovedById).toBe(expectedUserId);
    });

    it('does not include packedStockId not found in submitted items', async () => {
      setupTransaction({
        packedStocks: {
          'ps-1': { id: 'ps-1', quantity: 100 },
          // ps-2 not in packedStocks — would throw NotFoundException
        },
      });

      await expect(
        service.submitPhysicalCount(
          { items: [{ packedStockId: 'ps-missing', actualQuantity: 5 }] },
          'clerk-user-id',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // getWorkerEarnings — owner only, 404 for unknown worker
  // =========================================================================

  describe('getWorkerEarnings()', () => {
    it('throws NotFoundException when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);

      await expect(
        service.getWorkerEarnings('nonexistent', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns totalOwed = totalEarned - totalPaid using decimal.js', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue({
        id: 'w-1',
        name: 'Ahmed',
        totalEarned: makeDecimal('500.00'),
        totalPaid: makeDecimal('200.00'),
      });

      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's-1', date: new Date(), lotId: 'lot-1', sessionEarnings: makeDecimal('300.00') },
        { id: 's-2', date: new Date(), lotId: 'lot-1', sessionEarnings: makeDecimal('200.00') },
      ]);
      mockPrisma.workerPayment.findMany.mockResolvedValue([
        { id: 'p-1', date: new Date(), amount: makeDecimal('100.00'), notes: null },
        { id: 'p-2', date: new Date(), amount: makeDecimal('100.00'), notes: null },
      ]);

      const result = await service.getWorkerEarnings('w-1', {});

      expect(result.totalEarned).toBe('500.00');
      expect(result.totalPaid).toBe('200.00');
      expect(result.totalOwed).toBe('300.00');
    });
  });
});

// ---------------------------------------------------------------------------
// Role enforcement tests — verify @Roles decorators via RolesGuard
// ---------------------------------------------------------------------------

describe('ReportsController — role enforcement', () => {
  let controller: ReportsController;
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  const mockService = {
    getProfitLoss: fn(),
    getStockValue: fn(),
    getVariance: fn(),
    getContainerCosts: fn(),
    getClientLedger: fn(),
    getWorkerEarnings: fn(),
    getPhysicalCount: fn(),
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

    controller = module.get<ReportsController>(ReportsController);
    reflector = module.get<Reflector>(Reflector);
    rolesGuard = new RolesGuard(reflector);
  });

  function mockContext(role: string, handlerName: string) {
    const handler = (ReportsController.prototype as any)[handlerName];
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: { role, userId: 'user-id' } }),
      }),
      getHandler: () => handler,
      getClass: () => ReportsController,
    } as any;
  }

  it('profit-loss: accountant receives ForbiddenException (CONSTRAINT 11)', () => {
    const ctx = mockContext('accountant', 'getProfitLoss');
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('profit-loss: sales_rep receives ForbiddenException (CONSTRAINT 11)', () => {
    const ctx = mockContext('sales_rep', 'getProfitLoss');
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('profit-loss: owner passes RolesGuard', () => {
    const ctx = mockContext('owner', 'getProfitLoss');
    expect(rolesGuard.canActivate(ctx)).toBe(true);
  });

  it('worker-earnings: accountant receives ForbiddenException (CONSTRAINT 11)', () => {
    const ctx = mockContext('accountant', 'getWorkerEarnings');
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('worker-earnings: sales_rep receives ForbiddenException (CONSTRAINT 11)', () => {
    const ctx = mockContext('sales_rep', 'getWorkerEarnings');
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('worker-earnings: owner passes RolesGuard', () => {
    const ctx = mockContext('owner', 'getWorkerEarnings');
    expect(rolesGuard.canActivate(ctx)).toBe(true);
  });

  it('stock-value: sales_rep receives ForbiddenException (CONSTRAINT 12)', () => {
    const ctx = mockContext('sales_rep', 'getStockValue');
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('stock-value: worker receives ForbiddenException (CONSTRAINT 12)', () => {
    const ctx = mockContext('worker', 'getStockValue');
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('stock-value: accountant passes RolesGuard', () => {
    const ctx = mockContext('accountant', 'getStockValue');
    expect(rolesGuard.canActivate(ctx)).toBe(true);
  });
});
