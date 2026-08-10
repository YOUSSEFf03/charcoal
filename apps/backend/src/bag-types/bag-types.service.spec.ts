import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BagTypesService } from './bag-types.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

function foreignKeyError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
    code: 'P2003',
    clientVersion: 'test',
  });
}

describe('BagTypesService', () => {
  let service: BagTypesService;

  const mockPrisma = {
    bagType: { findUnique: fn(), findMany: fn(), create: fn(), update: fn(), delete: fn(), count: fn() },
    packedStock: { count: fn() },
    orderBagLine: { count: fn() },
    shipmentBag: { count: fn() },
    stockExit: { count: fn() },
    clientOrder: { count: fn() },
    bagPurchase: { count: fn() },
    $transaction: fn(),
  };

  const bagType = { id: 'bt-1', name: '5kg bag', nominalKg: '5.000', costPerBag: '0.5000', workerRate: '0.1000', note: null };

  // Reset every count mock to 0 (no references) before each test; individual
  // tests override the one relation they're checking.
  function resetCountsToZero() {
    mockPrisma.packedStock.count.mockResolvedValue(0);
    mockPrisma.orderBagLine.count.mockResolvedValue(0);
    mockPrisma.shipmentBag.count.mockResolvedValue(0);
    mockPrisma.stockExit.count.mockResolvedValue(0);
    mockPrisma.clientOrder.count.mockResolvedValue(0);
    mockPrisma.bagPurchase.count.mockResolvedValue(0);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    resetCountsToZero();
    mockPrisma.bagType.findUnique.mockResolvedValue(bagType);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BagTypesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BagTypesService>(BagTypesService);
  });

  describe('remove()', () => {
    it('throws NotFoundException when the bag type does not exist', async () => {
      mockPrisma.bagType.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing-id')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.bagType.delete).not.toHaveBeenCalled();
    });

    it('Scenario: zero references — deletes successfully', async () => {
      mockPrisma.bagType.delete.mockResolvedValue(bagType);

      await service.remove('bt-1');

      expect(mockPrisma.bagType.delete).toHaveBeenCalledWith({ where: { id: 'bt-1' } });
    });

    it('Scenario: referenced only by BagPurchase — 409, not 500', async () => {
      mockPrisma.bagPurchase.count.mockResolvedValue(1);

      await expect(service.remove('bt-1')).rejects.toThrow(ConflictException);
      expect(mockPrisma.bagType.delete).not.toHaveBeenCalled();
    });

    it('Scenario: referenced by PackedStock — 409', async () => {
      mockPrisma.packedStock.count.mockResolvedValue(1);

      await expect(service.remove('bt-1')).rejects.toThrow(ConflictException);
      expect(mockPrisma.bagType.delete).not.toHaveBeenCalled();
    });

    it('Scenario: referenced by OrderBagLine — 409', async () => {
      mockPrisma.orderBagLine.count.mockResolvedValue(1);

      await expect(service.remove('bt-1')).rejects.toThrow(ConflictException);
      expect(mockPrisma.bagType.delete).not.toHaveBeenCalled();
    });

    it('Scenario: referenced by ShipmentBag — 409', async () => {
      mockPrisma.shipmentBag.count.mockResolvedValue(1);

      await expect(service.remove('bt-1')).rejects.toThrow(ConflictException);
      expect(mockPrisma.bagType.delete).not.toHaveBeenCalled();
    });

    it('Scenario: referenced by StockExit — 409', async () => {
      mockPrisma.stockExit.count.mockResolvedValue(1);

      await expect(service.remove('bt-1')).rejects.toThrow(ConflictException);
      expect(mockPrisma.bagType.delete).not.toHaveBeenCalled();
    });

    it('Scenario: referenced by ClientOrder — 409', async () => {
      mockPrisma.clientOrder.count.mockResolvedValue(1);

      await expect(service.remove('bt-1')).rejects.toThrow(ConflictException);
      expect(mockPrisma.bagType.delete).not.toHaveBeenCalled();
    });

    it('rejects with the same { error, code: CONFLICT } shape for every guarded relation', async () => {
      mockPrisma.stockExit.count.mockResolvedValue(1);

      await expect(service.remove('bt-1')).rejects.toMatchObject({
        response: { error: 'Bag type has linked records', code: 'CONFLICT' },
      });
    });

    it('defense in depth: converts a raw P2003 from delete() into a 409, not an unhandled error', async () => {
      // All counts are 0 (guard passes) but the delete itself still hits a
      // foreign-key constraint — e.g. a relation added later without updating the guard.
      mockPrisma.bagType.delete.mockRejectedValue(foreignKeyError());

      await expect(service.remove('bt-1')).rejects.toThrow(ConflictException);
      await expect(service.remove('bt-1')).rejects.toMatchObject({
        response: { error: 'Bag type has linked records', code: 'CONFLICT' },
      });
    });

    it('re-throws a non-P2003 error from delete() unchanged (not swallowed as a 409)', async () => {
      const otherError = new Error('connection lost');
      mockPrisma.bagType.delete.mockRejectedValue(otherError);

      await expect(service.remove('bt-1')).rejects.toBe(otherError);
    });
  });
});
