import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkersService } from './workers.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }
function dec(v: string) { return { toString: () => v }; }

describe('WorkersService', () => {
  let service: WorkersService;

  const mockPrisma = {
    worker:            { findUnique: fn(), findMany: fn(), count: fn(), create: fn(), update: fn(), delete: fn() },
    workerPayment:     { findUnique: fn(), findMany: fn(), count: fn(), create: fn(), deleteMany: fn(), aggregate: fn(), groupBy: fn() },
    workerCost:        { aggregate: fn(), groupBy: fn(), findMany: fn(), findFirst: fn(), count: fn(), create: fn(), update: fn(), findUnique: fn(), deleteMany: fn() },
    packingSession:    { aggregate: fn(), groupBy: fn(), findMany: fn() },
    bagType:           { findMany: fn() },
    user:              { findUnique: fn(), create: fn() },
    $transaction:      fn(),
  };

  const mockSettingsService = {
    getDailyWageRate: fn(),
    setDailyWageRate: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default cost to 0 so tests that don't care about it still pass.
    mockPrisma.workerCost.aggregate.mockResolvedValue({ _sum: { amount: null } });
    mockPrisma.workerCost.groupBy.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();
    service = module.get<WorkersService>(WorkersService);
  });

  function makeWorker(overrides: Record<string, unknown> = {}) {
    return {
      id:              overrides.id              ?? 'worker-uuid-1',
      name:            overrides.name            ?? 'Ahmed',
      phone:           overrides.phone           ?? null,
      notes:           overrides.notes           ?? null,
      ratesPerBagType: overrides.ratesPerBagType ?? [],
      totalEarned:     dec((overrides.totalEarned as string | undefined) ?? '0.00'), // deprecated cache — ignored
      totalPaid:       dec((overrides.totalPaid   as string | undefined) ?? '0.00'), // deprecated cache — ignored
      totalBagsPacked: [],
      createdAt:       new Date(),
      updatedAt:       new Date(),
    };
  }

  /** Mock the three aggregates used by computeTotals (called from findOne). */
  function mockAggregates(bagEarned: string, paid: string, costEarned = '0.00') {
    mockPrisma.packingSession.aggregate.mockResolvedValue({ _sum: { sessionEarnings: dec(bagEarned) } });
    mockPrisma.workerPayment.aggregate.mockResolvedValue({ _sum: { amount: dec(paid) } });
    mockPrisma.workerCost.aggregate.mockResolvedValue({ _sum: { amount: dec(costEarned) } });
  }

  /** Mock the three groupBy queries used by findAll. */
  function mockGroupBy(workerId: string, bagEarned: string, paid: string, costEarned = '0.00') {
    mockPrisma.packingSession.groupBy.mockResolvedValue([
      { workerEntityId: workerId, _sum: { sessionEarnings: dec(bagEarned) } },
    ]);
    mockPrisma.workerPayment.groupBy.mockResolvedValue([
      { workerId, _sum: { amount: dec(paid) } },
    ]);
    mockPrisma.workerCost.groupBy.mockResolvedValue(
      costEarned !== '0.00' ? [{ workerId, _sum: { amount: dec(costEarned) } }] : [],
    );
  }

  // =========================================================================
  // findAll() — totals computed from aggregation, not stored columns
  // =========================================================================

  describe('findAll()', () => {
    it('computes totalOwed = earned - paid (200.00 - 75.50 = 124.50)', async () => {
      const worker = makeWorker({ id: 'w1' });
      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);
      mockGroupBy('w1', '200.00', '75.50');

      const result = await service.findAll(1, 20);

      expect(result.data[0].pieceEarned).toBe('200.00');
      expect(result.data[0].totalEarned).toBe('200.00');
      expect(result.data[0].totalPaid).toBe('75.50');
      expect(result.data[0].totalOwed).toBe('124.50');
    });

    it('high-precision decimal: earned=1000.00, paid=999.99 → totalOwed=0.01 (no float drift)', async () => {
      const worker = makeWorker({ id: 'w1' });
      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);
      mockGroupBy('w1', '1000.00', '999.99');

      const result = await service.findAll(1, 20);
      expect(result.data[0].totalOwed).toBe('0.01');
    });

    it('totalOwed is "0.00" when earned equals paid', async () => {
      const worker = makeWorker({ id: 'w1' });
      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);
      mockGroupBy('w1', '500.00', '500.00');

      const result = await service.findAll(1, 20);
      expect(result.data[0].totalOwed).toBe('0.00');
    });

    it('worker with no sessions, no payments, no earnings shows all-zero totals', async () => {
      const worker = makeWorker({ id: 'w1' });
      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);
      mockPrisma.packingSession.groupBy.mockResolvedValue([]);
      mockPrisma.workerPayment.groupBy.mockResolvedValue([]);
      mockPrisma.workerCost.groupBy.mockResolvedValue([]);

      const result = await service.findAll(1, 20);
      expect(result.data[0].pieceEarned).toBe('0.00');
      expect(result.data[0].costEarned).toBe('0.00');
      expect(result.data[0].totalEarned).toBe('0.00');
      expect(result.data[0].totalPaid).toBe('0.00');
      expect(result.data[0].totalOwed).toBe('0.00');
    });

    it('returns paginated metadata (page, limit, total)', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      const result = await service.findAll(2, 10);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.total).toBe(0);
    });

    it('costEarned included in the batched list totals', async () => {
      const worker = makeWorker({ id: 'w1' });
      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);
      mockGroupBy('w1', '0.00', '0.00', '100.00');

      const result = await service.findAll(1, 20);
      expect(result.data[0].pieceEarned).toBe('0.00');
      expect(result.data[0].costEarned).toBe('100.00');
      expect(result.data[0].totalEarned).toBe('100.00');
    });
  });

  // =========================================================================
  // create() — every worker gets a linked local User so it has a valid
  // Payment.receiverId to reference (see the 20260821000000_add_worker_
  // user_link migration).
  // =========================================================================

  describe('create()', () => {
    function mockTx() {
      const tx = {
        user: { create: fn() },
        worker: { create: fn() },
      };
      mockPrisma.$transaction.mockImplementation((cb: any) => cb(tx));
      return tx;
    }

    it('creates a local User (role=worker) and links it via Worker.userId', async () => {
      const tx = mockTx();
      const createdUser = { id: 'user-uuid-1', clerkId: 'local_x', email: 'local_x@local.internal', name: 'Ahmed', role: 'worker' };
      tx.user.create.mockResolvedValue(createdUser);
      tx.worker.create.mockResolvedValue(makeWorker({ id: 'w-new', name: 'Ahmed' }));

      await service.create({ name: 'Ahmed', phone: '+961-1-111' } as any);

      expect(tx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Ahmed', role: 'worker', phone: '+961-1-111' }),
        }),
      );
      expect(tx.worker.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Ahmed', userId: 'user-uuid-1' }),
        }),
      );
    });

    it('the linked User and the Worker are created in the SAME transaction — never two independent writes', async () => {
      const tx = mockTx();
      tx.user.create.mockResolvedValue({ id: 'user-uuid-2' });
      tx.worker.create.mockResolvedValue(makeWorker({ id: 'w-new-2' }));

      await service.create({ name: 'Fadi' } as any);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // worker.create must run against the SAME tx client user.create ran
      // against, not the top-level mockPrisma — this is the anti-orphan
      // guarantee (a User is never created without its Worker, or vice versa).
      expect(mockPrisma.worker.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // findOne() — single-worker live computation
  // =========================================================================

  describe('findOne()', () => {
    it('returns worker with totalOwed computed from source records', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockAggregates('300.00', '100.00');

      const result = await service.findOne('w1');
      expect(result.pieceEarned).toBe('300.00');
      expect(result.totalEarned).toBe('300.00');
      expect(result.totalPaid).toBe('100.00');
      expect(result.totalOwed).toBe('200.00');
    });

    it('ignores the stale stored totalEarned/totalPaid columns on the Worker row', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(
        makeWorker({ id: 'w1', totalEarned: '999.00', totalPaid: '999.00' }),
      );
      mockAggregates('300.00', '100.00');

      const result = await service.findOne('w1');
      expect(result.totalEarned).toBe('300.00'); // not 999
      expect(result.totalPaid).toBe('100.00');
      expect(result.totalOwed).toBe('200.00');
    });

    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('nonexistent')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_FOUND' }),
      });
    });

    it('computeTotals calls worker.findUnique exactly once per findOne call', async () => {
      // Regression: old code called findUnique twice (once in findOne, once inside computeTotals).
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockAggregates('0.00', '0.00');

      await service.findOne('w1');
      expect(mockPrisma.worker.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // QA: piece-rate + earnings-entry combined accuracy
  // Worker: M bags packed + N earnings entries → totalEarned by hand.
  // totalOwed = totalEarned − Σ payments.
  // =========================================================================

  describe('QA: combined piece + cost earnings', () => {
    it('$270.00 earnings entries + $108.96 bags - $126.76 paid = correct totalOwed', async () => {
      // Hand calc:
      //   cost:   270.00 (e.g. logged daily-wage entries)
      //   piece:  108.96
      //   total:  270.00 + 108.96 = 378.96
      //   paid:   126.76
      //   owed:   378.96 - 126.76 = 252.20
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w-qa' }));
      mockAggregates('108.96', '126.76', '270.00');

      const result = await service.findOne('w-qa');

      expect(result.pieceEarned).toBe('108.96');
      expect(result.costEarned).toBe('270.00');
      expect(result.totalEarned).toBe('378.96');
      expect(result.totalPaid).toBe('126.76');
      expect(result.totalOwed).toBe('252.20');
    });

    it('zero earnings entries means costEarned=0, totalEarned is piece-only', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockAggregates('50.00', '0.00', '0.00');

      const result = await service.findOne('w1');
      expect(result.costEarned).toBe('0.00');
      expect(result.totalEarned).toBe('50.00');
    });

    it('no float drift: 3 × $33.33 entries = $99.99, not $99.990000001', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockAggregates('0.00', '0.00', '99.99');

      const result = await service.findOne('w1');
      expect(result.costEarned).toBe('99.99');
    });
  });

  // =========================================================================
  // setRates() — full replacement, not append
  // =========================================================================

  describe('setRates()', () => {
    it('replaces the entire ratesPerBagType array — does NOT append to existing rates', async () => {
      const workerId = 'w2';
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: workerId }));
      mockAggregates('0.00', '0.00');
      mockPrisma.worker.update.mockResolvedValue({});

      await service.setRates(workerId, {
        ratesPerBagType: [{ bagTypeId: 'new-bag-id', ratePerBag: '0.10' }],
      });

      const updateCall = mockPrisma.worker.update.mock.calls[0][0];
      expect(updateCall.data.ratesPerBagType).toHaveLength(1);
      expect(updateCall.data.ratesPerBagType[0].bagTypeId).toBe('new-bag-id');
    });

    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);
      await expect(
        service.setRates('ghost', { ratesPerBagType: [] }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // addPayment() — creates WorkerPayment; does NOT update stored totalPaid
  // =========================================================================

  describe('addPayment()', () => {
    it('creates a WorkerPayment record without updating worker.totalPaid', async () => {
      const workerId = 'w3';
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: workerId }));
      mockPrisma.workerPayment.create.mockResolvedValue({
        id: 'wp-1', workerId, amount: '25.00', date: new Date(),
      });

      await service.addPayment(workerId, { amount: '25.00' });

      expect(mockPrisma.workerPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ workerId, amount: '25.00' }) }),
      );
      // Must NOT call worker.update — totalPaid is computed on read, not stored
      expect(mockPrisma.worker.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);
      await expect(service.addPayment('ghost', { amount: '10.00' })).rejects.toThrow(NotFoundException);
      await expect(service.addPayment('ghost', { amount: '10.00' })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_FOUND' }),
      });
    });
  });

  // =========================================================================
  // listPayments() — server-side pagination backing Employees.tsx's "See
  // more" history feed (useWorkerPayments). Page size is fixed by the
  // frontend at 20; these tests verify the backend actually honors page/limit
  // (skip/take) and returns the {data,total,page,limit} contract every
  // paginated endpoint in this codebase uses — not just a happy-path list.
  // =========================================================================

  describe('listPayments()', () => {
    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);
      await expect(service.listPayments('ghost', 1, 20)).rejects.toThrow(NotFoundException);
    });

    it('page 1: returns the first `limit` rows, newest first, with the full pagination envelope', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.$transaction.mockResolvedValue([
        [{ id: 'wp-1', workerId: 'w1', amount: '25.00', date: new Date('2026-01-10') }],
        45, // total across all pages — more than fit on page 1
      ]);

      const result = await service.listPayments('w1', 1, 20);

      expect(mockPrisma.workerPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workerId: 'w1' }, skip: 0, take: 20, orderBy: { date: 'desc' } }),
      );
      expect(result).toEqual({ data: [{ id: 'wp-1', workerId: 'w1', amount: '25.00', date: new Date('2026-01-10') }], total: 45, page: 1, limit: 20 });
    });

    it('page 2: computes skip = (page-1)*limit — proves "See more" fetches the NEXT batch, not the same one again', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.$transaction.mockResolvedValue([
        [{ id: 'wp-21', workerId: 'w1', amount: '10.00', date: new Date('2025-12-01') }],
        45,
      ]);

      const result = await service.listPayments('w1', 2, 20);

      expect(mockPrisma.workerPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
      expect(result.page).toBe(2);
    });

    // ── date-range filter — powers the Expenses page's Employee Payments tab
    // (useAllWorkerPayments), which needs exactly one worker's payments for
    // the SELECTED MONTH, not a fixed-size recent page sliced client-side.
    describe('with dateFrom/dateTo', () => {
      it('applies both bounds as an inclusive gte/lte filter on WorkerPayment.date, alongside workerId', async () => {
        mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
        mockPrisma.$transaction.mockResolvedValue([[], 0]);

        await service.listPayments('w1', 1, 20, '2026-09-01', '2026-09-30');

        expect(mockPrisma.workerPayment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              workerId: 'w1',
              date: { gte: new Date('2026-09-01'), lte: new Date('2026-09-30') },
            },
          }),
        );
        expect(mockPrisma.workerPayment.count).toHaveBeenCalledWith({
          where: { workerId: 'w1', date: { gte: new Date('2026-09-01'), lte: new Date('2026-09-30') } },
        });
      });

      it('a payment dated outside the range is excluded by the WHERE clause passed to Prisma (not a client-side slice)', async () => {
        // This test asserts the CONTRACT (the where clause sent to Prisma) —
        // real exclusion is Postgres's job, verified separately by the
        // employee-payments integration spec against a real database.
        mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
        mockPrisma.$transaction.mockResolvedValue([
          [{ id: 'wp-in-range', workerId: 'w1', amount: '100.00', date: new Date('2026-09-15') }],
          1,
        ]);

        const result = await service.listPayments('w1', 1, 20, '2026-09-01', '2026-09-30');

        expect(result.data).toHaveLength(1);
        expect(mockPrisma.workerPayment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ date: { gte: new Date('2026-09-01'), lte: new Date('2026-09-30') } }) }),
        );
      });

      it('omitting both dateFrom/dateTo keeps the original workerId-only filter — no regression for existing callers (Employees.tsx)', async () => {
        mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
        mockPrisma.$transaction.mockResolvedValue([[], 0]);

        await service.listPayments('w1', 1, 20);

        expect(mockPrisma.workerPayment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { workerId: 'w1' } }),
        );
      });

      it('a lower-bound-only filter (dateFrom, no dateTo) applies gte with no lte', async () => {
        mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
        mockPrisma.$transaction.mockResolvedValue([[], 0]);

        await service.listPayments('w1', 1, 20, '2026-09-01');

        expect(mockPrisma.workerPayment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { workerId: 'w1', date: { gte: new Date('2026-09-01') } } }),
        );
      });
    });
  });

  // =========================================================================
  // Worker earnings (WorkerCost) CRUD
  // =========================================================================

  describe('listEarnings()', () => {
    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);
      await expect(service.listEarnings('ghost', 1, 20)).rejects.toThrow(NotFoundException);
    });

    it('returns paginated earnings for an existing worker', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockAggregates('0.00', '0.00');
      mockPrisma.$transaction.mockResolvedValue([
        [{ id: 'wc-1', workerId: 'w1', amount: '30.00', category: 'daily_wage' }],
        1,
      ]);

      const result = await service.listEarnings('w1', 1, 20);
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('orders newest-first and computes skip/take for a requested page — proves page 2 returns the next batch, not a duplicate of page 1', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.$transaction.mockResolvedValue([
        [{ id: 'wc-51', workerId: 'w1', amount: '5.00', category: 'bonus' }],
        120, // e.g. 120 earnings total — the exact "many records" scenario See More exists for
      ]);

      const result = await service.listEarnings('w1', 2, 50);

      expect(mockPrisma.workerCost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workerId: 'w1' }, skip: 50, take: 50, orderBy: { date: 'desc' } }),
      );
      expect(result).toEqual({ data: [{ id: 'wc-51', workerId: 'w1', amount: '5.00', category: 'bonus' }], total: 120, page: 2, limit: 50 });
    });

    it('last page: fewer rows than `limit` still returns correctly, proving See More correctly detects exhaustion', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      // 120 total, limit 50 → page 3 has only 20 rows (101-120) — the batch
      // after which the frontend's hasNextPage must become false.
      mockPrisma.$transaction.mockResolvedValue([
        Array.from({ length: 20 }, (_, i) => ({ id: `wc-${101 + i}`, workerId: 'w1', amount: '1.00', category: 'bonus' })),
        120,
      ]);

      const result = await service.listEarnings('w1', 3, 50);

      expect(result.data).toHaveLength(20);
      expect(result.total).toBe(120);
      // page * limit (150) >= total (120) → frontend's nextPageParam formula
      // correctly yields "no more pages" from this response alone.
      expect(result.page * result.limit).toBeGreaterThanOrEqual(result.total);
    });
  });

  describe('createEarning()', () => {
    it('creates a WorkerCost row with createdById resolved from the Clerk user, never from the body', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'internal-user-1', clerkId: 'clerk-abc' });
      mockPrisma.workerCost.create.mockResolvedValue({ id: 'wc-1' });

      await service.createEarning(
        'w1',
        { amount: '30.00', category: 'daily_wage' as any },
        'clerk-abc',
      );

      expect(mockPrisma.workerCost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workerId: 'w1', amount: '30.00', category: 'daily_wage', createdById: 'internal-user-1' }),
        }),
      );
    });

    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);
      await expect(
        service.createEarning('ghost', { amount: '10.00', category: 'bonus' as any }, 'clerk-abc'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException NO_USER when the Clerk user has not been synced', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.createEarning('w1', { amount: '10.00', category: 'bonus' as any }, 'clerk-unsynced'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateEarning()', () => {
    it('applies the update when within the edit window', async () => {
      const recent = new Date(Date.now() - 60 * 1000); // 1 minute ago
      mockPrisma.workerCost.findUnique.mockResolvedValue({
        id: 'wc-1', workerId: 'w1', amount: '30.00', category: 'daily_wage', createdAt: recent,
      });
      mockPrisma.workerCost.update.mockResolvedValue({ id: 'wc-1', amount: '35.00' });

      await service.updateEarning('w1', 'wc-1', { amount: '35.00' });
      expect(mockPrisma.workerCost.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'wc-1' }, data: expect.objectContaining({ amount: '35.00' }) }),
      );
    });

    it('rejects the edit with EDIT_WINDOW_EXPIRED once past the window', async () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      mockPrisma.workerCost.findUnique.mockResolvedValue({
        id: 'wc-1', workerId: 'w1', amount: '30.00', category: 'daily_wage', createdAt: old,
      });

      await expect(service.updateEarning('w1', 'wc-1', { amount: '35.00' })).rejects.toThrow(ForbiddenException);
      await expect(service.updateEarning('w1', 'wc-1', { amount: '35.00' })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'EDIT_WINDOW_EXPIRED' }),
      });
      expect(mockPrisma.workerCost.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException NOT_FOUND when the earning does not belong to this worker', async () => {
      mockPrisma.workerCost.findUnique.mockResolvedValue({
        id: 'wc-1', workerId: 'someone-else', amount: '30.00', createdAt: new Date(),
      });
      await expect(service.updateEarning('w1', 'wc-1', { amount: '35.00' })).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // remove() — must clear WorkerCost rows too (ON DELETE RESTRICT)
  // =========================================================================

  describe('remove()', () => {
    it('deletes payments and cost entries before deleting the worker when totalOwed is zero', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockAggregates('100.00', '100.00'); // earned 100, paid 100 — zero balance

      await service.remove('w1');

      expect(mockPrisma.workerPayment.deleteMany).toHaveBeenCalledWith({ where: { workerId: 'w1' } });
      expect(mockPrisma.workerCost.deleteMany).toHaveBeenCalledWith({ where: { workerId: 'w1' } });
      expect(mockPrisma.worker.delete).toHaveBeenCalledWith({ where: { id: 'w1' } });
    });

    it('OUTSTANDING_BALANCE: rejects deletion when the worker is still owed money, and deletes nothing', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockAggregates('500.00', '100.00'); // earned 500, paid 100 — owed 400

      await expect(service.remove('w1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'OUTSTANDING_BALANCE' }),
      });

      expect(mockPrisma.workerPayment.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.workerCost.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.worker.delete).not.toHaveBeenCalled();
    });

    it('OUTSTANDING_BALANCE: also rejects when the worker was overpaid (negative totalOwed)', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockAggregates('100.00', '250.00'); // earned 100, paid 250 — overpaid by 150

      await expect(service.remove('w1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'OUTSTANDING_BALANCE' }),
      });

      expect(mockPrisma.worker.delete).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND before ever computing a balance when the worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_FOUND' }),
      });

      expect(mockPrisma.packingSession.aggregate).not.toHaveBeenCalled();
      expect(mockPrisma.worker.delete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // logDailyWage() — "Add daily wage" button (Employee Detail audit,
  // 2026-09-05). Always uses SettingsService.getDailyWageRate(); creates a
  // real WorkerCost row (category daily_wage), never a fake frontend row.
  // =========================================================================

  describe('logDailyWage()', () => {
    it('creates a WorkerCost(daily_wage) row using the configured Settings amount — CASE 6/7', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockSettingsService.getDailyWageRate.mockResolvedValue(20);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'internal-user-1', clerkId: 'clerk-abc' });
      mockPrisma.workerCost.findFirst.mockResolvedValue(null);
      mockPrisma.workerCost.create.mockResolvedValue({ id: 'wc-daily-1' });

      await service.logDailyWage('w1', { date: '2026-09-05' }, 'clerk-abc');

      expect(mockPrisma.workerCost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workerId: 'w1', amount: '20.00', category: 'daily_wage',
            date: new Date('2026-09-05'), createdById: 'internal-user-1',
          }),
        }),
      );
    });

    it('CASE 8 — rejects a second daily wage for the same worker on the same date (duplicate protection)', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockSettingsService.getDailyWageRate.mockResolvedValue(20);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'internal-user-1' });
      mockPrisma.workerCost.findFirst.mockResolvedValue({ id: 'existing-wc', category: 'daily_wage', date: new Date('2026-09-05') });

      await expect(service.logDailyWage('w1', { date: '2026-09-05' }, 'clerk-abc')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'DAILY_WAGE_ALREADY_RECORDED' }),
      });
      expect(mockPrisma.workerCost.create).not.toHaveBeenCalled();
    });

    it('refuses to create a $0.00 earning when the daily wage is not configured in Settings', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockSettingsService.getDailyWageRate.mockResolvedValue(0);

      await expect(service.logDailyWage('w1', {}, 'clerk-abc')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'DAILY_WAGE_NOT_CONFIGURED' }),
      });
      expect(mockPrisma.workerCost.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);
      await expect(service.logDailyWage('ghost', {}, 'clerk-abc')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException NO_USER when the Clerk user has not been synced', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockSettingsService.getDailyWageRate.mockResolvedValue(20);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.logDailyWage('w1', {}, 'clerk-unsynced')).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // getStatement() — Statement of Account: opening balance + chronological
  // earning/payment entries + running balance (Employee Detail audit,
  // 2026-09-05). Mirrors ReportsService.getClientLedger()'s architecture.
  // =========================================================================

  describe('getStatement()', () => {
    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);
      await expect(service.getStatement('ghost')).rejects.toThrow(NotFoundException);
    });

    it('CASE 1/4 — running balance is cumulative earned minus cumulative paid, folded chronologically', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.workerCost.findMany.mockResolvedValue([
        { id: 'c1', date: new Date('2026-09-05'), amount: dec('20.00'), category: 'daily_wage', notes: null },
      ]);
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-09-08'), sessionEarnings: dec('12.00') },
        { id: 's2', date: new Date('2026-09-08'), sessionEarnings: dec('10.00') },
      ]);
      mockPrisma.workerPayment.findMany.mockResolvedValue([
        { id: 'p1', date: new Date('2026-09-10'), amount: dec('30.00'), method: 'cash', referenceNumber: null, notes: null },
      ]);

      const result = await service.getStatement('w1');

      expect(result.openingBalance).toBe('0.00');
      expect(result.entries).toHaveLength(4);
      expect(result.entries.map((e: any) => e.runningBalance)).toEqual(['20.00', '32.00', '42.00', '12.00']);
      expect(result.balance).toBe('12.00');
    });

    it('CASE 2 — per-bag (session), daily wage (cost), and payment entries all appear with the correct earned/paid split', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.workerCost.findMany.mockResolvedValue([
        { id: 'c1', date: new Date('2026-09-05'), amount: dec('20.00'), category: 'daily_wage', notes: null },
      ]);
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-09-08'), sessionEarnings: dec('12.00') },
      ]);
      mockPrisma.workerPayment.findMany.mockResolvedValue([
        { id: 'p1', date: new Date('2026-09-10'), amount: dec('30.00'), method: 'cash', referenceNumber: null, notes: null },
      ]);

      const result = await service.getStatement('w1');

      const cost = result.entries.find((e: any) => e.source === 'cost');
      const session = result.entries.find((e: any) => e.source === 'session');
      const payment = result.entries.find((e: any) => e.source === 'payment');
      expect(cost).toMatchObject({ type: 'earning', category: 'daily_wage', earned: '20.00', paid: '0.00' });
      expect(session).toMatchObject({ type: 'earning', earned: '12.00', paid: '0.00' });
      expect(payment).toMatchObject({ type: 'payment', method: 'cash', earned: '0.00', paid: '30.00' });
    });

    it('CASE 3 — every payment appears as its own entry, none merged', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.workerCost.findMany.mockResolvedValue([]);
      mockPrisma.packingSession.findMany.mockResolvedValue([]);
      mockPrisma.workerPayment.findMany.mockResolvedValue([
        { id: 'p1', date: new Date('2026-09-10'), amount: dec('10.00'), method: 'cash', referenceNumber: null, notes: null },
        { id: 'p2', date: new Date('2026-09-24'), amount: dec('42.00'), method: 'whish', referenceNumber: null, notes: null },
      ]);

      const result = await service.getStatement('w1');
      expect(result.entries).toHaveLength(2);
      expect(result.entries.every((e: any) => e.type === 'payment')).toBe(true);
    });

    it('CASE 5 — a dateFrom filter computes a non-zero opening balance from everything strictly before it, never a fake zero', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      // Opening: 50 earned before September.
      mockPrisma.workerCost.aggregate.mockResolvedValue({ _sum: { amount: dec('50.00') } });
      mockPrisma.packingSession.aggregate.mockResolvedValue({ _sum: { sessionEarnings: dec('0.00') } });
      mockPrisma.workerPayment.aggregate.mockResolvedValue({ _sum: { amount: dec('0.00') } });
      // September: +20 earning, -30 payment, +10 earning.
      mockPrisma.workerCost.findMany.mockResolvedValue([
        { id: 'c1', date: new Date('2026-09-02'), amount: dec('20.00'), category: 'daily_wage', notes: null },
        { id: 'c2', date: new Date('2026-09-20'), amount: dec('10.00'), category: 'bonus', notes: null },
      ]);
      mockPrisma.packingSession.findMany.mockResolvedValue([]);
      mockPrisma.workerPayment.findMany.mockResolvedValue([
        { id: 'p1', date: new Date('2026-09-10'), amount: dec('30.00'), method: 'cash', referenceNumber: null, notes: null },
      ]);

      const result = await service.getStatement('w1', '2026-09-01', '2026-09-30');

      // Opening 50 + 20 - 30 + 10 = 50 — matches the task's own worked example.
      expect(result.openingBalance).toBe('50.00');
      expect(result.balance).toBe('50.00');
    });

    it('no dateFrom given: opening balance is 0 and every all-time record is included', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.workerCost.findMany.mockResolvedValue([]);
      mockPrisma.packingSession.findMany.mockResolvedValue([]);
      mockPrisma.workerPayment.findMany.mockResolvedValue([]);

      const result = await service.getStatement('w1');
      expect(result.openingBalance).toBe('0.00');
      // No pre-period aggregate queries should even run without a dateFrom.
      expect(mockPrisma.workerCost.aggregate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getPerformance() — Employee Profile + Performance Analytics
  // Authoritative source: PackingSession.bagsOutput ({bagTypeId, qty,
  // ratePerBag} snapshotted at session time) — never Worker.totalBagsPacked
  // (deprecated cache) and never the CURRENT BagType/Worker rate config.
  // =========================================================================

  describe('getPerformance()', () => {
    beforeEach(() => {
      mockPrisma.bagType.findMany.mockResolvedValue([
        { id: 'bt-2kg', name: '2kg Bag' },
        { id: 'bt-10kg', name: '10kg Bag' },
      ]);
      mockPrisma.workerPayment.aggregate.mockResolvedValue({ _sum: { amount: dec('0.00') } });
      mockPrisma.workerCost.findMany.mockResolvedValue([]);
    });

    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);
      await expect(service.getPerformance('ghost')).rejects.toThrow(NotFoundException);
    });

    it('CASE 4 — total bags packed sums PackingSession.bagsOutput quantities, never Worker.totalBagsPacked', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-09-05'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 300, ratePerBag: '0.10' }] },
        { id: 's2', date: new Date('2026-09-08'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 400, ratePerBag: '0.10' }] },
      ]);

      const result = await service.getPerformance('w1', '2026-09-01', '2026-09-30');
      expect(result.totals.bagsPacked).toBe(700);
    });

    it('CASE 5/7 — bag-type breakdown reports bags and earned (qty × snapshotted rate) separately per type', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-09-05'), bagsOutput: [
          { bagTypeId: 'bt-2kg', qty: 300, ratePerBag: '0.10' },
          { bagTypeId: 'bt-10kg', qty: 150, ratePerBag: '0.15' },
        ] },
        { id: 's2', date: new Date('2026-09-08'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 400, ratePerBag: '0.10' }] },
      ]);

      const result = await service.getPerformance('w1', '2026-09-01', '2026-09-30');
      const twoKg = result.byBagType.find(b => b.bagTypeId === 'bt-2kg')!;
      const tenKg = result.byBagType.find(b => b.bagTypeId === 'bt-10kg')!;
      expect(twoKg).toMatchObject({ bagTypeName: '2kg Bag', bags: 700, earned: '70.00' });
      expect(tenKg).toMatchObject({ bagTypeName: '10kg Bag', bags: 150, earned: '22.50' });
    });

    it('CASE 6 — Rate/bag is the SNAPSHOTTED session rate, not the current BagType/Worker rate config (never fabricated)', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      // Session snapshot used $0.05/bag — even if BagType.workerRate is now $0.10,
      // this session's historical rate must be used, never the current rate.
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-08-09'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 1000, ratePerBag: '0.05' }] },
      ]);

      const result = await service.getPerformance('w1', '2026-08-01', '2026-08-31');
      expect(result.byBagType[0].ratePerBag).toBe('0.0500');
      expect(result.byBagType[0].earned).toBe('50.00'); // NOT 100.00 (which the current $0.10 rate would wrongly produce)
      expect(result.byBagType[0].rateVaries).toBe(false);
    });

    it('a bag type whose rate changed mid-period reports rateVaries: true and a qty-weighted effective rate built from real snapshots', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      // Real dev-data shape (Hassan Mahmoud, Aug 2026): 2kg Bag packed at
      // $0.05/bag on Aug 9, then at $0.10/bag on Aug 16 after a rate change.
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-08-09'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 1000, ratePerBag: '0.05' }] },
        { id: 's2', date: new Date('2026-08-16'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
      ]);

      const result = await service.getPerformance('w1', '2026-08-01', '2026-08-31');
      const twoKg = result.byBagType[0];
      expect(twoKg.rateVaries).toBe(true);
      // earned = 1000*0.05 + 100*0.10 = 60.00; effective rate = 60/1100 = 0.0545(45...)
      expect(twoKg.earned).toBe('60.00');
      expect(twoKg.ratePerBag).toBe('0.0545');
    });

    it('CASE 8/9 — working days count DISTINCT session dates; two sessions on the same date count as ONE working day', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-08-09'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
        { id: 's2', date: new Date('2026-08-09'), bagsOutput: [{ bagTypeId: 'bt-10kg', qty: 50, ratePerBag: '0.12' }] },
        { id: 's3', date: new Date('2026-08-16'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
      ]);

      const result = await service.getPerformance('w1', '2026-08-01', '2026-08-31');
      expect(result.totals.sessions).toBe(3);
      expect(result.totals.workingDays).toBe(2); // Aug 9 (2 sessions) + Aug 16 — never 3
    });

    it('CASE 10/12 — average bags/day and average earnings/day divide by WORKING days, not calendar days or session count', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-08-09'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 1000, ratePerBag: '0.05' }] },
        { id: 's2', date: new Date('2026-08-09'), bagsOutput: [{ bagTypeId: 'bt-10kg', qty: 50, ratePerBag: '0.12' }] },
        { id: 's3', date: new Date('2026-08-16'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
      ]);

      const result = await service.getPerformance('w1', '2026-08-01', '2026-08-31');
      // 1150 bags / 2 working days = 575.00 — NOT /31 calendar days, NOT /3 sessions.
      expect(result.totals.avgBagsPerWorkingDay).toBe('575.00');
      expect(result.totals.avgBagsPerSession).toBe('383.33');
      // earned = 50 + 6 + 10 = 66.00; /2 working days = 33.00
      expect(result.totals.avgEarningsPerWorkingDay).toBe('33.00');
    });

    it('CASE 11 — average bags/day PER BAG TYPE uses that type\'s own working-day count', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-08-09'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 1000, ratePerBag: '0.05' }] },
        { id: 's2', date: new Date('2026-08-16'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
        { id: 's3', date: new Date('2026-08-15'), bagsOutput: [{ bagTypeId: 'bt-10kg', qty: 20, ratePerBag: '0.12' }] },
      ]);

      const result = await service.getPerformance('w1', '2026-08-01', '2026-08-31');
      const twoKg = result.byBagType.find(b => b.bagTypeId === 'bt-2kg')!;
      const tenKg = result.byBagType.find(b => b.bagTypeId === 'bt-10kg')!;
      expect(twoKg.workingDays).toBe(2); // Aug 9 + Aug 16
      expect(twoKg.avgBagsPerWorkingDay).toBe('550.00'); // 1100/2
      expect(tenKg.workingDays).toBe(1); // Aug 15 only
      expect(tenKg.avgBagsPerWorkingDay).toBe('20.00');
    });

    it('CASE 13 — daily performance reports one row per date with combined bags/sessions/earned', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-08-09'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 1000, ratePerBag: '0.05' }] },
        { id: 's2', date: new Date('2026-08-09'), bagsOutput: [{ bagTypeId: 'bt-10kg', qty: 50, ratePerBag: '0.12' }] },
        { id: 's3', date: new Date('2026-08-16'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
      ]);

      const result = await service.getPerformance('w1', '2026-08-01', '2026-08-31');
      expect(result.dailyPerformance).toEqual([
        { date: '2026-08-09', bagsPacked: 1050, sessions: 2, earned: '56.00' },
        { date: '2026-08-16', bagsPacked: 100, sessions: 1, earned: '10.00' },
      ]);
    });

    it('CASE 14/15 — daily wage comes from WorkerCost(category=daily_wage) rows, completely independent of working-day/session data', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      // Only ONE working day (packing), but the worker was also paid a daily
      // wage on a SEPARATE date with no packing session at all that day —
      // proves daily wage is never inferred from working days.
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-08-09'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
      ]);
      mockPrisma.workerCost.findMany.mockResolvedValue([
        { id: 'c1', date: new Date('2026-08-09'), amount: dec('20.00') },
        { id: 'c2', date: new Date('2026-08-20'), amount: dec('20.00') },
      ]);

      const result = await service.getPerformance('w1', '2026-08-01', '2026-08-31');
      expect(result.totals.workingDays).toBe(1);
      expect(result.dailyWages).toEqual([
        { id: 'c1', date: '2026-08-09', amount: '20.00' },
        { id: 'c2', date: '2026-08-20', amount: '20.00' },
      ]);
      // WorkerCost query must be scoped to category: daily_wage specifically.
      expect(mockPrisma.workerCost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ category: 'daily_wage' }) }),
      );
    });

    it('CASE 22/23 — dateFrom/dateTo are applied server-side to the PackingSession query (proves month navigation actually filters)', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([]);

      await service.getPerformance('w1', '2026-08-01', '2026-08-31');

      const call = mockPrisma.packingSession.findMany.mock.calls[0][0];
      expect(call.where.workerEntityId).toBe('w1');
      expect(call.where.date.gte).toEqual(new Date('2026-08-01'));
      expect(call.where.date.lte).toEqual(new Date('2026-08-31'));
    });

    it('CASE 24 — a month with no packing activity returns zero totals and empty lists, never throws', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([]);

      const result = await service.getPerformance('w1', '2026-10-01', '2026-10-31');
      expect(result.totals).toMatchObject({
        bagsPacked: 0, sessions: 0, workingDays: 0, packingEarnings: '0.00',
        avgBagsPerWorkingDay: null, avgBagsPerSession: null,
        avgEarningsPerWorkingDay: null, avgEarningsPerSession: null,
      });
      expect(result.byBagType).toEqual([]);
      expect(result.dailyPerformance).toEqual([]);
      expect(result.packingHistory).toEqual([]);
    });

    it('an unbounded "all time" request (no dateFrom/dateTo) still returns totals/byBagType but omits row-level lists — never ships years of raw rows to the browser', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-08-09'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
      ]);
      mockPrisma.workerCost.findMany.mockResolvedValue([{ id: 'c1', date: new Date('2026-08-09'), amount: dec('20.00') }]);

      const result = await service.getPerformance('w1');

      expect(result.totals.bagsPacked).toBe(100);
      expect(result.byBagType).toHaveLength(1);
      expect(result.dailyPerformance).toBeNull();
      expect(result.packingHistory).toBeNull();
      expect(result.dailyWages).toBeNull();
      // No date filter was applied to the unbounded query.
      const call = mockPrisma.packingSession.findMany.mock.calls[0][0];
      expect(call.where.date).toBeUndefined();
    });

    it('CASE 13 (packing history) — one row per (session × bag-type line), never merged, carrying the historical rate', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-09-05'), bagsOutput: [
          { bagTypeId: 'bt-2kg', qty: 300, ratePerBag: '0.10' },
          { bagTypeId: 'bt-10kg', qty: 150, ratePerBag: '0.15' },
        ] },
      ]);

      const result = await service.getPerformance('w1', '2026-09-01', '2026-09-30');
      expect(result.packingHistory).toEqual([
        { date: '2026-09-05', sessionId: 's1', bagTypeId: 'bt-2kg', bagTypeName: '2kg Bag', quantity: 300, ratePerBag: '0.1000', earned: '30.00' },
        { date: '2026-09-05', sessionId: 's1', bagTypeId: 'bt-10kg', bagTypeName: '10kg Bag', quantity: 150, ratePerBag: '0.1500', earned: '22.50' },
      ]);
    });

    it('a legacy line with no ratePerBag snapshot contributes bags/working-days but $0 earned — never a fabricated current-rate guess', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-09-05'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 300 }] },
      ]);

      const result = await service.getPerformance('w1', '2026-09-01', '2026-09-30');
      expect(result.totals.bagsPacked).toBe(300);
      expect(result.totals.packingEarnings).toBe('0.00');
      expect(result.byBagType[0].earned).toBe('0.00');
    });
  });

  // =========================================================================
  // Daily Wage correction audit (2026-09-07) — "Daily wages must NEVER be
  // inferred from working days." getPerformance() must read ONLY persisted
  // WorkerCost(category='daily_wage') rows for the `dailyWages` list; the
  // `workingDaySet` built from PackingSession.date is used exclusively for
  // packing-performance metrics (totals.workingDays, avgBagsPerWorkingDay,
  // etc.) and is never joined with, multiplied against, or otherwise used to
  // derive daily wage figures. CASE numbers reference the correction's own
  // test matrix.
  // =========================================================================
  describe('getPerformance() — Daily Wage correction audit: never inferred from working days', () => {
    beforeEach(() => {
      mockPrisma.bagType.findMany.mockResolvedValue([{ id: 'bt-2kg', name: '2kg Bag' }]);
      mockPrisma.workerPayment.aggregate.mockResolvedValue({ _sum: { amount: dec('0.00') } });
    });

    it('CASE 1 — 4 packing days but only 2 daily_wage WorkerCost records: Daily Wages = 2 records, NEVER 4 × the configured rate', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      // 4 distinct packing days: Sep 1, 2, 3, 5.
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-09-01'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
        { id: 's2', date: new Date('2026-09-02'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
        { id: 's3', date: new Date('2026-09-03'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
        { id: 's4', date: new Date('2026-09-05'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
      ]);
      // The owner only pressed "Daily Wage" on Sep 1 and Sep 3 — two rows.
      mockPrisma.workerCost.findMany.mockResolvedValue([
        { id: 'c1', date: new Date('2026-09-01'), amount: dec('20.00') },
        { id: 'c2', date: new Date('2026-09-03'), amount: dec('20.00') },
      ]);

      const result = await service.getPerformance('w1', '2026-09-01', '2026-09-30');

      expect(result.totals.workingDays).toBe(4); // packing performance metric — unaffected
      expect(result.dailyWages).toHaveLength(2); // NOT 4
      const totalDailyWage = result.dailyWages!.reduce((s, w) => s + parseFloat(w.amount), 0);
      expect(totalDailyWage).toBe(40.00); // 2 × $20 — NEVER 4 × $20 = $80
    });

    it('CASE 2 — a daily_wage WorkerCost on a date with NO PackingSession still appears in Daily Wages', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      // No packing sessions at all this period.
      mockPrisma.packingSession.findMany.mockResolvedValue([]);
      mockPrisma.workerCost.findMany.mockResolvedValue([
        { id: 'c1', date: new Date('2026-09-05'), amount: dec('20.00') },
      ]);

      const result = await service.getPerformance('w1', '2026-09-01', '2026-09-30');

      expect(result.totals.workingDays).toBe(0);
      expect(result.dailyWages).toEqual([{ id: 'c1', date: '2026-09-05', amount: '20.00' }]);
    });

    it('CASE 3 — a packing day with NO daily_wage WorkerCost never manufactures an inferred entry', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([
        { id: 's1', date: new Date('2026-09-01'), bagsOutput: [{ bagTypeId: 'bt-2kg', qty: 100, ratePerBag: '0.10' }] },
      ]);
      mockPrisma.workerCost.findMany.mockResolvedValue([]); // no daily_wage recorded at all

      const result = await service.getPerformance('w1', '2026-09-01', '2026-09-30');

      expect(result.totals.workingDays).toBe(1);
      expect(result.dailyWages).toEqual([]); // never a fabricated $20 for Sep 1
    });

    it('CASE 4 — a later change to the configured daily wage rate never rewrites a historically-recorded amount', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([]);
      // Two daily_wage rows recorded at DIFFERENT amounts (the Settings rate
      // was $15 when the first was pressed, later changed to $20). Both
      // amounts are the persisted WorkerCost.amount — getPerformance() never
      // calls SettingsService and must never re-derive/overwrite either one.
      mockPrisma.workerCost.findMany.mockResolvedValue([
        { id: 'c1', date: new Date('2026-09-01'), amount: dec('15.00') },
        { id: 'c2', date: new Date('2026-09-10'), amount: dec('20.00') },
      ]);

      const result = await service.getPerformance('w1', '2026-09-01', '2026-09-30');

      expect(result.dailyWages).toEqual([
        { id: 'c1', date: '2026-09-01', amount: '15.00' },
        { id: 'c2', date: '2026-09-10', amount: '20.00' },
      ]);
    });

    it('CASE 5 — Daily Wages total matches the actual persisted WorkerCost(category=daily_wage) records exactly, and the query is scoped to that category and worker only', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockPrisma.packingSession.findMany.mockResolvedValue([]);
      mockPrisma.workerCost.findMany.mockResolvedValue([
        { id: 'c1', date: new Date('2026-09-01'), amount: dec('20.00') },
        { id: 'c2', date: new Date('2026-09-03'), amount: dec('20.00') },
        { id: 'c3', date: new Date('2026-09-15'), amount: dec('20.00') },
      ]);

      const result = await service.getPerformance('w1', '2026-09-01', '2026-09-30');

      const totalDailyWage = result.dailyWages!.reduce((s, w) => s + parseFloat(w.amount), 0);
      expect(totalDailyWage).toBe(60.00); // exactly 3 × $20 — matches the 3 persisted rows
      expect(mockPrisma.workerCost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workerId: 'w1', category: 'daily_wage', date: expect.anything() } }),
      );
    });
  });

  // =========================================================================
  // Edit-drift regression
  // Sessions edited after creation must not leave stale stored totals.
  // =========================================================================

  describe('edit-drift regression', () => {
    it('returns correct earned/paid/owed after a session is edited', async () => {
      // Scenario:
      //   Session A: earns 100.00
      //   Session B: earns 200.00   ← later edited to 150.00
      //   Payment:                    50.00
      //
      // Stored-column approach after edit: totalEarned still 300.00 (drifted)
      // Computed approach: reads post-edit sum = 100 + 150 = 250.00 → owed = 200.00
      mockPrisma.worker.findUnique.mockResolvedValue(
        makeWorker({ id: 'w-drift', totalEarned: '300.00', totalPaid: '0.00' }),
      );
      mockAggregates('250.00', '50.00');

      const result = await service.findOne('w-drift');

      expect(result.pieceEarned).toBe('250.00');
      expect(result.totalEarned).toBe('250.00'); // not 300 from stale column
      expect(result.totalPaid).toBe('50.00');
      expect(result.totalOwed).toBe('200.00');
    });
  });
});
