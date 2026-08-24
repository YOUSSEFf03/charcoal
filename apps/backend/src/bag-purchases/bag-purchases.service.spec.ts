import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BagPurchasesService } from './bag-purchases.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

describe('BagPurchasesService', () => {
  let service: BagPurchasesService;

  const mockPrisma = {
    bagPurchase: { findMany: fn(), count: fn(), findUnique: fn(), create: fn() },
    bagType: { findUnique: fn() },
    user: { findUnique: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BagPurchasesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BagPurchasesService>(BagPurchasesService);
  });

  // =========================================================================
  // create() — totalCost regression
  //
  // The live BagPurchases.tsx UI (both "quick-add by brand" and "per bag-type
  // add" forms) has never sent a `totalCost` field — only bagTypeId, quantity,
  // unitCost, date, notes. CreateBagPurchaseDto previously REQUIRED totalCost
  // (@IsNumberString(), no @IsOptional()), so every real submission from the
  // app was rejected by NestJS's global ValidationPipe with a 422
  // ("totalCost must be a number string") — confirmed live against the
  // running dev backend with the exact frontend payload. totalCost is now
  // always computed server-side as quantity × unitCost, the same principle
  // InvoiceCalculatorService.computeLines() already uses for line totals.
  // =========================================================================

  describe('create()', () => {
    const clerkUserId = 'clerk-user-1';
    const dbUser = { id: 'db-user-1', clerkId: clerkUserId };
    const bagType = { id: 'bagtype-1', name: '10kg Bag', nominalKg: '10' };

    it('computes totalCost server-side as quantity × unitCost — never from the request body (matches the live frontend payload shape, which has no totalCost field at all)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      mockPrisma.bagType.findUnique.mockResolvedValue(bagType);
      mockPrisma.bagPurchase.create.mockImplementation(async (args: any) => ({ id: 'bp-1', ...args.data }));

      const dto = {
        bagTypeId: 'bagtype-1',
        quantity: 100,
        unitCost: '8.50',
        date: '2026-08-20',
        notes: 'Bulk order',
      } as any; // 'as any' — deliberately omits totalCost, matching the real frontend payload

      const result = await service.create(dto, clerkUserId);

      expect(mockPrisma.bagPurchase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bagTypeId: 'bagtype-1',
            quantity: 100,
            unitCost: '8.50',
            totalCost: '850.00',
          }),
        }),
      );
      expect(result.totalCost).toBe('850.00');
    });

    it('computes totalCost with correct decimal precision for a non-integer unitCost', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      mockPrisma.bagType.findUnique.mockResolvedValue(bagType);
      mockPrisma.bagPurchase.create.mockImplementation(async (args: any) => ({ id: 'bp-2', ...args.data }));

      const dto = { bagTypeId: 'bagtype-1', quantity: 3, unitCost: '0.3333', date: '2026-08-20' } as any;

      await service.create(dto, clerkUserId);

      // 3 × 0.3333 = 0.9999 → rounded to 2dp = "1.00"
      expect(mockPrisma.bagPurchase.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ totalCost: '1.00' }) }),
      );
    });

    it('ignores any client-supplied totalCost entirely — always recomputed from quantity × unitCost', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      mockPrisma.bagType.findUnique.mockResolvedValue(bagType);
      mockPrisma.bagPurchase.create.mockImplementation(async (args: any) => ({ id: 'bp-3', ...args.data }));

      // A forged/stale totalCost that does NOT match quantity × unitCost.
      const dto = { bagTypeId: 'bagtype-1', quantity: 10, unitCost: '5.00', totalCost: '999999.00', date: '2026-08-20' } as any;

      await service.create(dto, clerkUserId);

      expect(mockPrisma.bagPurchase.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ totalCost: '50.00' }) }),
      );
    });

    it('throws NotFoundException when the bag type does not exist, and never creates a purchase', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      mockPrisma.bagType.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ bagTypeId: 'missing', quantity: 1, unitCost: '1.00', date: '2026-08-20' } as any, clerkUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.bagPurchase.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the caller has no matching DB user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ bagTypeId: 'bagtype-1', quantity: 1, unitCost: '1.00', date: '2026-08-20' } as any, clerkUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.bagType.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.bagPurchase.create).not.toHaveBeenCalled();
    });
  });
});
