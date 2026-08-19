import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PackedStockService } from './packed-stock.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }

describe('PackedStockService', () => {
  let service: PackedStockService;

  const mockPrisma = {
    packedStock: { findMany: fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackedStockService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<PackedStockService>(PackedStockService);
  });

  const BAG_TYPE = 'bagtype-1';

  // Builds N mock PackedStock rows, each with `quantity` free bags and no
  // reservations, already in the createdAt-ascending order the real
  // findMany({orderBy:{createdAt:'asc'}}) query would return.
  function makeRecords(count: number, quantityEach: number, reservedEach = 0) {
    return Array.from({ length: count }, (_, i) => ({
      id: `ps-${i + 1}`,
      quantity: quantityEach,
      reservedQuantity: reservedEach,
    }));
  }

  // =========================================================================
  // getFifoDraw() — server-side FIFO draw plan, unbounded per bag type.
  // Replaces WarehouseSales.tsx's previous client-side computation over a
  // limit:200-capped fetch.
  // =========================================================================

  describe('getFifoDraw()', () => {
    it('normal FIFO ordering: draws from the oldest (first) record before newer ones', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue(
        makeRecords(3, 10), // ps-1, ps-2, ps-3, each 10 free bags, already createdAt-asc ordered
      );
      const result = await service.getFifoDraw(BAG_TYPE, 15);
      expect(result.draws).toEqual([
        { packedStockId: 'ps-1', quantity: 10 },
        { packedStockId: 'ps-2', quantity: 5 },
      ]);
      expect(result.fulfilled).toBe(true);
    });

    it('exact stock quantity: consuming precisely all available stock still succeeds with remaining = 0', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue(makeRecords(2, 10)); // 20 total
      const result = await service.getFifoDraw(BAG_TYPE, 20);
      expect(result.fulfilled).toBe(true);
      expect(result.draws.reduce((s, d) => s + d.quantity, 0)).toBe(20);
    });

    it('insufficient stock still correctly fails (fulfilled: false) and reports true available total', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue(makeRecords(2, 10)); // 20 total
      const result = await service.getFifoDraw(BAG_TYPE, 25);
      expect(result.fulfilled).toBe(false);
      expect(result.available).toBe(20);
      // Still draws everything that IS available — caller decides what to do with a partial plan.
      expect(result.draws.reduce((s, d) => s + d.quantity, 0)).toBe(20);
    });

    it('multiple records are consumed in the existing createdAt-ascending order, not reordered', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { id: 'oldest', quantity: 3, reservedQuantity: 0 },
        { id: 'middle', quantity: 3, reservedQuantity: 0 },
        { id: 'newest', quantity: 3, reservedQuantity: 0 },
      ]);
      const result = await service.getFifoDraw(BAG_TYPE, 7);
      expect(result.draws.map((d) => d.packedStockId)).toEqual(['oldest', 'middle', 'newest']);
      expect(result.draws.map((d) => d.quantity)).toEqual([3, 3, 1]);
    });

    it('no duplicate consumption: a record never contributes more than its own free quantity, and is skipped once remaining is satisfied', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue(makeRecords(5, 10)); // 50 total, plenty of headroom
      const result = await service.getFifoDraw(BAG_TYPE, 12);
      // Only the first 2 records should appear at all.
      expect(result.draws).toHaveLength(2);
      expect(result.draws).toEqual([
        { packedStockId: 'ps-1', quantity: 10 },
        { packedStockId: 'ps-2', quantity: 2 },
      ]);
      const totalDrawn = result.draws.reduce((s, d) => s + d.quantity, 0);
      expect(totalDrawn).toBe(12);
    });

    it('reserved quantity is excluded — draws only free stock (quantity − reservedQuantity), matching BUG-E (P2)', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { id: 'ps-1', quantity: 10, reservedQuantity: 7 }, // 3 free
      ]);
      const result = await service.getFifoDraw(BAG_TYPE, 3);
      expect(result.fulfilled).toBe(true);
      expect(result.draws).toEqual([{ packedStockId: 'ps-1', quantity: 3 }]);
    });

    it('a fully-reserved record (0 free) is skipped entirely, drawing from the next one instead', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { id: 'fully-reserved', quantity: 10, reservedQuantity: 10 },
        { id: 'available', quantity: 5, reservedQuantity: 0 },
      ]);
      const result = await service.getFifoDraw(BAG_TYPE, 5);
      expect(result.draws).toEqual([{ packedStockId: 'available', quantity: 5 }]);
    });

    it('scalability: draws correctly from records beyond the OLD limit:200 cap — 250 records of 1 bag each, requesting 210, must reach records past #200', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue(makeRecords(250, 1));
      const result = await service.getFifoDraw(BAG_TYPE, 210);
      expect(result.fulfilled).toBe(true);
      expect(result.draws).toHaveLength(210);
      // The 201st through 210th draws prove records past the old 200-row cap were reached.
      expect(result.draws[200]).toEqual({ packedStockId: 'ps-201', quantity: 1 });
      expect(result.draws[209]).toEqual({ packedStockId: 'ps-210', quantity: 1 });
      // The query itself is unbounded — no take/limit passed to findMany.
      const args = mockPrisma.packedStock.findMany.mock.calls[0][0];
      expect(args.take).toBeUndefined();
      expect(args.skip).toBeUndefined();
    });

    it('scalability: stock that only exists past record #200 is still found and fulfills the sale (the exact bug this fix resolves)', async () => {
      // First 200 records are fully reserved (0 free) — under the old
      // limit:200 client-side fetch, this bag type would have looked
      // completely out of stock. Records 201-205 carry the real free stock.
      const exhausted = makeRecords(200, 5, 5); // 200 records, 5 qty each, fully reserved → 0 free
      const realStock = makeRecords(5, 4).map((r, i) => ({ ...r, id: `real-${i + 1}` })); // 5 records × 4 free = 20
      mockPrisma.packedStock.findMany.mockResolvedValue([...exhausted, ...realStock]);
      const result = await service.getFifoDraw(BAG_TYPE, 15);
      expect(result.fulfilled).toBe(true);
      expect(result.available).toBe(20);
      expect(result.draws.every((d) => d.packedStockId.startsWith('real-'))).toBe(true);
    });

    it('existing (≤200-record) behavior is unchanged — small-scale request still resolves identically to before', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue(makeRecords(3, 10));
      const result = await service.getFifoDraw(BAG_TYPE, 5);
      expect(result).toEqual({
        draws: [{ packedStockId: 'ps-1', quantity: 5 }],
        fulfilled: true,
        requested: 5,
        available: 30,
      });
    });

    it('query is scoped to the requested bagTypeId only', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([]);
      await service.getFifoDraw(BAG_TYPE, 5);
      const args = mockPrisma.packedStock.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ bagTypeId: BAG_TYPE });
      expect(args.orderBy).toEqual({ createdAt: 'asc' });
    });

    it('zero available stock: draws is empty, fulfilled false, available 0 — does not throw', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([]);
      const result = await service.getFifoDraw(BAG_TYPE, 10);
      expect(result).toEqual({ draws: [], fulfilled: false, requested: 10, available: 0 });
    });
  });
});
