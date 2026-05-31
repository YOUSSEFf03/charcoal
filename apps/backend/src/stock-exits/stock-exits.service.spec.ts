import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { StockExitsService } from './stock-exits.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockExitDto } from './dto/create-stock-exit.dto';

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

describe('StockExitsService', () => {
  let service: StockExitsService;

  const mockPrisma = {
    user: { findUnique: fn() },
    packedStock: { findUnique: fn(), update: fn() },
    stockExit: { create: fn(), findUnique: fn(), findMany: fn(), count: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockExitsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StockExitsService>(StockExitsService);
  });

  // =========================================================================
  // DTO validation tests (class-validator)
  // =========================================================================

  describe('CreateStockExitDto validation', () => {

    // =========================================================================
    // Test 1: missing exitType → validation errors
    // =========================================================================

    it('fails validation when exitType is missing', async () => {
      const dto = new CreateStockExitDto();
      // Provide all required fields except exitType
      dto.packedStockId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      dto.bagTypeId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
      dto.quantity = 5;
      dto.date = '2024-06-01';
      // exitType intentionally omitted

      const errors = await validate(dto);
      const exitTypeErrors = errors.filter((e) => e.property === 'exitType');
      expect(exitTypeErrors.length).toBeGreaterThan(0);
    });

    // =========================================================================
    // Test 2: missing date → validation errors
    // =========================================================================

    it('fails validation when date is missing', async () => {
      const dto = new CreateStockExitDto();
      dto.packedStockId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      dto.bagTypeId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
      dto.quantity = 5;
      (dto as any).exitType = 'sample';
      // date intentionally omitted

      const errors = await validate(dto);
      const dateErrors = errors.filter((e) => e.property === 'date');
      expect(dateErrors.length).toBeGreaterThan(0);
    });

    // =========================================================================
    // Sanity check: valid DTO passes validation
    // =========================================================================

    it('passes validation when all required fields are present and valid', async () => {
      const dto = new CreateStockExitDto();
      dto.packedStockId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      dto.bagTypeId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
      dto.quantity = 5;
      (dto as any).exitType = 'sample';
      dto.date = '2024-06-01';

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  // =========================================================================
  // Service-level tests
  // =========================================================================

  describe('create()', () => {

    // =========================================================================
    // Test 3: CONSTRAINT 5 — loggedById equals user.id resolved from clerkId, NOT from DTO
    // =========================================================================

    it('CONSTRAINT 5: creates StockExit with loggedById = user.id from clerkId (never from DTO body)', async () => {
      const clerkId = 'clerk-user-stockexit';
      const internalUserId = 'db-user-stockexit-id';
      const packedStockId = 'packed-stock-uuid-1';
      const bagTypeId = 'bag-type-uuid-se-1';

      const mockTx = {
        user: { findUnique: fn() },
        packedStock: { findUnique: fn(), update: fn() },
        stockExit: { create: fn() },
      };

      mockTx.user.findUnique.mockResolvedValue({
        id: internalUserId,
        clerkId,
      });

      mockTx.packedStock.findUnique.mockResolvedValue({
        id: packedStockId,
        quantity: 20,
        bagTypeId,
      });

      mockTx.packedStock.update.mockResolvedValue({});
      mockTx.stockExit.create.mockResolvedValue({ id: 'exit-uuid-1' });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const dto: CreateStockExitDto = {
        packedStockId,
        bagTypeId,
        quantity: 5,
        exitType: 'sample' as any,
        date: '2024-06-01',
      };

      await service.create(dto, clerkId);

      const createCall = mockTx.stockExit.create.mock.calls[0][0];
      // loggedById must be the internal DB user ID, not the clerkId or any DTO value
      expect(createCall.data.loggedById).toBe(internalUserId);
      // Confirm clerkId itself was NOT used as loggedById
      expect(createCall.data.loggedById).not.toBe(clerkId);
    });

    // =========================================================================
    // Test 4: CONSTRAINT 2 — packedStock.quantity - dto.quantity < 0 → throws BadRequestException
    // =========================================================================

    it('throws BadRequestException CONSTRAINT_VIOLATION when requested quantity exceeds available packed stock', async () => {
      const clerkId = 'clerk-user-stockexit-2';
      const packedStockId = 'packed-stock-uuid-2';
      const bagTypeId = 'bag-type-uuid-se-2';

      const mockTx = {
        user: { findUnique: fn() },
        packedStock: { findUnique: fn(), update: fn() },
        stockExit: { create: fn() },
      };

      mockTx.user.findUnique.mockResolvedValue({
        id: 'db-user-2',
        clerkId,
      });

      // Only 3 available, requesting 10
      mockTx.packedStock.findUnique.mockResolvedValue({
        id: packedStockId,
        quantity: 3,
        bagTypeId,
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const dto: CreateStockExitDto = {
        packedStockId,
        bagTypeId,
        quantity: 10,
        exitType: 'sample' as any,
        date: '2024-06-01',
      };

      await expect(service.create(dto, clerkId)).rejects.toThrow(BadRequestException);

      await expect(service.create(dto, clerkId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });

      // stockExit.create must not be called when validation fails
      expect(mockTx.stockExit.create).not.toHaveBeenCalled();
    });
  });
});
