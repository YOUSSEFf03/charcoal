import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { StockLotsService } from './stock-lots.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Shared mock factory helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('StockLotsService', () => {
  let service: StockLotsService;

  const mockPrisma = {
    stockLot: { findUnique: fn(), findMany: fn(), create: fn(), count: fn(), update: fn() },
    user: { findUnique: fn() },
    supplier: { findUnique: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockLotsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StockLotsService>(StockLotsService);
  });

  // =========================================================================
  // Test 10: CONSTRAINT 12 — sales_rep response has no costPerKg
  // =========================================================================

  describe('findOne()', () => {
    const lotWithCost = {
      id: 'lot-uuid-1',
      charcoalType: 'BBQ',
      grade: 'A',
      kgReceived: '8400.000',
      kgRemaining: '8400.000',
      costPerKg: { toString: () => '0.8100' },
      source: 'container',
      supplier: { id: 'supplier-1', name: 'Test Supplier' },
    };

    it('Test 10: sales_rep response does NOT include costPerKg', async () => {
      mockPrisma.stockLot.findUnique.mockResolvedValue(lotWithCost);

      const result = await service.findOne('lot-uuid-1', 'sales_rep');

      expect(result).not.toHaveProperty('costPerKg');
    });

    // =========================================================================
    // Test 11: CONSTRAINT 12 — worker response has no costPerKg
    // =========================================================================

    it('Test 11: worker response does NOT include costPerKg', async () => {
      mockPrisma.stockLot.findUnique.mockResolvedValue(lotWithCost);

      const result = await service.findOne('lot-uuid-1', 'worker');

      expect(result).not.toHaveProperty('costPerKg');
    });

    // =========================================================================
    // Test 12: owner/accountant response DOES include costPerKg
    // =========================================================================

    it('Test 12: owner response DOES include costPerKg', async () => {
      mockPrisma.stockLot.findUnique.mockResolvedValue(lotWithCost);

      const result = await service.findOne('lot-uuid-1', 'owner');

      expect(result).toHaveProperty('costPerKg');
    });

    it('Test 12b: accountant response DOES include costPerKg', async () => {
      mockPrisma.stockLot.findUnique.mockResolvedValue(lotWithCost);

      const result = await service.findOne('lot-uuid-1', 'accountant');

      expect(result).toHaveProperty('costPerKg');
    });

    it('Test 12c: no role specified — costPerKg is preserved (not stripped)', async () => {
      mockPrisma.stockLot.findUnique.mockResolvedValue(lotWithCost);

      const result = await service.findOne('lot-uuid-1');

      expect(result).toHaveProperty('costPerKg');
    });

    it('throws NotFoundException when lot does not exist', async () => {
      mockPrisma.stockLot.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id', 'owner')).rejects.toThrow(NotFoundException);
    });

    it('stripping does not mutate the original DB object', async () => {
      const original = { ...lotWithCost };
      mockPrisma.stockLot.findUnique.mockResolvedValue(original);

      await service.findOne('lot-uuid-1', 'sales_rep');

      // Original DB record should not have been mutated
      expect(original).toHaveProperty('costPerKg');
    });
  });

  // =========================================================================
  // findAll() — CONSTRAINT 12 applied to list results
  // =========================================================================

  describe('findAll()', () => {
    it('strips costPerKg from all lots for sales_rep', async () => {
      const lots = [
        { id: 'lot-1', costPerKg: { toString: () => '0.8100' }, supplier: null },
        { id: 'lot-2', costPerKg: { toString: () => '0.9100' }, supplier: null },
      ];
      mockPrisma.$transaction.mockResolvedValue([lots, 2]);

      const result = await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, 'sales_rep');

      for (const lot of result.data) {
        expect(lot).not.toHaveProperty('costPerKg');
      }
    });

    it('includes costPerKg in all lots for owner', async () => {
      const lots = [
        { id: 'lot-1', costPerKg: { toString: () => '0.8100' }, supplier: null },
        { id: 'lot-2', costPerKg: { toString: () => '0.9100' }, supplier: null },
      ];
      mockPrisma.$transaction.mockResolvedValue([lots, 2]);

      const result = await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, 'owner');

      for (const lot of result.data) {
        expect(lot).toHaveProperty('costPerKg');
      }
    });
  });

  // =========================================================================
  // findAvailable() — unbounded list of lots with kgRemaining > 0, for the
  // warehouse-sale KG lot selector (WarehouseSales.tsx). Replaces relying on
  // findAll()'s paginated limit:100 fetch, which could hide an older lot
  // with real stock beyond the 100 most-recently-received.
  //
  // NOTE on test scope: unlike the packed-stock FIFO draw fix
  // (PackedStockService.getFifoDraw()), tracing the KG-sale flow confirmed
  // there is no automatic multi-lot consumption/FIFO-split here — a KG sale
  // always draws from exactly ONE StockLot, manually chosen by the user, and
  // StockLot has no reservedQuantity column. So "FIFO ordering" here means
  // preserving the existing createdAt-desc list order (same as findAll()),
  // "reserved/zero-available" means a kgRemaining=0 lot is correctly
  // excluded, and "no duplicate consumption" means no lot appears twice in
  // the result — this is a read-only listing endpoint, it does not decrement
  // or reserve anything.
  // =========================================================================

  describe('findAvailable()', () => {
    function makeLots(count: number, kgRemainingEach = 100) {
      return Array.from({ length: count }, (_, i) => ({
        id: `lot-${i + 1}`,
        charcoalType: 'BBQ',
        grade: 'A',
        kgRemaining: { toString: () => kgRemainingEach.toString() },
        costPerKg: { toString: () => '0.8100' },
        supplier: null,
      }));
    }

    it('scalability: a lot beyond record #100 is still returned — not capped at any page size', async () => {
      mockPrisma.stockLot.findMany.mockResolvedValue(makeLots(150));
      const result = await service.findAvailable('owner');
      expect(result).toHaveLength(150);
      expect(result.find((l: any) => l.id === 'lot-150')).toBeDefined();
      expect(result.find((l: any) => l.id === 'lot-101')).toBeDefined();
    });

    it('the query itself is unbounded — no take/skip passed to findMany', async () => {
      mockPrisma.stockLot.findMany.mockResolvedValue([]);
      await service.findAvailable('owner');
      const args = mockPrisma.stockLot.findMany.mock.calls[0][0];
      expect(args.take).toBeUndefined();
      expect(args.skip).toBeUndefined();
    });

    it('existing order preserved: createdAt descending, same as findAll()', async () => {
      mockPrisma.stockLot.findMany.mockResolvedValue([]);
      await service.findAvailable('owner');
      const args = mockPrisma.stockLot.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('scoped to kgRemaining > 0 — a zero-remaining lot is excluded via the where clause (the "reserved/zero-available" case for StockLot)', async () => {
      mockPrisma.stockLot.findMany.mockResolvedValue([]);
      await service.findAvailable('owner');
      const args = mockPrisma.stockLot.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ kgRemaining: { gt: 0 } });
    });

    it('multiple lots: all are returned, each exactly once — no duplicate rows', async () => {
      mockPrisma.stockLot.findMany.mockResolvedValue(makeLots(5));
      const result = await service.findAvailable('owner');
      const ids = result.map((l: any) => l.id);
      expect(ids).toEqual(['lot-1', 'lot-2', 'lot-3', 'lot-4', 'lot-5']);
      expect(new Set(ids).size).toBe(5);
    });

    it('small (≤100-lot) case still resolves identically to before — existing behavior unchanged', async () => {
      mockPrisma.stockLot.findMany.mockResolvedValue(makeLots(3, 250));
      const result = await service.findAvailable('owner');
      expect(result).toHaveLength(3);
      expect(result.every((l: any) => l.kgRemaining.toString() === '250')).toBe(true);
    });

    it('CONSTRAINT 12: strips costPerKg for sales_rep, same as findAll()', async () => {
      mockPrisma.stockLot.findMany.mockResolvedValue(makeLots(2));
      const result = await service.findAvailable('sales_rep');
      for (const lot of result) {
        expect(lot).not.toHaveProperty('costPerKg');
      }
    });

    it('CONSTRAINT 12: strips costPerKg for worker, same as findAll()', async () => {
      mockPrisma.stockLot.findMany.mockResolvedValue(makeLots(2));
      const result = await service.findAvailable('worker');
      for (const lot of result) {
        expect(lot).not.toHaveProperty('costPerKg');
      }
    });

    it('includes costPerKg for owner, same as findAll()', async () => {
      mockPrisma.stockLot.findMany.mockResolvedValue(makeLots(2));
      const result = await service.findAvailable('owner');
      for (const lot of result) {
        expect(lot).toHaveProperty('costPerKg');
      }
    });

    it('zero lots with stock returns an empty array without throwing', async () => {
      mockPrisma.stockLot.findMany.mockResolvedValue([]);
      const result = await service.findAvailable('owner');
      expect(result).toEqual([]);
    });
  });
});
