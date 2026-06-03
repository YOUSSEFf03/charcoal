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

    it('CONSTRAINT 5: loggedById = authenticated user even if DTO carries a fake loggedById', async () => {
      const clerkId = 'clerk-user-stockexit';
      const internalUserId = 'db-user-stockexit-id';
      const packedStockId = 'packed-stock-uuid-1';
      const bagTypeId = 'bag-type-uuid-se-1';

      // User lookup now happens outside the transaction
      mockPrisma.user.findUnique.mockResolvedValue({ id: internalUserId, clerkId });

      const mockTx = {
        packedStock: { findUnique: fn(), update: fn() },
        stockExit: { create: fn() },
      };

      mockTx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 20, reservedQuantity: 0, bagTypeId });
      mockTx.packedStock.update.mockResolvedValue({});
      mockTx.stockExit.create.mockResolvedValue({ id: 'exit-uuid-1' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      // Simulate a malicious caller injecting loggedById into the DTO body.
      // CreateStockExitDto has no loggedById field, but test this explicitly.
      const dto = {
        packedStockId,
        bagTypeId,
        quantity: 5,
        exitType: 'sample' as any,
        date: '2024-06-01',
        loggedById: 'ATTACKER-ID',   // ← should be ignored
      } as CreateStockExitDto;

      await service.create(dto, clerkId);

      const createCall = mockTx.stockExit.create.mock.calls[0][0];
      // loggedById must be the JWT-resolved DB user id, never the DTO value
      expect(createCall.data.loggedById).toBe(internalUserId);
      expect(createCall.data.loggedById).not.toBe('ATTACKER-ID');
      expect(createCall.data.loggedById).not.toBe(clerkId);
    });

    // =========================================================================
    // Test 4: CONSTRAINT 2 — packedStock.quantity - dto.quantity < 0 → throws BadRequestException
    // =========================================================================

    it('CONSTRAINT 2: quantity > available → 400 CONSTRAINT_VIOLATION; packedStock.update NOT called (rollback)', async () => {
      const clerkId = 'clerk-user-stockexit-2';
      const packedStockId = 'packed-stock-uuid-2';
      const bagTypeId = 'bag-type-uuid-se-2';

      // User lookup now happens outside the transaction
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-2', clerkId });

      const mockTx = {
        packedStock: { findUnique: fn(), update: fn() },
        stockExit: { create: fn() },
      };

      // Only 3 bags available — requesting 10
      mockTx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 3, reservedQuantity: 0, bagTypeId });
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

      // Neither the decrement nor the exit record must be written when validation fails.
      // In production the transaction rolls back; in the unit test the mocks confirm
      // neither call was made before the throw.
      expect(mockTx.packedStock.update).not.toHaveBeenCalled();
      expect(mockTx.stockExit.create).not.toHaveBeenCalled();
    });

    // =========================================================================
    // Test 5: BUG-E (P2) — stock exit must draw against FREE quantity
    // (quantity − reservedQuantity); reserved bags belong to a pending shipment.
    // =========================================================================

    it('BUG-E: cannot consume bags reserved for a pending shipment (free quantity only)', async () => {
      const clerkId = 'clerk-user-stockexit-3';
      const packedStockId = 'packed-stock-uuid-3';
      const bagTypeId = 'bag-type-uuid-se-3';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-3', clerkId });

      const mockTx = {
        packedStock: { findUnique: fn(), update: fn() },
        stockExit: { create: fn() },
      };

      // 20 bags exist but 18 are reserved → only 2 free; a request for 5 must be rejected.
      mockTx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 20, reservedQuantity: 18, bagTypeId });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const dto: CreateStockExitDto = {
        packedStockId,
        bagTypeId,
        quantity: 5,
        exitType: 'sample' as any,
        date: '2024-06-01',
      };

      await expect(service.create(dto, clerkId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });
      expect(mockTx.packedStock.update).not.toHaveBeenCalled();
      expect(mockTx.stockExit.create).not.toHaveBeenCalled();
    });
  });
});
