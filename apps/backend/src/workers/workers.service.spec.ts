import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { WorkersService } from './workers.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Shared mock factory helper
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('WorkersService', () => {
  let service: WorkersService;

  const mockPrisma = {
    worker: {
      findUnique: fn(),
      findMany: fn(),
      count: fn(),
      create: fn(),
      update: fn(),
    },
    workerPayment: {
      findUnique: fn(),
      findMany: fn(),
      count: fn(),
      create: fn(),
    },
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

  // Helper: build a minimal Worker-like object as Prisma would return it
  function makeWorker(overrides: Record<string, any> = {}) {
    return {
      id: overrides.id ?? 'worker-uuid-1',
      name: overrides.name ?? 'Ahmed',
      phone: overrides.phone ?? null,
      notes: overrides.notes ?? null,
      ratesPerBagType: overrides.ratesPerBagType ?? [],
      // Prisma Decimal fields are objects with toString()
      totalEarned: {
        toString: () => overrides.totalEarned ?? '0.00',
      },
      totalPaid: {
        toString: () => overrides.totalPaid ?? '0.00',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // =========================================================================
  // findAll() — totalOwed computed correctly
  // =========================================================================

  describe('findAll()', () => {
    it('computes totalOwed = totalEarned - totalPaid for each worker (200.00 - 75.50 = 124.50)', async () => {
      const worker = makeWorker({ totalEarned: '200.00', totalPaid: '75.50' });

      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);

      const result = await service.findAll(1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].totalOwed).toBe('124.50');
      expect(result.total).toBe(1);
    });

    it('totalOwed = totalEarned - totalPaid with high-precision values (1000.00 - 999.99 = 0.01)', async () => {
      const worker = makeWorker({ totalEarned: '1000.00', totalPaid: '999.99' });

      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);

      const result = await service.findAll(1, 20);

      // Must be exactly '0.01', not a floating-point artifact like '0.009999999...'
      expect(result.data[0].totalOwed).toBe('0.01');
    });

    it('totalOwed is "0.00" when totalEarned equals totalPaid', async () => {
      const worker = makeWorker({ totalEarned: '500.00', totalPaid: '500.00' });

      mockPrisma.$transaction.mockResolvedValue([[worker], 1]);

      const result = await service.findAll(1, 20);

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
  // findOne() — totalOwed computed; not found
  // =========================================================================

  describe('findOne()', () => {
    it('returns worker with totalOwed computed', async () => {
      const worker = makeWorker({ totalEarned: '300.00', totalPaid: '100.00' });

      mockPrisma.worker.findUnique.mockResolvedValue(worker);

      const result = await service.findOne('worker-uuid-1');

      expect(result.totalOwed).toBe('200.00');
    });

    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('nonexistent-id')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_FOUND' }),
      });
    });
  });

  // =========================================================================
  // setRates() — full replacement, not append
  // =========================================================================

  describe('setRates()', () => {
    it('replaces the entire ratesPerBagType array — does NOT append to existing rates', async () => {
      const workerId = 'worker-uuid-2';
      const existingWorker = makeWorker({
        id: workerId,
        ratesPerBagType: [{ bagTypeId: 'old-bag-id', ratePerBag: '0.05' }],
      });

      // findOne (via setRates) calls findUnique
      mockPrisma.worker.findUnique.mockResolvedValue(existingWorker);
      mockPrisma.worker.update.mockResolvedValue({
        ...existingWorker,
        ratesPerBagType: [{ bagTypeId: 'new-bag-id', ratePerBag: '0.10' }],
      });

      await service.setRates(workerId, {
        ratesPerBagType: [{ bagTypeId: 'new-bag-id', ratePerBag: '0.10' }],
      });

      expect(mockPrisma.worker.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: workerId },
          data: {
            ratesPerBagType: [{ bagTypeId: 'new-bag-id', ratePerBag: '0.10' }],
          },
        }),
      );

      // Verify the update was called with ONLY the new rates, not a merged/appended array
      const updateCall = mockPrisma.worker.update.mock.calls[0][0];
      const writtenRates = updateCall.data.ratesPerBagType;
      expect(writtenRates).toHaveLength(1);
      expect(writtenRates[0].bagTypeId).toBe('new-bag-id');
      // Old entry must NOT be present
      expect(writtenRates.find((r: any) => r.bagTypeId === 'old-bag-id')).toBeUndefined();
    });

    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      mockPrisma.worker.findUnique.mockResolvedValue(null);

      await expect(
        service.setRates('ghost-id', {
          ratesPerBagType: [{ bagTypeId: 'bt-1', ratePerBag: '0.10' }],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // addPayment() — totalPaid incremented atomically, NotFoundException
  // =========================================================================

  describe('addPayment()', () => {
    it('calls workerPayment.create AND worker.update with newTotalPaid = totalPaid + amount', async () => {
      const workerId = 'worker-uuid-3';
      const existingWorker = makeWorker({
        id: workerId,
        totalEarned: '200.00',
        totalPaid: '50.00',
      });

      const tx = {
        worker: { findUnique: fn(), update: fn() },
        workerPayment: { create: fn() },
      };

      tx.worker.findUnique.mockResolvedValue(existingWorker);
      tx.workerPayment.create.mockResolvedValue({
        id: 'wp-1',
        workerId,
        amount: '25.00',
        date: new Date(),
      });
      tx.worker.update.mockResolvedValue({});

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.addPayment(workerId, { amount: '25.00' });

      // workerPayment.create must have been called
      expect(tx.workerPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workerId,
            amount: '25.00',
          }),
        }),
      );

      // worker.update must write newTotalPaid = 50.00 + 25.00 = 75.00
      expect(tx.worker.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: workerId },
          data: { totalPaid: '75.00' },
        }),
      );
    });

    it('totalPaid incremented with exact decimal arithmetic (50.00 + 25.00 = 75.00 not float noise)', async () => {
      const workerId = 'worker-uuid-4';
      const existingWorker = makeWorker({
        id: workerId,
        totalEarned: '500.00',
        totalPaid: '50.00',
      });

      const tx = {
        worker: { findUnique: fn(), update: fn() },
        workerPayment: { create: fn() },
      };

      tx.worker.findUnique.mockResolvedValue(existingWorker);
      tx.workerPayment.create.mockResolvedValue({ id: 'wp-2', workerId, amount: '25.00' });
      tx.worker.update.mockResolvedValue({});

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.addPayment(workerId, { amount: '25.00' });

      const updateCall = tx.worker.update.mock.calls[0][0];
      expect(updateCall.data.totalPaid).toBe('75.00');
    });

    it('throws NotFoundException NOT_FOUND when worker does not exist', async () => {
      const tx = {
        worker: { findUnique: fn(), update: fn() },
        workerPayment: { create: fn() },
      };

      tx.worker.findUnique.mockResolvedValue(null);

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(
        service.addPayment('nonexistent-worker', { amount: '10.00' }),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.addPayment('nonexistent-worker', { amount: '10.00' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_FOUND' }),
      });
    });
  });
});
