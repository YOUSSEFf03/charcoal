import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { WasteService } from './waste.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }

describe('WasteService', () => {
  let service: WasteService;

  const mockPrisma = {
    wasteStock: { findUnique: fn() },
    wasteEntry: { groupBy: fn(), findFirst: fn(), findMany: fn(), count: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [WasteService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<WasteService>(WasteService);
  });

  describe('getSummary()', () => {
    it('reports kgOnHand from the singleton row, and this-month sums by type (sale/disposal negated to a positive "kg moved out" figure)', async () => {
      mockPrisma.wasteStock.findUnique.mockResolvedValue({ kgOnHand: { toString: () => '123.456' } });
      mockPrisma.wasteEntry.groupBy.mockResolvedValue([
        { type: 'packing_variance', _sum: { kg: { toString: () => '50.000' } } },
        { type: 'sale', _sum: { kg: { toString: () => '-20.000' } } }, // stored negative (outflow)
        { type: 'disposal', _sum: { kg: { toString: () => '-5.000' } } },
      ]);
      mockPrisma.wasteEntry.findFirst.mockResolvedValue({ date: new Date('2026-01-10') });

      const result = await service.getSummary();

      expect(result.kgOnHand).toBe('123.456');
      expect(result.collectedThisMonthKg).toBe('50.000');
      expect(result.soldThisMonthKg).toBe('20.000'); // negated — human-readable "kg sold"
      expect(result.disposedThisMonthKg).toBe('5.000');
      expect(result.lastAdjustmentDate).toBe(new Date('2026-01-10').toISOString());
    });

    it('defaults to zero when the singleton row is missing or no entries exist this month', async () => {
      mockPrisma.wasteStock.findUnique.mockResolvedValue(null);
      mockPrisma.wasteEntry.groupBy.mockResolvedValue([]);
      mockPrisma.wasteEntry.findFirst.mockResolvedValue(null);

      const result = await service.getSummary();

      expect(result.kgOnHand).toBe('0.000');
      expect(result.collectedThisMonthKg).toBe('0.000');
      expect(result.soldThisMonthKg).toBe('0.000');
      expect(result.disposedThisMonthKg).toBe('0.000');
      expect(result.lastAdjustmentDate).toBeNull();
    });

    it('queries this-month entries using a UTC calendar-month-start boundary', async () => {
      mockPrisma.wasteStock.findUnique.mockResolvedValue({ kgOnHand: { toString: () => '0' } });
      mockPrisma.wasteEntry.groupBy.mockResolvedValue([]);
      mockPrisma.wasteEntry.findFirst.mockResolvedValue(null);

      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00.000Z'));
      try {
        await service.getSummary();
      } finally {
        jest.useRealTimers();
      }

      const call = mockPrisma.wasteEntry.groupBy.mock.calls[0][0] as any;
      expect(call.where.date.gte.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    });
  });

  describe('getLedger()', () => {
    it('returns the paginated shape from the $transaction result', async () => {
      mockPrisma.$transaction.mockResolvedValue([[{ id: 'we-1' }], 1]);

      const result = await service.getLedger(2, 10, 'sale', '2026-01-01', '2026-01-31');

      expect(result).toEqual({ data: [{ id: 'we-1' }], total: 1, page: 2, limit: 10 });
    });

    it('applies skip/take from page/limit and the type + date range filter', async () => {
      mockPrisma.wasteEntry.findMany.mockResolvedValue([]);
      mockPrisma.wasteEntry.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation(async (ops: any[]) => Promise.all(ops));

      await service.getLedger(3, 20, 'adjustment', '2026-02-01', '2026-02-28');

      const findManyArgs = mockPrisma.wasteEntry.findMany.mock.calls[0][0];
      expect(findManyArgs.skip).toBe(40); // (page 3 - 1) * limit 20
      expect(findManyArgs.take).toBe(20);
      expect(findManyArgs.where).toEqual({
        type: 'adjustment',
        date: { gte: new Date('2026-02-01'), lte: new Date('2026-02-28') },
      });

      const countArgs = mockPrisma.wasteEntry.count.mock.calls[0][0];
      expect(countArgs.where).toEqual(findManyArgs.where);
    });

    it('omits type/date filters entirely when not provided', async () => {
      mockPrisma.wasteEntry.findMany.mockResolvedValue([]);
      mockPrisma.wasteEntry.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation(async (ops: any[]) => Promise.all(ops));

      await service.getLedger(1, 20);

      expect(mockPrisma.wasteEntry.findMany.mock.calls[0][0].where).toEqual({});
    });
  });
});
