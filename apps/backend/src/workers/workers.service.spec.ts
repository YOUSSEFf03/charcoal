import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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
    workerAttendance:  { count: fn(), groupBy: fn(), findMany: fn(), findUnique: fn(), create: fn(), deleteMany: fn() },
    packingSession:    { aggregate: fn(), groupBy: fn() },
    $transaction:      fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default attendance to 0 so tests that don't care about it still pass.
    mockPrisma.workerAttendance.count.mockResolvedValue(0);
    mockPrisma.workerAttendance.groupBy.mockResolvedValue([]);

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
      dailyRate:       dec((overrides.dailyRate  as string | undefined) ?? '0.00'),
      ratesPerBagType: overrides.ratesPerBagType ?? [],
      totalEarned:     dec((overrides.totalEarned as string | undefined) ?? '0.00'), // deprecated cache — ignored
      totalPaid:       dec((overrides.totalPaid   as string | undefined) ?? '0.00'), // deprecated cache — ignored
      totalBagsPacked: [],
      createdAt:       new Date(),
      updatedAt:       new Date(),
    };
  }

  /** Mock the three aggregates used by computeTotals (called from findOne). */
  function mockAggregates(bagEarned: string, paid: string, attendCount = 0) {
    mockPrisma.packingSession.aggregate.mockResolvedValue({ _sum: { sessionEarnings: dec(bagEarned) } });
    mockPrisma.workerPayment.aggregate.mockResolvedValue({ _sum: { amount: dec(paid) } });
    mockPrisma.workerAttendance.count.mockResolvedValue(attendCount);
  }

  /** Mock the three groupBy queries used by findAll. */
  function mockGroupBy(workerId: string, bagEarned: string, paid: string, attendCount = 0) {
    mockPrisma.packingSession.groupBy.mockResolvedValue([
      { workerEntityId: workerId, _sum: { sessionEarnings: dec(bagEarned) } },
    ]);
    mockPrisma.workerPayment.groupBy.mockResolvedValue([
      { workerId, _sum: { amount: dec(paid) } },
    ]);
    mockPrisma.workerAttendance.groupBy.mockResolvedValue(
      attendCount > 0 ? [{ workerId, _count: { id: attendCount } }] : [],
    );
  }

  // =========================================================================
  // findAll() — totals computed from aggregation, not stored columns
  // =========================================================================

  describe('findAll()', () => {
    it('computes totalOwed = earned - paid (200.00 - 75.50 = 124.50, no daily wage)', async () => {
      const worker = makeWorker({ id: 'w1' });
      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);
      mockGroupBy('w1', '200.00', '75.50');

      const result = await service.findAll(1, 20);

      expect(result.data[0].pieceEarned).toBe('200.00');
      expect(result.data[0].dailyEarned).toBe('0.00');
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

    it('worker with no sessions, no payments, no attendance shows all-zero totals', async () => {
      const worker = makeWorker({ id: 'w1' });
      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);
      mockPrisma.packingSession.groupBy.mockResolvedValue([]);
      mockPrisma.workerPayment.groupBy.mockResolvedValue([]);
      mockPrisma.workerAttendance.groupBy.mockResolvedValue([]);

      const result = await service.findAll(1, 20);
      expect(result.data[0].pieceEarned).toBe('0.00');
      expect(result.data[0].dailyEarned).toBe('0.00');
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

    it('daily wage: 5 attendance days × $20.00/day = $100.00 dailyEarned', async () => {
      const worker = makeWorker({ id: 'w1', dailyRate: '20.00' });
      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);
      mockGroupBy('w1', '0.00', '0.00', 5);

      const result = await service.findAll(1, 20);
      expect(result.data[0].pieceEarned).toBe('0.00');
      expect(result.data[0].dailyEarned).toBe('100.00');
      expect(result.data[0].totalEarned).toBe('100.00');
      expect(result.data[0].attendanceDays).toBe(5);
    });
  });

  // =========================================================================
  // findOne() — single-worker live computation
  // =========================================================================

  describe('findOne()', () => {
    it('returns worker with totalOwed computed from source records (no daily wage)', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockAggregates('300.00', '100.00');

      const result = await service.findOne('w1');
      expect(result.pieceEarned).toBe('300.00');
      expect(result.dailyEarned).toBe('0.00');
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

    it('daily wage: 10 days × $15.00/day adds $150.00 to totalEarned', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1', dailyRate: '15.00' }));
      mockAggregates('0.00', '0.00', 10);

      const result = await service.findOne('w1');
      expect(result.pieceEarned).toBe('0.00');
      expect(result.dailyEarned).toBe('150.00');
      expect(result.totalEarned).toBe('150.00');
      expect(result.totalOwed).toBe('150.00');
    });
  });

  // =========================================================================
  // QA: piece-rate + daily-wage combined accuracy
  // Worker: N attendance days at rate R + M bags packed → totalEarned by hand.
  // totalOwed = totalEarned − Σ payments.
  // =========================================================================

  describe('QA: combined piece + daily earnings', () => {
    it('18 days × $15/day + $108.96 bags - $126.76 paid = correct totalOwed', async () => {
      // Hand calc:
      //   daily:  18 × 15.00 = 270.00
      //   piece:  108.96
      //   total:  270.00 + 108.96 = 378.96
      //   paid:   126.76
      //   owed:   378.96 - 126.76 = 252.20
      mockPrisma.worker.findUnique.mockResolvedValue(
        makeWorker({ id: 'w-qa', dailyRate: '15.00' }),
      );
      mockAggregates('108.96', '126.76', 18);

      const result = await service.findOne('w-qa');

      expect(result.pieceEarned).toBe('108.96');
      expect(result.dailyEarned).toBe('270.00');
      expect(result.totalEarned).toBe('378.96');
      expect(result.totalPaid).toBe('126.76');
      expect(result.totalOwed).toBe('252.20');
    });

    it('zero attendance means dailyEarned=0 regardless of dailyRate', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(
        makeWorker({ id: 'w1', dailyRate: '25.00' }),
      );
      mockAggregates('50.00', '0.00', 0);

      const result = await service.findOne('w1');
      expect(result.dailyEarned).toBe('0.00');
      expect(result.totalEarned).toBe('50.00');
    });

    it('zero dailyRate means dailyEarned=0 regardless of attendance days', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(
        makeWorker({ id: 'w1', dailyRate: '0.00' }),
      );
      mockAggregates('75.00', '0.00', 30);

      const result = await service.findOne('w1');
      expect(result.dailyEarned).toBe('0.00');
      expect(result.totalEarned).toBe('75.00');
    });

    it('no float drift: 3 days × $33.33/day = $99.99, not $99.990000001', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(
        makeWorker({ id: 'w1', dailyRate: '33.33' }),
      );
      mockAggregates('0.00', '0.00', 3);

      const result = await service.findOne('w1');
      expect(result.dailyEarned).toBe('99.99');
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
