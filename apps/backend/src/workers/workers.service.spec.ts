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
    worker: { findUnique: fn(), findMany: fn(), count: fn(), create: fn(), update: fn(), delete: fn() },
    workerPayment: { findUnique: fn(), findMany: fn(), count: fn(), create: fn(), deleteMany: fn(), aggregate: fn(), groupBy: fn() },
    packingSession: { aggregate: fn(), groupBy: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<WorkersService>(WorkersService);
  });

  function makeWorker(overrides: Record<string, any> = {}) {
    return {
      id: overrides.id ?? 'worker-uuid-1',
      name: overrides.name ?? 'Ahmed',
      phone: overrides.phone ?? null,
      notes: overrides.notes ?? null,
      ratesPerBagType: overrides.ratesPerBagType ?? [],
      totalEarned: dec(overrides.totalEarned ?? '0.00'), // deprecated cache — ignored by service
      totalPaid:   dec(overrides.totalPaid   ?? '0.00'), // deprecated cache — ignored by service
      totalBagsPacked: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // Helper: set up aggregate mocks for a single worker (used by findOne)
  function mockAggregates(earned: string, paid: string) {
    mockPrisma.packingSession.aggregate.mockResolvedValue({ _sum: { sessionEarnings: dec(earned) } });
    mockPrisma.workerPayment.aggregate.mockResolvedValue({ _sum: { amount: dec(paid) } });
  }

  // Helper: set up groupBy mocks for findAll
  function mockGroupBy(workerId: string, earned: string, paid: string) {
    mockPrisma.packingSession.groupBy.mockResolvedValue([
      { workerEntityId: workerId, _sum: { sessionEarnings: dec(earned) } },
    ]);
    mockPrisma.workerPayment.groupBy.mockResolvedValue([
      { workerId, _sum: { amount: dec(paid) } },
    ]);
  }

  // =========================================================================
  // findAll() — totals computed from aggregation, not stored columns
  // =========================================================================

  describe('findAll()', () => {
    it('computes totalOwed = earned - paid from source records (200.00 - 75.50 = 124.50)', async () => {
      const worker = makeWorker({ id: 'w1', totalEarned: '0.00', totalPaid: '0.00' }); // stored values ignored
      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);
      mockGroupBy('w1', '200.00', '75.50');

      const result = await service.findAll(1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].totalEarned).toBe('200.00');
      expect(result.data[0].totalPaid).toBe('75.50');
      expect(result.data[0].totalOwed).toBe('124.50');
      expect(result.total).toBe(1);
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

    it('worker with no sessions and no payments shows all-zero totals', async () => {
      const worker = makeWorker({ id: 'w1' });
      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);
      // groupBy returns no rows for this worker (no sessions, no payments)
      mockPrisma.packingSession.groupBy.mockResolvedValue([]);
      mockPrisma.workerPayment.groupBy.mockResolvedValue([]);

      const result = await service.findAll(1, 20);
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
  });

  // =========================================================================
  // findOne() — live computed; not found
  // =========================================================================

  describe('findOne()', () => {
    it('returns worker with totalOwed computed from source records', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: 'w1' }));
      mockAggregates('300.00', '100.00');

      const result = await service.findOne('w1');
      expect(result.totalEarned).toBe('300.00');
      expect(result.totalPaid).toBe('100.00');
      expect(result.totalOwed).toBe('200.00');
    });

    it('ignores the stale stored totalEarned/totalPaid columns on the Worker row', async () => {
      // Stored columns say 999 / 999 — but source records say 300 / 100
      mockPrisma.worker.findUnique.mockResolvedValue(
        makeWorker({ id: 'w1', totalEarned: '999.00', totalPaid: '999.00' }),
      );
      mockAggregates('300.00', '100.00');

      const result = await service.findOne('w1');
      expect(result.totalEarned).toBe('300.00'); // not 999
      expect(result.totalPaid).toBe('100.00');   // not 999
      expect(result.totalOwed).toBe('200.00');
    });

    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('nonexistent')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_FOUND' }),
      });
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
  // addPayment() — creates WorkerPayment record; does NOT update stored totalPaid
  // =========================================================================

  describe('addPayment()', () => {
    it('creates a WorkerPayment record without updating worker.totalPaid', async () => {
      const workerId = 'w3';

      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({ id: workerId }));
      mockPrisma.workerPayment.create.mockResolvedValue({ id: 'wp-1', workerId, amount: '25.00', date: new Date() });

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
  // QA: edit-drift regression
  // Create 2 sessions + 1 payment, edit one session, assert computed totals correct.
  // Verifies the core acceptance criterion: no drift from stored columns.
  // =========================================================================

  describe('edit-drift regression', () => {
    it('returns correct earned/paid/owed after a session is edited', async () => {
      // Scenario:
      //   Session A: earns 100.00
      //   Session B: earns 200.00   ← later edited to 150.00
      //   Payment:                    50.00
      //
      // Old stored-column approach after edit: totalEarned still 300.00 (drifted)
      // Computed approach: reads post-edit sum = 100 + 150 = 250.00 → owed = 200.00

      const workerId = 'w-drift';
      mockPrisma.worker.findUnique.mockResolvedValue(makeWorker({
        id: workerId,
        totalEarned: '300.00', // stale stored value — must be ignored
        totalPaid:   '0.00',
      }));

      // Aggregation reflects post-edit state (150 not 200)
      mockPrisma.packingSession.aggregate.mockResolvedValue({
        _sum: { sessionEarnings: dec('250.00') }, // 100 + 150
      });
      mockPrisma.workerPayment.aggregate.mockResolvedValue({
        _sum: { amount: dec('50.00') },
      });

      const result = await service.findOne(workerId);

      expect(result.totalEarned).toBe('250.00'); // computed, not 300 from stale column
      expect(result.totalPaid).toBe('50.00');
      expect(result.totalOwed).toBe('200.00');
    });
  });
});
