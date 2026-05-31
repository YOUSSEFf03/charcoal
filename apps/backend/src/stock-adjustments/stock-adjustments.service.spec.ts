import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { StockAdjustmentsService } from './stock-adjustments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';

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

describe('StockAdjustmentsService', () => {
  let service: StockAdjustmentsService;

  const mockPrisma = {
    stockAdjustment: { findMany: fn(), findUnique: fn(), create: fn(), count: fn() },
    stockLot: { findUnique: fn(), update: fn() },
    packedStock: { findUnique: fn(), update: fn() },
    user: { findUnique: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockAdjustmentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StockAdjustmentsService>(StockAdjustmentsService);
  });

  // Helper: set up callback-form $transaction mock
  function setupTransaction(txOverrides: Record<string, any> = {}) {
    const tx = {
      user: { findUnique: fn(), ...txOverrides.user },
      stockLot: { findUnique: fn(), update: fn(), ...txOverrides.stockLot },
      packedStock: { findUnique: fn(), update: fn(), ...txOverrides.packedStock },
      stockAdjustment: { create: fn(), ...txOverrides.stockAdjustment },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    return tx;
  }

  // =========================================================================
  // Test 7: CONSTRAINT 6 — reason required in DTO (class-validator)
  // =========================================================================

  describe('CreateStockAdjustmentDto validation', () => {
    it('Test 7: fails validation when reason is missing', async () => {
      const dto = plainToInstance(CreateStockAdjustmentDto, {
        adjustmentType: 'lot',
        lotId: '550e8400-e29b-41d4-a716-446655440000',
        qtyBefore: '100.000',
        qtyAfter: '90.000',
        date: '2024-01-15',
        // reason is intentionally MISSING
      });

      const errors = await validate(dto);
      const reasonError = errors.find((e) => e.property === 'reason');
      expect(reasonError).toBeDefined();
    });

    it('passes validation when all required fields including reason are present', async () => {
      const dto = plainToInstance(CreateStockAdjustmentDto, {
        adjustmentType: 'lot',
        lotId: '550e8400-e29b-41d4-a716-446655440000',
        qtyBefore: '100.000',
        qtyAfter: '90.000',
        reason: 'Recount after physical inventory',
        date: '2024-01-15',
      });

      const errors = await validate(dto);
      const reasonError = errors.find((e) => e.property === 'reason');
      expect(reasonError).toBeUndefined();
    });

    it('fails validation when reason is an empty string', async () => {
      const dto = plainToInstance(CreateStockAdjustmentDto, {
        adjustmentType: 'lot',
        lotId: '550e8400-e29b-41d4-a716-446655440000',
        qtyBefore: '100.000',
        qtyAfter: '90.000',
        reason: '',
        date: '2024-01-15',
      });

      const errors = await validate(dto);
      const reasonError = errors.find((e) => e.property === 'reason');
      expect(reasonError).toBeDefined();
    });
  });

  // =========================================================================
  // Test 8: CONSTRAINT 13 — approvedById = countedById = caller's user id
  // =========================================================================

  describe('create()', () => {
    it('Test 8: sets both approvedById and countedById to the caller\'s DB user id', async () => {
      const clerkId = 'clerk-owner-1';
      const dbUserId = 'db-user-uuid-1';
      const lotId = '550e8400-e29b-41d4-a716-446655440000';

      const tx = setupTransaction();
      tx.user.findUnique.mockResolvedValue({ id: dbUserId, clerkId });
      tx.stockLot.findUnique.mockResolvedValue({
        id: lotId,
        kgRemaining: { toString: () => '100.000' },
      });
      tx.stockLot.update.mockResolvedValue({});
      tx.stockAdjustment.create.mockResolvedValue({ id: 'adj-1' });

      await service.create(
        {
          adjustmentType: 'lot' as any,
          lotId,
          qtyBefore: '100.000',
          qtyAfter: '90.000',
          reason: 'Recount',
          date: '2024-01-15',
        },
        clerkId,
      );

      const createCall = tx.stockAdjustment.create.mock.calls[0][0];
      expect(createCall.data.approvedById).toBe(dbUserId);
      expect(createCall.data.countedById).toBe(dbUserId);
    });

    // =========================================================================
    // Test 9: CONSTRAINT 1/2 — qtyAfter < 0 → 400 for lot adjustment
    // =========================================================================

    it('Test 9: throws BadRequestException (CONSTRAINT_VIOLATION) when qtyAfter is negative for lot adjustment', async () => {
      const clerkId = 'clerk-owner-1';
      const lotId = '550e8400-e29b-41d4-a716-446655440000';

      const tx = setupTransaction();
      tx.user.findUnique.mockResolvedValue({ id: 'db-user-uuid-1', clerkId });
      tx.stockLot.findUnique.mockResolvedValue({
        id: lotId,
        kgRemaining: { toString: () => '100.000' },
      });

      let caught: any;
      try {
        await service.create(
          {
            adjustmentType: 'lot' as any,
            lotId,
            qtyBefore: '100.000',
            qtyAfter: '-5.000',
            reason: 'test',
            date: '2024-01-15',
          },
          clerkId,
        );
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.response.code).toBe('CONSTRAINT_VIOLATION');
    });

    it('Test 9b: error message mentions qtyAfter for negative lot adjustment', async () => {
      const clerkId = 'clerk-owner-1';
      const lotId = '550e8400-e29b-41d4-a716-446655440000';

      const tx = setupTransaction();
      tx.user.findUnique.mockResolvedValue({ id: 'db-user-uuid-1', clerkId });
      tx.stockLot.findUnique.mockResolvedValue({
        id: lotId,
        kgRemaining: { toString: () => '100.000' },
      });

      await expect(
        service.create(
          {
            adjustmentType: 'lot' as any,
            lotId,
            qtyBefore: '100.000',
            qtyAfter: '-5.000',
            reason: 'test',
            date: '2024-01-15',
          },
          clerkId,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'CONSTRAINT_VIOLATION',
          error: expect.stringContaining('qtyAfter'),
        }),
      });
    });

    it('succeeds with qtyAfter = "0.000" (zero is allowed for lot adjustment)', async () => {
      const clerkId = 'clerk-owner-1';
      const lotId = '550e8400-e29b-41d4-a716-446655440000';

      const tx = setupTransaction();
      tx.user.findUnique.mockResolvedValue({ id: 'db-user-uuid-1', clerkId });
      tx.stockLot.findUnique.mockResolvedValue({
        id: lotId,
        kgRemaining: { toString: () => '100.000' },
      });
      tx.stockLot.update.mockResolvedValue({});
      tx.stockAdjustment.create.mockResolvedValue({ id: 'adj-zero' });

      await expect(
        service.create(
          {
            adjustmentType: 'lot' as any,
            lotId,
            qtyBefore: '100.000',
            qtyAfter: '0.000',
            reason: 'All stock consumed',
            date: '2024-01-15',
          },
          clerkId,
        ),
      ).resolves.toBeDefined();
    });
  });
});
