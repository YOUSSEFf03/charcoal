import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkersService } from './workers.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }
function dec(v: string) { return { toString: () => v }; }

describe('WorkersService', () => {
  let service: WorkersService;

  const mockPrisma = {
    worker:            { findUnique: fn(), findMany: fn(), count: fn(), create: fn(), update: fn(), delete: fn() },
    workerPayment:     { findUnique: fn(), findMany: fn(), count: fn(), create: fn(), deleteMany: fn(), aggregate: fn(), groupBy: fn() },
    workerCost:        { aggregate: fn(), groupBy: fn(), findMany: fn(), count: fn(), create: fn(), update: fn(), findUnique: fn(), deleteMany: fn() },
    packingSession:    { aggregate: fn(), groupBy: fn() },
    user:              { findUnique: fn() },
    $transaction:      fn(),
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
