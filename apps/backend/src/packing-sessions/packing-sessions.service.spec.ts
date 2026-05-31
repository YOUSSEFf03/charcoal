import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PackingSessionsService } from './packing-sessions.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }

describe('PackingSessionsService', () => {
  let service: PackingSessionsService;

  const mockPrisma = {
    user: { findUnique: fn() },
    packingSession: { findMany: fn(), findUnique: fn(), create: fn(), count: fn() },
    packingSessionLot: { create: fn() },
    packedStock: { create: fn() },
    stockLot: { findMany: fn(), update: fn() },
    bagType: { findMany: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackingSessionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<PackingSessionsService>(PackingSessionsService);
  });

  // Helpers — makeTx mirrors what the service calls inside the transaction
  function makeTx(overrides: Record<string, any> = {}) {
    return {
      user: { upsert: fn(), findUnique: fn(), ...overrides.user },
      stockLot: { findMany: fn(), update: fn(), ...overrides.stockLot },
      bagType: { findMany: fn(), ...overrides.bagType },
      packingSession: { create: fn(), findUnique: fn(), ...overrides.packingSession },
      packingSessionLot: { create: fn(), ...overrides.packingSessionLot },
      packedStock: { create: fn(), ...overrides.packedStock },
    };
  }

  function setupTransaction(tx: ReturnType<typeof makeTx>) {
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
  }

  describe('createPackingSession()', () => {
    it('Test 1: throws CONSTRAINT_VIOLATION when kgUsed exceeds lot kgRemaining', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';

      const tx = makeTx();
      tx.user.upsert.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '100.000' } }]);

      setupTransaction(tx);

      await expect(
        service.createPackingSession(
          { lotInputs: [{ lotId, kg: '150.000' }], bagsOutput: [{ bagTypeId, qty: 5 }] },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createPackingSession(
          { lotInputs: [{ lotId, kg: '150.000' }], bagsOutput: [{ bagTypeId, qty: 5 }] },
          userId,
        ),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }) });
    });

    it('Test 1b: thrown exception includes "kgUsed exceeds lot kgRemaining" message', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';

      const tx = makeTx();
      tx.user.upsert.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '100.000' } }]);

      setupTransaction(tx);

      let caught: any;
      try {
        await service.createPackingSession(
          { lotInputs: [{ lotId, kg: '150.000' }], bagsOutput: [{ bagTypeId, qty: 5 }] },
          userId,
        );
      } catch (e) { caught = e; }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.response.error).toMatch(/kgUsed exceeds lot kgRemaining/);
    });

    it('Test 2: does NOT throw when kgUsed equals kgRemaining (boundary) and sets kgRemaining to "0.000"', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';
      const sessionId = 'session-uuid-1';

      const tx = makeTx();
      tx.user.upsert.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '100.000' } }]);
      tx.bagType.findMany.mockResolvedValue([{
        id: bagTypeId,
        nominalKg: { toString: () => '20.000' },
        workerRate: { toString: () => '1.500' },
      }]);
      tx.stockLot.update.mockResolvedValue({});
      tx.packingSession.create.mockResolvedValue({ id: sessionId });
      tx.packingSession.findUnique.mockResolvedValue({ id: sessionId, sessionLots: [] });
      tx.packingSessionLot.create.mockResolvedValue({});
      tx.packedStock.create.mockResolvedValue({});

      setupTransaction(tx);

      await expect(
        service.createPackingSession(
          { lotInputs: [{ lotId, kg: '100.000' }], bagsOutput: [{ bagTypeId, qty: 5 }] },
          userId,
        ),
      ).resolves.toBeDefined();

      expect(tx.stockLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kgRemaining: '0.000' }) }),
      );
    });

    it('Test 3: throws CONSTRAINT_VIOLATION when varianceKg is negative and varianceNote is missing', async () => {
      // kgConsumed = 10, bagType.nominalKg = 0.200, qty = 100 → kgOutputTotal = 20 → varianceKg = -10
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';

      const tx = makeTx();
      tx.user.upsert.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '100.000' } }]);
      tx.bagType.findMany.mockResolvedValue([{
        id: bagTypeId,
        nominalKg: { toString: () => '0.200' },
        workerRate: { toString: () => '1.000' },
      }]);

      setupTransaction(tx);

      let caught: any;
      try {
        await service.createPackingSession(
          { lotInputs: [{ lotId, kg: '10.000' }], bagsOutput: [{ bagTypeId, qty: 100 }] },
          userId,
        );
      } catch (e) { caught = e; }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.response.code).toBe('CONSTRAINT_VIOLATION');
      expect(caught.response.error).toMatch(/varianceNote/i);
    });

    it('Test 4: does NOT throw when varianceKg is negative and varianceNote is provided', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';

      const tx = makeTx();
      tx.user.upsert.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '100.000' } }]);
      tx.bagType.findMany.mockResolvedValue([{
        id: bagTypeId,
        nominalKg: { toString: () => '0.200' },
        workerRate: { toString: () => '1.000' },
      }]);
      tx.stockLot.update.mockResolvedValue({});
      tx.packingSession.create.mockResolvedValue({ id: 'session-uuid-4' });
      tx.packingSession.findUnique.mockResolvedValue({ id: 'session-uuid-4', sessionLots: [] });
      tx.packingSessionLot.create.mockResolvedValue({});
      tx.packedStock.create.mockResolvedValue({});

      setupTransaction(tx);

      await expect(
        service.createPackingSession(
          { lotInputs: [{ lotId, kg: '10.000' }], bagsOutput: [{ bagTypeId, qty: 100 }], varianceNote: 'Over-packed by mistake' },
          userId,
        ),
      ).resolves.toBeDefined();
    });

    it('Test 6: kgOutputTotal is exactly "8400.000" for 800 bags × 10.500 kg (no float drift)', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';
      const sessionId = 'session-uuid-6';

      const tx = makeTx();
      tx.user.upsert.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '99999.000' } }]);
      tx.bagType.findMany.mockResolvedValue([{
        id: bagTypeId,
        nominalKg: { toString: () => '10.500' },
        workerRate: { toString: () => '2.000' },
      }]);
      tx.stockLot.update.mockResolvedValue({});
      tx.packingSession.create.mockResolvedValue({ id: sessionId });
      tx.packingSession.findUnique.mockResolvedValue({ id: sessionId, sessionLots: [] });
      tx.packingSessionLot.create.mockResolvedValue({});
      tx.packedStock.create.mockResolvedValue({});

      setupTransaction(tx);

      await service.createPackingSession(
        { lotInputs: [{ lotId, kg: '9000.000' }], bagsOutput: [{ bagTypeId, qty: 800 }] },
        userId,
      );

      const createCall = tx.packingSession.create.mock.calls[0][0];
      expect(createCall.data.kgOutputTotal).toBe('8400.000');
    });
  });

  describe('findAll()', () => {
    it('Test 5: worker role uses own DB user id as workerId filter (ignores workerIdParam)', async () => {
      const workerClerkId = 'clerk-worker-1';
      const workerDbId    = 'db-worker-id-1';

      mockPrisma.user.findUnique.mockResolvedValue({ id: workerDbId, clerkId: workerClerkId });
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(1, 20, 'some-other-worker-id', undefined, undefined, undefined, { userId: workerClerkId, role: 'worker' });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { clerkId: workerClerkId } });
      const transactionArg = mockPrisma.$transaction.mock.calls[0][0];
      expect(transactionArg).toBeInstanceOf(Array);
    });

    it('Test 5b: non-worker role passes workerIdParam through (does not call user.findUnique)', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(1, 20, 'explicit-worker-uuid', undefined, undefined, undefined, { userId: 'clerk-owner-1', role: 'owner' });

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
