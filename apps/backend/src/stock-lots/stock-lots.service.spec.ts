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
});
