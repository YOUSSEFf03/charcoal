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
    stockAdjustment: { findMany: fn(), findUnique: fn(), create: fn(), update: fn(), count: fn() },
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

      mockPrisma.user.findUnique.mockResolvedValue({ id: dbUserId, clerkId, role: 'owner' });
      const tx = setupTransaction();
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

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-uuid-1', clerkId, role: 'owner' });
      const tx = setupTransaction();
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

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-uuid-1', clerkId, role: 'owner' });
      const tx = setupTransaction();
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

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-uuid-1', clerkId, role: 'owner' });
      const tx = setupTransaction();
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

    // =====================================================================
    // BUG-F (P4): qtyBefore is resolved server-side from the LIVE row;
    // a forged/stale client qtyBefore is ignored.
    // =====================================================================
    it('BUG-F: ignores client qtyBefore and resolves it from the live lot value', async () => {
      const clerkId = 'clerk-owner-1';
      const lotId = '550e8400-e29b-41d4-a716-446655440000';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user', clerkId, role: 'owner' });
      const tx = setupTransaction();
      // Live value is 70, but the client lies that qtyBefore was 100.
      tx.stockLot.findUnique.mockResolvedValue({ id: lotId, kgRemaining: { toString: () => '70.000' } });
      tx.stockLot.update.mockResolvedValue({});
      tx.stockAdjustment.create.mockResolvedValue({ id: 'adj-f' });

      await service.create(
        {
          adjustmentType: 'lot' as any,
          lotId,
          qtyBefore: '100.000', // forged — must be ignored
          qtyAfter: '60.000',
          reason: 'Recount',
          date: '2024-01-15',
        },
        clerkId,
      );

      // qtyBefore persisted = live 70, NOT the client's 100.
      const createData = tx.stockAdjustment.create.mock.calls[0][0].data;
      expect(createData.qtyBefore).toBe('70.000');
      // difference = 60 − 70 = −10 (from the live value), not 60 − 100 = −40.
      expect(createData.difference).toBe('-10.000');
      // Stock changed by the atomic delta −10 (Decimal-precision string), never an absolute set to 60.
      expect(tx.stockLot.update.mock.calls[0][0].data.kgRemaining).toEqual({ increment: '-10.000' });
    });

    it('BUG-F/G: packed_stock create applies an atomic delta against the live value, not an absolute set', async () => {
      const clerkId = 'clerk-owner-1';
      const psId = '550e8400-e29b-41d4-a716-446655440099';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user', clerkId, role: 'owner' });
      const tx = setupTransaction();
      tx.packedStock.findUnique.mockResolvedValue({ id: psId, quantity: 50, reservedQuantity: 0 });
      tx.packedStock.update.mockResolvedValue({});
      tx.stockAdjustment.create.mockResolvedValue({ id: 'adj-ps' });

      await service.create(
        {
          adjustmentType: 'packed_stock' as any,
          packedStockId: psId,
          qtyBefore: '999', // forged
          qtyAfter: '45',
          reason: 'Recount',
          date: '2024-01-15',
        },
        clerkId,
      );

      // delta = 45 − 50 = −5 applied atomically; qtyBefore persisted = live 50.
      expect(tx.packedStock.update.mock.calls[0][0].data.quantity).toEqual({ increment: -5 });
      expect(tx.stockAdjustment.create.mock.calls[0][0].data.qtyBefore).toBe('50.000');
    });

    it('BUG-E: packed_stock create rejected when qtyAfter drops below reserved', async () => {
      const clerkId = 'clerk-owner-1';
      const psId = '550e8400-e29b-41d4-a716-446655440099';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user', clerkId, role: 'owner' });
      const tx = setupTransaction();
      tx.packedStock.findUnique.mockResolvedValue({ id: psId, quantity: 50, reservedQuantity: 40 });

      await expect(
        service.create(
          { adjustmentType: 'packed_stock' as any, packedStockId: psId, qtyBefore: '50', qtyAfter: '30', reason: 'x', date: '2024-01-15' },
          clerkId,
        ),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }) });
      expect(tx.packedStock.update).not.toHaveBeenCalled();
    });
  });

  // =====================================================================
  // BUG-G (P4): reverse/edit by inverse DELTA against the live value,
  // never an absolute restore that clobbers later activity.
  // =====================================================================
  describe('remove() / update() — atomic delta reversal (BUG-G)', () => {
    it('remove() applies the INVERSE of the adjustment difference, not an absolute restore', async () => {
      const adjId = 'adj-1';
      const psId = 'ps-9';
      // Original adjustment: qtyBefore 100 → qtyAfter 90, difference −10.
      // Since then a sale dropped live stock to 70. Deleting must add back +10 (→ 80),
      // NOT restore to the stale qtyBefore of 100.
      const tx = {
        stockAdjustment: {
          findUnique: fn().mockResolvedValue({
            id: adjId, adjustmentType: 'packed_stock', packedStockId: psId, lotId: null,
            status: 'approved',
            qtyBefore: { toString: () => '100.000' },
            difference: { toString: () => '-10.000' },
          }),
          delete: fn().mockResolvedValue({}),
        },
        stockLot: { update: fn() },
        packedStock: { update: fn().mockResolvedValue({}) },
      };
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.remove(adjId);

      // Inverse of −10 is +10, applied atomically — NOT `quantity: 100`.
      expect(tx.packedStock.update.mock.calls[0][0].data.quantity).toEqual({ increment: 10 });
    });

    it('update() applies the DELTA between new and old qtyAfter, not an absolute set', async () => {
      const adjId = 'adj-2';
      const lotId = 'lot-9';
      // Original qtyAfter 90; editing to 85 means stock must drop by 5 (delta −5),
      // applied atomically against whatever the live value is now.
      const tx = {
        stockAdjustment: {
          findUnique: fn().mockResolvedValue({
            id: adjId, adjustmentType: 'lot', lotId, packedStockId: null,
            status: 'approved',
            qtyBefore: { toString: () => '100.000' },
            qtyAfter:  { toString: () => '90.000' },
            difference: { toString: () => '-10.000' },
          }),
          update: fn().mockResolvedValue({ id: adjId }),
        },
        // kgRemaining reflects a plausible post-increment live value (any
        // non-negative number — this test is about the delta computation, not
        // the negative-stock guard, which has its own dedicated tests below).
        stockLot: { update: fn().mockResolvedValue({ kgRemaining: { toString: () => '95.000' } }) },
        packedStock: { update: fn() },
      };
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.update(adjId, { qtyAfter: '85.000' });

      // delta = 85 − 90 = −5 applied atomically (Decimal string); difference recorded = 85 − 100 = −15.
      expect(tx.stockLot.update.mock.calls[0][0].data.kgRemaining).toEqual({ increment: '-5.000' });
      expect(tx.stockAdjustment.update.mock.calls[0][0].data.difference).toBe('-15.000');
    });

    // ===================================================================
    // Negative-stock regression. update()/remove() apply their delta as an
    // atomic { increment } against the LIVE row — safe from read-modify-write
    // races — but previously never checked whether the RESULTING live value
    // stayed >= 0 (or, for packed stock, >= reservedQuantity). Editing/deleting
    // a correctly-computed delta can still corrupt stock if consumption
    // happened between the original adjustment and this edit/delete.
    // ===================================================================

    it('update() rejects an edit that would drive kgRemaining negative, and rolls back (no adjustment-record write survives)', async () => {
      const adjId = 'adj-neg-1';
      const lotId = 'lot-neg-1';
      // Original qtyAfter 90 -> editing down to 10 means delta = 10-90 = -80.
      // Only 30kg is actually left live (consumed by a sale since the original
      // adjustment) -> applying -80 would drive kgRemaining to -50.
      const tx = {
        stockAdjustment: {
          findUnique: fn().mockResolvedValue({
            id: adjId, adjustmentType: 'lot', lotId, packedStockId: null,
            status: 'approved',
            qtyBefore: { toString: () => '100.000' },
            qtyAfter:  { toString: () => '90.000' },
            difference: { toString: () => '-10.000' },
          }),
          update: fn(),
        },
        stockLot: { update: fn().mockResolvedValue({ kgRemaining: { toString: () => '-50.000' } }) },
        packedStock: { update: fn() },
      };
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.update(adjId, { qtyAfter: '10.000' })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });
      // The adjustment record itself must never be rewritten when the stock
      // mutation it depends on is rejected — the whole $transaction rolls back.
      expect(tx.stockAdjustment.update).not.toHaveBeenCalled();
    });

    it('update() rejects an edit that would drive packed stock below its reservedQuantity', async () => {
      const adjId = 'adj-neg-2';
      const psId = 'ps-neg-1';
      const tx = {
        stockAdjustment: {
          findUnique: fn().mockResolvedValue({
            id: adjId, adjustmentType: 'packed_stock', packedStockId: psId, lotId: null,
            status: 'approved',
            qtyBefore: { toString: () => '50' },
            qtyAfter:  { toString: () => '40' },
            difference: { toString: () => '-10' },
          }),
          update: fn(),
        },
        stockLot: { update: fn() },
        // Post-increment quantity (5) drops below reservedQuantity (8) — some of
        // those bags are already reserved by an in-flight shipment.
        packedStock: { update: fn().mockResolvedValue({ quantity: 5, reservedQuantity: 8 }) },
      };
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.update(adjId, { qtyAfter: '5' })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });
      expect(tx.stockAdjustment.update).not.toHaveBeenCalled();
    });

    it('remove() rejects a reversal that would drive kgRemaining negative', async () => {
      const adjId = 'adj-neg-3';
      const lotId = 'lot-neg-3';
      const tx = {
        stockAdjustment: {
          findUnique: fn().mockResolvedValue({
            id: adjId, adjustmentType: 'lot', lotId, packedStockId: null,
            status: 'approved',
            qtyBefore: { toString: () => '100.000' },
            difference: { toString: () => '-10.000' }, // reversal = +10
          }),
          delete: fn(),
        },
        // Live value is only 3kg (heavily consumed since the original adjustment) —
        // reversing +10 would drive it to -7.
        stockLot: { update: fn().mockResolvedValue({ kgRemaining: { toString: () => '-7.000' } }) },
        packedStock: { update: fn() },
      };
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.remove(adjId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });
      // The adjustment record itself must not be deleted when its reversal is rejected.
      expect(tx.stockAdjustment.delete).not.toHaveBeenCalled();
    });

    it('update() still succeeds when the post-increment result stays non-negative and above reserved', async () => {
      const adjId = 'adj-ok-1';
      const lotId = 'lot-ok-1';
      const tx = {
        stockAdjustment: {
          findUnique: fn().mockResolvedValue({
            id: adjId, adjustmentType: 'lot', lotId, packedStockId: null,
            status: 'approved',
            qtyBefore: { toString: () => '100.000' },
            qtyAfter:  { toString: () => '90.000' },
            difference: { toString: () => '-10.000' },
          }),
          update: fn().mockResolvedValue({ id: adjId }),
        },
        stockLot: { update: fn().mockResolvedValue({ kgRemaining: { toString: () => '15.000' } }) },
        packedStock: { update: fn() },
      };
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.update(adjId, { qtyAfter: '85.000' });

      expect(tx.stockAdjustment.update).toHaveBeenCalledTimes(1);
    });
  });

  // =====================================================================
  // BUG-H (workflow): two-step pending-approval flow.
  // =====================================================================
  describe('approval workflow (BUG-H)', () => {
    it('a NON-OWNER counter submits a PENDING adjustment with NO stock change', async () => {
      const clerkId = 'clerk-worker';
      const psId = '550e8400-e29b-41d4-a716-446655440099';

      // Counter is a worker, not an owner.
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'worker-db', clerkId, role: 'worker' });
      const tx = setupTransaction();
      tx.packedStock.findUnique.mockResolvedValue({ id: psId, quantity: 50, reservedQuantity: 0 });
      tx.stockAdjustment.create.mockImplementation((a: any) => Promise.resolve({ id: 'adj-pending', ...a.data }));

      await service.create(
        { adjustmentType: 'packed_stock' as any, packedStockId: psId, qtyBefore: '50', qtyAfter: '45', reason: 'count', date: '2024-01-15' },
        clerkId,
      );

      // No stock mutation while pending.
      expect(tx.packedStock.update).not.toHaveBeenCalled();
      const data = tx.stockAdjustment.create.mock.calls[0][0].data;
      expect(data.status).toBe('pending');
      expect(data.approvedById).toBeNull();
      expect(data.countedById).toBe('worker-db');
    });

    it('owner approve() applies the atomic delta and records a DISTINCT approver', async () => {
      const clerkId = 'clerk-owner';
      const psId = 'ps-approve';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'owner-db', clerkId, role: 'owner' });
      const tx = {
        stockAdjustment: {
          findUnique: fn().mockResolvedValue({
            id: 'adj-1', adjustmentType: 'packed_stock', packedStockId: psId, lotId: null,
            status: 'pending', countedById: 'worker-db',
            qtyAfter: { toString: () => '45' },
          }),
          update: fn().mockImplementation((a: any) => Promise.resolve({ id: 'adj-1', ...a.data })),
        },
        stockLot: { findUnique: fn(), update: fn() },
        packedStock: { findUnique: fn().mockResolvedValue({ id: psId, quantity: 50, reservedQuantity: 0 }), update: fn().mockResolvedValue({}) },
      };
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.approve('adj-1', clerkId);

      // Delta applied at approval time: 45 − live 50 = −5, atomic.
      expect(tx.packedStock.update.mock.calls[0][0].data.quantity).toEqual({ increment: -5 });
      const upd = tx.stockAdjustment.update.mock.calls[0][0].data;
      expect(upd.status).toBe('approved');
      expect(upd.approvedById).toBe('owner-db');
      // counter ≠ approver
      expect(upd.approvedById).not.toBe('worker-db');
    });

    it('approve() is rejected when the approver is the same identity as the counter', async () => {
      const clerkId = 'clerk-owner';
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'same-db', clerkId, role: 'owner' });
      const tx = {
        stockAdjustment: {
          findUnique: fn().mockResolvedValue({
            id: 'adj-1', adjustmentType: 'packed_stock', packedStockId: 'ps', lotId: null,
            status: 'pending', countedById: 'same-db', qtyAfter: { toString: () => '45' },
          }),
          update: fn(),
        },
        stockLot: { update: fn() },
        packedStock: { findUnique: fn(), update: fn() },
      };
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.approve('adj-1', clerkId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });
      expect(tx.packedStock.update).not.toHaveBeenCalled();
    });

    it('reject() discards a pending adjustment with no stock change', async () => {
      const clerkId = 'clerk-owner';
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'owner-db', clerkId, role: 'owner' });
      mockPrisma.stockAdjustment.findUnique.mockResolvedValue({ id: 'adj-1', status: 'pending', adjustmentType: 'lot', lotId: 'lot-1' });
      mockPrisma.stockAdjustment.update.mockImplementation((a: any) => Promise.resolve({ id: 'adj-1', ...a.data }));

      const result: any = await service.reject('adj-1', clerkId);

      expect(result.status).toBe('rejected');
      expect(mockPrisma.stockLot.update).not.toHaveBeenCalled();
    });
  });
});
