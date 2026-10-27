import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PackingSessionsService } from './packing-sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClerkUser } from '../auth/clerk.strategy';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }

// Every createPackingSession() call now requires a valid, existing workerEntityId —
// shared across all create tests below, mirroring the one real Worker createPackingSession()
// validates against via mockPrisma.worker.findUnique (see beforeEach default).
const VALID_WORKER_ID = '550e8400-e29b-41d4-a716-446655449999';

describe('PackingSessionsService', () => {
  let service: PackingSessionsService;

  const mockPrisma = {
    user: { findUnique: fn() },
    worker: { findUnique: fn() },
    packingSession: { findMany: fn(), findUnique: fn(), create: fn(), count: fn() },
    packingSessionLot: { create: fn(), createMany: fn(), deleteMany: fn() },
    packedStock: { create: fn(), createMany: fn(), deleteMany: fn() },
    stockLot: { findMany: fn(), update: fn() },
    bagType: { findMany: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: workerEntityId always resolves to a real worker unless a specific test
    // overrides this to simulate a missing/invalid one.
    mockPrisma.worker.findUnique.mockResolvedValue({ id: VALID_WORKER_ID, name: 'Test Worker' });
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
      $queryRaw: fn().mockResolvedValue([]),
      user: { findUnique: fn(), ...overrides.user },
      // Default: resolves for updatePackingSession()'s worker-existence check (only
      // reached when a non-empty workerEntityId is being set). Individual tests that
      // assign one via update override this to a specific mock as needed.
      worker: { findUnique: fn().mockResolvedValue({ id: VALID_WORKER_ID, name: 'Test Worker' }), ...overrides.worker },
      stockLot: { findMany: fn(), update: fn(), ...overrides.stockLot },
      bagType: { findMany: fn(), ...overrides.bagType },
      packingSession: { create: fn(), findUnique: fn(), update: fn(), ...overrides.packingSession },
      packingSessionLot: { create: fn(), createMany: fn(), deleteMany: fn(), ...overrides.packingSessionLot },
      packedStock: { create: fn(), createMany: fn(), deleteMany: fn(), ...overrides.packedStock },
      stockExit: { count: fn(), ...overrides.stockExit },
      stockAdjustment: { count: fn(), ...overrides.stockAdjustment },
      shipmentReservation: { count: fn(), ...overrides.shipmentReservation },
      // Waste-pool sync (syncPackingVarianceWasteEntry, called unconditionally by both
      // create and update) — default: no pre-existing entry for this session, and a
      // zero-balance pool. Most tests never exercise a non-zero variance delta, so these
      // defaults are never read past the no-op early-return; tests that DO produce a
      // non-zero variance still resolve safely against a real (zero) balance.
      wasteEntry: { findUnique: fn().mockResolvedValue(null), create: fn(), update: fn(), delete: fn(), ...overrides.wasteEntry },
      wasteStock: {
        findUniqueOrThrow: fn().mockResolvedValue({ id: 'singleton', kgOnHand: { toString: () => '0.000' } }),
        update: fn(),
        ...overrides.wasteStock,
      },
    };
  }

  function setupTransaction(tx: ReturnType<typeof makeTx>) {
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
  }

  describe('createPackingSession()', () => {
    it('throws 403 NO_USER when Clerk userId has no matching DB user', async () => {
      // User lookup now happens before the transaction
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const tx = makeTx();
      setupTransaction(tx);

      const dto = { lotInputs: [{ lotId: 'any-lot', kg: '10.000' }], bagsOutput: [{ bagTypeId: 'any-bag', qty: 1 }], workerEntityId: VALID_WORKER_ID };

      await expect(
        service.createPackingSession(dto, 'unsynced-clerk-id'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.createPackingSession(dto, 'unsynced-clerk-id'),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NO_USER' }) });
    });

    it('Test 1: throws CONSTRAINT_VIOLATION when kgUsed exceeds lot kgRemaining', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.bagType.findMany.mockResolvedValue([{
        id: bagTypeId,
        nominalKg: { toString: () => '20.000' },
        workerRate: { toString: () => '1.000' },
      }]);
      const tx = makeTx();
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '100.000' }, costPerKg: { toString: () => '2.000' } }]);

      setupTransaction(tx);

      await expect(
        service.createPackingSession(
          { lotInputs: [{ lotId, kg: '150.000' }], bagsOutput: [{ bagTypeId, qty: 5 }], workerEntityId: VALID_WORKER_ID },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createPackingSession(
          { lotInputs: [{ lotId, kg: '150.000' }], bagsOutput: [{ bagTypeId, qty: 5 }], workerEntityId: VALID_WORKER_ID },
          userId,
        ),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }) });
    });

    it('Test 1b: thrown exception includes "kgUsed exceeds lot kgRemaining" message', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.bagType.findMany.mockResolvedValue([{
        id: bagTypeId,
        nominalKg: { toString: () => '20.000' },
        workerRate: { toString: () => '1.000' },
      }]);
      const tx = makeTx();
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '100.000' }, costPerKg: { toString: () => '2.000' } }]);

      setupTransaction(tx);

      let caught: any;
      try {
        await service.createPackingSession(
          { lotInputs: [{ lotId, kg: '150.000' }], bagsOutput: [{ bagTypeId, qty: 5 }], workerEntityId: VALID_WORKER_ID },
          userId,
        );
      } catch (e) { caught = e; }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.response.error).toMatch(/kgUsed exceeds lot kgRemaining/);
    });

    it('Test 2: does NOT throw when kgUsed equals kgRemaining (boundary) and decrements by exactly the input', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';
      const sessionId = 'session-uuid-1';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.bagType.findMany.mockResolvedValue([{
        id: bagTypeId,
        nominalKg: { toString: () => '20.000' },
        workerRate: { toString: () => '1.500' },
      }]);
      mockPrisma.packingSession.findUnique.mockResolvedValue({ id: sessionId, sessionLots: [] });

      const tx = makeTx();
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '100.000' }, costPerKg: { toString: () => '2.000' } }]);
      tx.stockLot.update.mockResolvedValue({});
      tx.packingSession.create.mockResolvedValue({ id: sessionId });
      tx.packingSessionLot.createMany.mockResolvedValue({ count: 1 });
      tx.packedStock.createMany.mockResolvedValue({ count: 1 });

      setupTransaction(tx);

      await expect(
        service.createPackingSession(
          { lotInputs: [{ lotId, kg: '100.000' }], bagsOutput: [{ bagTypeId, qty: 5 }], workerEntityId: VALID_WORKER_ID },
          userId,
        ),
      ).resolves.toBeDefined();

      expect(tx.stockLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kgRemaining: { decrement: '100.000' } }) }),
      );
    });

    it('Test 3: throws CONSTRAINT_VIOLATION when varianceKg is negative and varianceNote is missing', async () => {
      // kgConsumed = 10, bagType.nominalKg = 0.200, qty = 100 → kgOutputTotal = 20 → varianceKg = -10
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.bagType.findMany.mockResolvedValue([{
        id: bagTypeId,
        nominalKg: { toString: () => '0.200' },
        workerRate: { toString: () => '1.000' },
      }]);

      const tx = makeTx();
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '100.000' }, costPerKg: { toString: () => '2.000' } }]);

      setupTransaction(tx);

      let caught: any;
      try {
        await service.createPackingSession(
          { lotInputs: [{ lotId, kg: '10.000' }], bagsOutput: [{ bagTypeId, qty: 100 }], workerEntityId: VALID_WORKER_ID },
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

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.bagType.findMany.mockResolvedValue([{
        id: bagTypeId,
        nominalKg: { toString: () => '0.200' },
        workerRate: { toString: () => '1.000' },
      }]);
      mockPrisma.packingSession.findUnique.mockResolvedValue({ id: 'session-uuid-4', sessionLots: [] });

      const tx = makeTx();
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '100.000' }, costPerKg: { toString: () => '2.000' } }]);
      tx.stockLot.update.mockResolvedValue({});
      tx.packingSession.create.mockResolvedValue({ id: 'session-uuid-4' });
      tx.packingSessionLot.createMany.mockResolvedValue({ count: 1 });
      tx.packedStock.createMany.mockResolvedValue({ count: 1 });

      setupTransaction(tx);

      await expect(
        service.createPackingSession(
          { lotInputs: [{ lotId, kg: '10.000' }], bagsOutput: [{ bagTypeId, qty: 100 }], varianceNote: 'Over-packed by mistake', workerEntityId: VALID_WORKER_ID },
          userId,
        ),
      ).resolves.toBeDefined();
    });

    it('splits PackedStock proportionally across lots by kg consumed (Option B)', async () => {
      // Scenario: 60 kg from lot1 (costPerKg=2.00), 40 kg from lot2 (costPerKg=3.00)
      // 10 bags × 5 kg nominal = 50 kg output.
      // Expected split: lot1 → 6 bags, lot2 → 4 bags (proportional to 60:40).
      // COGS if sold = (6×5×2.00) + (4×5×3.00) = 60 + 60 = 120.00  (not 100.00 with wrong single-lot)
      const lotId1    = '550e8400-e29b-41d4-a716-aaaaaaaaaaaa';
      const lotId2    = '550e8400-e29b-41d4-a716-bbbbbbbbbbbb';
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const userId    = 'clerk-user-1';
      const sessionId = 'session-uuid-split';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.bagType.findMany.mockResolvedValue([{
        id: bagTypeId,
        nominalKg: { toString: () => '5.000' },
        workerRate: { toString: () => '1.000' },
      }]);
      mockPrisma.packingSession.findUnique.mockResolvedValue({ id: sessionId, sessionLots: [] });

      const tx = makeTx();
      tx.stockLot.findMany.mockResolvedValue([
        { id: lotId1, kgRemaining: { toString: () => '100.000' }, costPerKg: { toString: () => '2.000' } },
        { id: lotId2, kgRemaining: { toString: () => '100.000' }, costPerKg: { toString: () => '3.000' } },
      ]);
      tx.stockLot.update.mockResolvedValue({});
      tx.packingSession.create.mockResolvedValue({ id: sessionId });
      tx.packingSessionLot.createMany.mockResolvedValue({ count: 1 });
      tx.packedStock.createMany.mockResolvedValue({ count: 2 });

      setupTransaction(tx);

      await service.createPackingSession(
        {
          lotInputs: [
            { lotId: lotId1, kg: '60.000' },
            { lotId: lotId2, kg: '40.000' },
          ],
          bagsOutput: [{ bagTypeId, qty: 10 }],
          workerEntityId: VALID_WORKER_ID,
        },
        userId,
      );

      // Must create exactly 1 createMany call with 2 PackedStock rows (one per lot)
      expect(tx.packedStock.createMany).toHaveBeenCalledTimes(1);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: calls } = tx.packedStock.createMany.mock.calls[0][0] as any;
      const ps1 = calls.find((d: any) => d.lotId === lotId1);
      const ps2 = calls.find((d: any) => d.lotId === lotId2);

      expect(ps1).toBeDefined();
      expect(ps2).toBeDefined();
      expect(ps1.quantity).toBe(6);   // 10 × 60/100 = 6
      expect(ps2.quantity).toBe(4);   // 10 × 40/100 = 4
      expect(ps1.quantity + ps2.quantity).toBe(10); // sum preserved exactly
    });

    it('Issue #8 per-lot: lot A (600kg) and lot B (410kg) each decrement by exactly their own input', async () => {
      // 600 + 410 = 1010 kg in; 100 bags × 10 kg = 1000 kg out; variance 10 kg (note provided).
      const lotA      = '550e8400-e29b-41d4-a716-aaaaaaaaaaaa';
      const lotB      = '550e8400-e29b-41d4-a716-bbbbbbbbbbbb';
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const userId    = 'clerk-user-1';
      const sessionId = 'session-uuid-perlot';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.bagType.findMany.mockResolvedValue([{
        id: bagTypeId, nominalKg: { toString: () => '10.000' }, workerRate: { toString: () => '1.000' },
      }]);
      mockPrisma.packingSession.findUnique.mockResolvedValue({ id: sessionId, sessionLots: [] });

      const tx = makeTx();
      tx.stockLot.findMany.mockResolvedValue([
        { id: lotA, kgRemaining: { toString: () => '1000.000' }, costPerKg: { toString: () => '2.000' } },
        { id: lotB, kgRemaining: { toString: () => '1000.000' }, costPerKg: { toString: () => '3.000' } },
      ]);
      tx.stockLot.update.mockResolvedValue({});
      tx.packingSession.create.mockResolvedValue({ id: sessionId });
      tx.packingSessionLot.createMany.mockResolvedValue({ count: 2 });
      tx.packedStock.createMany.mockResolvedValue({ count: 2 });
      setupTransaction(tx);

      await service.createPackingSession(
        {
          lotInputs: [{ lotId: lotA, kg: '600.000' }, { lotId: lotB, kg: '410.000' }],
          bagsOutput: [{ bagTypeId, qty: 100 }],
          varianceNote: '10 kg loss',
          workerEntityId: VALID_WORKER_ID,
        },
        userId,
      );

      const updates = tx.stockLot.update.mock.calls.map((c: any) => c[0]);
      const upA = updates.find((u: any) => u.where.id === lotA);
      const upB = updates.find((u: any) => u.where.id === lotB);
      expect(upA.data.kgRemaining).toEqual({ decrement: '600.000' });
      expect(upB.data.kgRemaining).toEqual({ decrement: '410.000' });
      // Exactly one decrement per distinct lot — no extra writes.
      expect(updates.filter((u: any) => u.where.id === lotA)).toHaveLength(1);
      expect(updates.filter((u: any) => u.where.id === lotB)).toHaveLength(1);
    });

    it('Issue #8 duplicate-lot: same lotId twice (300 + 200) decrements once by exactly 500 — no lost update', async () => {
      const lotId     = '550e8400-e29b-41d4-a716-cccccccccccc';
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const userId    = 'clerk-user-1';
      const sessionId = 'session-uuid-dup';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.bagType.findMany.mockResolvedValue([{
        id: bagTypeId, nominalKg: { toString: () => '10.000' }, workerRate: { toString: () => '1.000' },
      }]);
      mockPrisma.packingSession.findUnique.mockResolvedValue({ id: sessionId, sessionLots: [] });

      const tx = makeTx();
      tx.stockLot.findMany.mockResolvedValue([
        { id: lotId, kgRemaining: { toString: () => '1000.000' }, costPerKg: { toString: () => '2.000' } },
      ]);
      tx.stockLot.update.mockResolvedValue({});
      tx.packingSession.create.mockResolvedValue({ id: sessionId });
      tx.packingSessionLot.createMany.mockResolvedValue({ count: 1 });
      tx.packedStock.createMany.mockResolvedValue({ count: 1 });
      setupTransaction(tx);

      await service.createPackingSession(
        {
          lotInputs: [{ lotId, kg: '300.000' }, { lotId, kg: '200.000' }],
          bagsOutput: [{ bagTypeId, qty: 50 }],
          workerEntityId: VALID_WORKER_ID,
        },
        userId,
      );

      const updates = tx.stockLot.update.mock.calls.map((c: any) => c[0]).filter((u: any) => u.where.id === lotId);
      // Exactly ONE update for the lot, decrementing the SUM (500), not 300 or 200.
      expect(updates).toHaveLength(1);
      expect(updates[0].data.kgRemaining).toEqual({ decrement: '500.000' });

      // Junction rows are aggregated to one row per distinct lot.
      const junctionData = tx.packingSessionLot.createMany.mock.calls[0][0].data;
      expect(junctionData).toHaveLength(1);
      expect(junctionData[0].kgUsed).toBe('500.000');
    });

    it('Issue #8 conservation: rejects when output exceeds input beyond variance (invariant guard)', async () => {
      // 100 kg in, 100 bags × 10 kg = 1000 kg out → variance -900, no note → CONSTRAINT_VIOLATION.
      const lotId     = '550e8400-e29b-41d4-a716-dddddddddddd';
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const userId    = 'clerk-user-1';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.bagType.findMany.mockResolvedValue([{
        id: bagTypeId, nominalKg: { toString: () => '10.000' }, workerRate: { toString: () => '1.000' },
      }]);

      const tx = makeTx();
      tx.stockLot.findMany.mockResolvedValue([
        { id: lotId, kgRemaining: { toString: () => '1000.000' }, costPerKg: { toString: () => '2.000' } },
      ]);
      setupTransaction(tx);

      let caught: any;
      try {
        await service.createPackingSession(
          { lotInputs: [{ lotId, kg: '100.000' }], bagsOutput: [{ bagTypeId, qty: 100 }], workerEntityId: VALID_WORKER_ID },
          userId,
        );
      } catch (e) { caught = e; }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.response.code).toBe('CONSTRAINT_VIOLATION');
    });

    it('Test 6: kgOutputTotal is exactly "8400.000" for 800 bags × 10.500 kg (no float drift)', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';
      const sessionId = 'session-uuid-6';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.bagType.findMany.mockResolvedValue([{
        id: bagTypeId,
        nominalKg: { toString: () => '10.500' },
        workerRate: { toString: () => '2.000' },
      }]);
      mockPrisma.packingSession.findUnique.mockResolvedValue({ id: sessionId, sessionLots: [] });

      const tx = makeTx();
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '99999.000' }, costPerKg: { toString: () => '2.000' } }]);
      tx.stockLot.update.mockResolvedValue({});
      tx.packingSession.create.mockResolvedValue({ id: sessionId });
      tx.packingSessionLot.createMany.mockResolvedValue({ count: 1 });
      tx.packedStock.createMany.mockResolvedValue({ count: 1 });

      setupTransaction(tx);

      await service.createPackingSession(
        { lotInputs: [{ lotId, kg: '9000.000' }], bagsOutput: [{ bagTypeId, qty: 800 }], workerEntityId: VALID_WORKER_ID },
        userId,
      );

      const createCall = tx.packingSession.create.mock.calls[0][0];
      expect(createCall.data.kgOutputTotal).toBe('8400.000');
    });

    it('snapshots ratePerBag onto each bagsOutput line at creation time', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440099';
      const lotId     = '550e8400-e29b-41d4-a716-446655440098';
      const userId    = 'clerk-user-1';
      const sessionId = 'session-uuid-snapshot';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.bagType.findMany.mockResolvedValue([{
        id: bagTypeId,
        nominalKg: { toString: () => '10.000' },
        workerRate: { toString: () => '0.1200' },
      }]);

      const tx = makeTx();
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '1000.000' }, costPerKg: { toString: () => '0.300' } }]);
      tx.stockLot.update.mockResolvedValue({});
      tx.packingSession.create.mockResolvedValue({ id: sessionId });
      tx.packingSessionLot.createMany.mockResolvedValue({ count: 1 });
      tx.packedStock.createMany.mockResolvedValue({ count: 1 });
      setupTransaction(tx);

      await service.createPackingSession(
        { lotInputs: [{ lotId, kg: '100.000' }], bagsOutput: [{ bagTypeId, qty: 10 }], workerEntityId: VALID_WORKER_ID },
        userId,
      );

      const createCall = tx.packingSession.create.mock.calls[0][0];
      expect(createCall.data.bagsOutput).toEqual([{ bagTypeId, qty: 10, ratePerBag: '0.1200' }]);
      expect(createCall.data.sessionEarnings).toBe('1.20');
    });

    // =========================================================================
    // Worker-attribution integrity — a packing session must always be
    // attributable to a real payroll Worker at creation time. Fixes the
    // orphaned-session bug (workerId set, workerEntityId NULL) found by the
    // cross-page P&L audit: sessionEarnings entered Labor Cost but could never
    // be reconciled against any worker-facing total (Employee wages owed,
    // Worker Earnings tab, Dashboard's worker card).
    // =========================================================================

    it('Integrity 1: valid workerEntityId → session created and persisted with that worker attributed', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';
      const sessionId = 'session-uuid-integrity-1';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.worker.findUnique.mockResolvedValue({ id: VALID_WORKER_ID, name: 'Ahmed' });
      mockPrisma.bagType.findMany.mockResolvedValue([{
        id: bagTypeId, nominalKg: { toString: () => '10.000' }, workerRate: { toString: () => '1.000' },
      }]);
      mockPrisma.packingSession.findUnique.mockResolvedValue({ id: sessionId, sessionLots: [] });

      const tx = makeTx();
      tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: { toString: () => '100.000' }, costPerKg: { toString: () => '2.000' } }]);
      tx.stockLot.update.mockResolvedValue({});
      tx.packingSession.create.mockResolvedValue({ id: sessionId });
      tx.packingSessionLot.createMany.mockResolvedValue({ count: 1 });
      tx.packedStock.createMany.mockResolvedValue({ count: 1 });
      setupTransaction(tx);

      await service.createPackingSession(
        { lotInputs: [{ lotId, kg: '50.000' }], bagsOutput: [{ bagTypeId, qty: 5 }], workerEntityId: VALID_WORKER_ID },
        userId,
      );

      expect(mockPrisma.worker.findUnique).toHaveBeenCalledWith({ where: { id: VALID_WORKER_ID } });
      const createCall = tx.packingSession.create.mock.calls[0][0];
      expect(createCall.data.workerEntityId).toBe(VALID_WORKER_ID);
    });

    it('Integrity 2: missing workerEntityId → rejected with WORKER_REQUIRED, no writes performed', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      const tx = makeTx();
      setupTransaction(tx);

      let caught: any;
      try {
        await service.createPackingSession(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { lotInputs: [{ lotId, kg: '50.000' }], bagsOutput: [{ bagTypeId, qty: 5 }] } as any,
          userId,
        );
      } catch (e) { caught = e; }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.response.code).toBe('WORKER_REQUIRED');
      // Fails before ever touching BagType/StockLot/the transaction — pure pre-tx guard.
      expect(mockPrisma.bagType.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('Integrity 3: workerEntityId referencing a non-existent Worker → rejected with WORKER_NOT_FOUND, no writes performed', async () => {
      const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
      const lotId     = '550e8400-e29b-41d4-a716-446655440000';
      const userId    = 'clerk-user-1';
      const bogusWorkerId = '550e8400-e29b-41d4-a716-000000000000';

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId: userId });
      mockPrisma.worker.findUnique.mockResolvedValue(null); // no such Worker row
      const tx = makeTx();
      setupTransaction(tx);

      let caught: any;
      try {
        await service.createPackingSession(
          { lotInputs: [{ lotId, kg: '50.000' }], bagsOutput: [{ bagTypeId, qty: 5 }], workerEntityId: bogusWorkerId },
          userId,
        );
      } catch (e) { caught = e; }

      expect(caught).toBeInstanceOf(NotFoundException);
      expect(caught.response.code).toBe('WORKER_NOT_FOUND');
      expect(mockPrisma.worker.findUnique).toHaveBeenCalledWith({ where: { id: bogusWorkerId } });
      expect(mockPrisma.bagType.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('updatePackingSession()', () => {
    const bagType10kg = '550e8400-e29b-41d4-a716-446655440101';
    const bagType5kg  = '550e8400-e29b-41d4-a716-446655440102';
    const lotId       = '550e8400-e29b-41d4-a716-446655440103';
    const userId      = 'clerk-user-1';
    // Ownership check (added alongside the IDOR fix) only restricts role 'worker' —
    // these tests exercise update() business logic, not the ownership guard itself
    // (see the dedicated 'ownership guard' describe block below), so an 'owner'
    // caller (which always bypasses the check) preserves their original intent.
    const ownerCaller: ClerkUser = { userId, role: 'owner' };
    const sessionId   = 'session-uuid-update';

    // A single-bag-type existing session: 10 bags @ historical rate 0.10 = sessionEarnings 1.00.
    // sessionLots/kgOutputTotal are sized to net a zero variance so tests don't need to reason
    // about the (unrelated) negative-variance-requires-note guard.
    function existingSession(overrides: Record<string, unknown> = {}) {
      return {
        id: sessionId,
        date: new Date('2024-01-15'),
        bagsOutput: [{ bagTypeId: bagType10kg, qty: 10, ratePerBag: '0.1000' }],
        sessionEarnings: { toString: () => '1.00' },
        varianceNote: null,
        notes: null,
        workerEntityId: null,
        sessionLots: [{ lotId, kgUsed: { toString: () => '100.000' } }],
        packedStocks: [],
        ...overrides,
      };
    }

    // CURRENT BagType.workerRate is 0.20 — deliberately different from the 0.10 snapshotted
    // on the existing session, simulating "the rate changed after the session was created".
    function setupTx(existing: ReturnType<typeof existingSession>) {
      const tx = makeTx();
      // Default caller for update() 's unconditional user-resolution (needed for both
      // the ownership check and as the createdById on a freshly-created WasteEntry).
      // The two ownership-guard tests below override this themselves after calling
      // setupTx(), same as they already did before this default existed.
      tx.user.findUnique.mockResolvedValue({ id: 'db-caller-default', clerkId: userId });
      tx.packingSession.findUnique.mockResolvedValue(existing);
      tx.stockExit.count.mockResolvedValue(0);
      tx.stockAdjustment.count.mockResolvedValue(0);
      tx.shipmentReservation.count.mockResolvedValue(0);
      tx.stockLot.update.mockResolvedValue({});
      tx.stockLot.findMany.mockResolvedValue([
        { id: lotId, kgRemaining: { toString: () => '1000.000' }, costPerKg: { toString: () => '0.300' } },
      ]);
      tx.bagType.findMany.mockResolvedValue([
        { id: bagType10kg, nominalKg: { toString: () => '10.000' }, workerRate: { toString: () => '0.2000' } },
        { id: bagType5kg,  nominalKg: { toString: () => '5.000' },  workerRate: { toString: () => '0.3000' } },
      ]);
      tx.packingSession.update.mockResolvedValue({});
      tx.packingSessionLot.deleteMany.mockResolvedValue({ count: 1 });
      tx.packingSessionLot.createMany.mockResolvedValue({ count: 1 });
      tx.packedStock.deleteMany.mockResolvedValue({ count: 1 });
      tx.packedStock.createMany.mockResolvedValue({ count: 1 });
      setupTransaction(tx);
      return tx;
    }

    it('preserves sessionEarnings when only varianceNote is edited — reproduces and fixes the reported bug', async () => {
      const tx = setupTx(existingSession());

      await service.updatePackingSession(sessionId, { varianceNote: 'unrelated edit' }, ownerCaller);

      const data = tx.packingSession.update.mock.calls[0][0].data;
      expect(data.sessionEarnings).toBe('1.00'); // NOT 2.00 — current rate (0.20) must not apply
      expect(data.bagsOutput).toEqual([{ bagTypeId: bagType10kg, qty: 10, ratePerBag: '0.1000' }]);
    });

    it('preserves sessionEarnings when only notes is edited', async () => {
      const tx = setupTx(existingSession());

      await service.updatePackingSession(sessionId, { notes: 'unrelated note' }, ownerCaller);

      expect(tx.packingSession.update.mock.calls[0][0].data.sessionEarnings).toBe('1.00');
    });

    it('preserves sessionEarnings when only workerEntityId is edited', async () => {
      const tx = setupTx(existingSession());

      await service.updatePackingSession(sessionId, { workerEntityId: 'worker-2' }, ownerCaller);

      const data = tx.packingSession.update.mock.calls[0][0].data;
      expect(data.sessionEarnings).toBe('1.00');
      expect(data.workerEntityId).toBe('worker-2');
      // Existence validated even on update, whenever a non-empty value is being set.
      expect(tx.worker.findUnique).toHaveBeenCalledWith({ where: { id: 'worker-2' } });
    });

    // ── Worker-attribution integrity on UPDATE — deliberately NOT mandatory here
    // (unlike create): a legacy/historical session with workerEntityId=NULL must
    // remain fully editable, and editing unrelated fields must never silently
    // fabricate a worker attribution that was never explicitly provided. ──────────

    it('Integrity 4: a legacy session with workerEntityId=NULL remains fully editable — unrelated-field edit does not touch it', async () => {
      const tx = setupTx(existingSession({ workerEntityId: null }));

      await service.updatePackingSession(sessionId, { varianceNote: 'unrelated edit' }, ownerCaller);

      const data = tx.packingSession.update.mock.calls[0][0].data;
      expect(data.workerEntityId).toBeNull(); // never fabricated
      expect(data.sessionEarnings).toBe('1.00'); // update still succeeds normally
      // No existence check runs when no workerEntityId is being set at all.
      expect(tx.worker.findUnique).not.toHaveBeenCalled();
    });

    it('Integrity 5: update assigning a non-existent workerEntityId is rejected with WORKER_NOT_FOUND', async () => {
      const tx = setupTx(existingSession({ workerEntityId: null }));
      tx.worker.findUnique.mockResolvedValue(null); // no such Worker row

      let caught: any;
      try {
        await service.updatePackingSession(sessionId, { workerEntityId: 'bogus-worker-id' }, ownerCaller);
      } catch (e) { caught = e; }

      expect(caught).toBeInstanceOf(NotFoundException);
      expect(caught.response.code).toBe('WORKER_NOT_FOUND');
      // Rejected before the session row itself is written.
      expect(tx.packingSession.update).not.toHaveBeenCalled();
    });

    it('Integrity 6: explicitly clearing workerEntityId (empty string) on update remains a supported correction, no existence check runs', async () => {
      const tx = setupTx(existingSession({ workerEntityId: 'worker-1' }));

      await service.updatePackingSession(sessionId, { workerEntityId: '' }, ownerCaller);

      const data = tx.packingSession.update.mock.calls[0][0].data;
      expect(data.workerEntityId).toBeNull();
      expect(tx.worker.findUnique).not.toHaveBeenCalled();
    });

    it('multiple bag types: unrelated-field edit preserves the full historical total even though one bag type\'s rate changed', async () => {
      // 50×10kg @ historical 0.12 + 20×5kg @ historical 0.08 = 6.00 + 1.60 = 7.60.
      // Current (live) rates per setupTx are 0.20 / 0.30 — must NOT be used.
      const existing = existingSession({
        bagsOutput: [
          { bagTypeId: bagType10kg, qty: 50, ratePerBag: '0.1200' },
          { bagTypeId: bagType5kg,  qty: 20, ratePerBag: '0.0800' },
        ],
        sessionEarnings: { toString: () => '7.60' },
        sessionLots: [{ lotId, kgUsed: { toString: () => '600.000' } }], // 50×10 + 20×5 = 600 kg out
      });
      const tx = setupTx(existing);

      await service.updatePackingSession(sessionId, { notes: 'touch unrelated field' }, ownerCaller);

      expect(tx.packingSession.update.mock.calls[0][0].data.sessionEarnings).toBe('7.60');
    });

    it('explicit bagsOutput edit: existing line keeps its ORIGINAL rate for the FULL new quantity, even when qty changes', async () => {
      // Business decision: an edit to an existing line is a correction to the same day's
      // work, not new work — 60 bags (50 original + 10 more) at the ORIGINAL 0.10 = 6.00,
      // never the current live rate (0.20 × 60 = 12.00).
      const tx = setupTx(existingSession());

      await service.updatePackingSession(
        sessionId,
        { bagsOutput: [{ bagTypeId: bagType10kg, qty: 60 }], lotInputs: [{ lotId, kg: '600.000' }] },
        ownerCaller,
      );

      const data = tx.packingSession.update.mock.calls[0][0].data;
      expect(data.bagsOutput).toEqual([{ bagTypeId: bagType10kg, qty: 60, ratePerBag: '0.1000' }]);
      expect(data.sessionEarnings).toBe('6.00');
    });

    it('explicit bagsOutput edit: a brand-new bag-type line (no prior snapshot on this session) is priced at the CURRENT rate', async () => {
      const tx = setupTx(existingSession());

      await service.updatePackingSession(
        sessionId,
        {
          bagsOutput: [{ bagTypeId: bagType10kg, qty: 10 }, { bagTypeId: bagType5kg, qty: 4 }],
          lotInputs: [{ lotId, kg: '120.000' }], // 10×10kg + 4×5kg = 120 kg out
        },
        ownerCaller,
      );

      const data = tx.packingSession.update.mock.calls[0][0].data;
      // bagType10kg keeps its 0.10 snapshot; bagType5kg is new to this session → current rate 0.30
      expect(data.bagsOutput).toEqual(expect.arrayContaining([
        { bagTypeId: bagType10kg, qty: 10, ratePerBag: '0.1000' },
        { bagTypeId: bagType5kg, qty: 4, ratePerBag: '0.3000' },
      ]));
      expect(data.sessionEarnings).toBe('2.20'); // 10×0.10 + 4×0.30 = 1.00 + 1.20
    });

    it('explicit bagsOutput edit on a legacy session (existing line has no ratePerBag) falls back to the CURRENT rate for that line', async () => {
      const legacyExisting = existingSession({
        bagsOutput: [{ bagTypeId: bagType10kg, qty: 10 }], // no ratePerBag — pre-migration shape
      });
      const tx = setupTx(legacyExisting);

      await service.updatePackingSession(
        sessionId,
        { bagsOutput: [{ bagTypeId: bagType10kg, qty: 10 }] },
        ownerCaller,
      );

      const data = tx.packingSession.update.mock.calls[0][0].data;
      expect(data.bagsOutput).toEqual([{ bagTypeId: bagType10kg, qty: 10, ratePerBag: '0.2000' }]);
      expect(data.sessionEarnings).toBe('2.00');
    });

    it('a legacy session with no bagsOutput edit at all keeps its stored sessionEarnings untouched, unchanged shape included', async () => {
      const legacyExisting = existingSession({
        bagsOutput: [{ bagTypeId: bagType10kg, qty: 10 }], // legacy shape, no ratePerBag
      });
      const tx = setupTx(legacyExisting);

      await service.updatePackingSession(sessionId, { notes: 'unrelated' }, ownerCaller);

      const data = tx.packingSession.update.mock.calls[0][0].data;
      expect(data.sessionEarnings).toBe('1.00');
      expect(data.bagsOutput).toEqual([{ bagTypeId: bagType10kg, qty: 10 }]); // untouched, not backfilled
    });

    // =========================================================================
    // IDOR regression: PATCH /packing-sessions/:id is @Roles('owner', 'worker').
    // Without an ownership check, any authenticated worker could edit another
    // worker's session — reversing/reapplying its lot deductions, packed stock,
    // and earnings. Mirrors the same check findOne() already has.
    // =========================================================================

    // =========================================================================
    // Regression: ShipmentReservation.packedStockId has no ON DELETE cascade
    // (schema.prisma) — without this check, editing a session whose output
    // bags are currently reserved for a pending shipment would fall through to
    // packedStock.deleteMany() and hit a raw P2003 foreign-key violation
    // instead of this same clean EDIT_BLOCKED response the exit/adjustment
    // checks already give.
    // =========================================================================

    it('EDIT_BLOCKED: rejects the update when this session\'s packed stock has a pending shipment reservation, and mutates no stock', async () => {
      const tx = setupTx(existingSession({ packedStocks: [{ id: 'ps-reserved-1' }] }));
      tx.shipmentReservation.count.mockResolvedValue(1);

      await expect(
        service.updatePackingSession(sessionId, { notes: 'trying to edit a reserved session' }, ownerCaller),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'EDIT_BLOCKED' }),
      });
      expect(tx.shipmentReservation.count).toHaveBeenCalledWith({ where: { packedStockId: { in: ['ps-reserved-1'] } } });
      expect(tx.stockLot.update).not.toHaveBeenCalled();
      expect(tx.packingSession.update).not.toHaveBeenCalled();
      expect(tx.packedStock.deleteMany).not.toHaveBeenCalled();
    });

    it('ownership guard: throws ForbiddenException(FORBIDDEN) when a worker updates another worker\'s session, and never writes', async () => {
      const tx = setupTx(existingSession({ workerId: 'db-worker-owner-of-session' }));
      tx.user.findUnique.mockResolvedValue({ id: 'db-worker-caller', clerkId: 'clerk-worker-caller' });

      const workerCaller: ClerkUser = { userId: 'clerk-worker-caller', role: 'worker' };

      await expect(
        service.updatePackingSession(sessionId, { notes: 'trying to edit someone else\'s session' }, workerCaller),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'FORBIDDEN' }),
      });
      expect(tx.packingSession.update).not.toHaveBeenCalled();
      expect(tx.stockLot.update).not.toHaveBeenCalled();
    });

    it('ownership guard: a worker CAN update their own session', async () => {
      const tx = setupTx(existingSession({ workerId: 'db-worker-self' }));
      tx.user.findUnique.mockResolvedValue({ id: 'db-worker-self', clerkId: 'clerk-worker-self' });

      const workerCaller: ClerkUser = { userId: 'clerk-worker-self', role: 'worker' };

      await service.updatePackingSession(sessionId, { notes: 'my own edit' }, workerCaller);

      expect(tx.packingSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: sessionId } }),
      );
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

  // =========================================================================
  // findOne() — Packing History detail view fix: previously unused/untested,
  // now the frontend's actual detail source (GET /packing-sessions/:id).
  // =========================================================================

  describe('findOne()', () => {
    function fullSession(overrides: Record<string, any> = {}) {
      return {
        id: 'session-1',
        workerId: 'db-owner-id',
        workerEntityId: 'worker-entity-1',
        mode: 'stock',
        orderId: null,
        kgConsumed: '520.000',
        bagsOutput: [{ bagTypeId: 'bag-1', qty: 50 }],
        kgOutputTotal: '500.000',
        varianceKg: '20.000',
        varianceNote: null,
        sessionEarnings: '6.00',
        date: new Date('2026-08-05'),
        startedAt: new Date('2026-08-05T11:52:50.958Z'),
        completedAt: new Date('2026-08-05T11:52:50.957Z'),
        notes: null,
        sessionLots: [
          { id: 'sl-1', sessionId: 'session-1', lotId: 'lot-1', kgUsed: '520.000',
            lot: { id: 'lot-1', charcoalType: 'BBQ hardwood', grade: 'A', costPerKg: '0.4500' } },
        ],
        worker: { id: 'db-owner-id', name: 'Test Owner', email: 'owner@charcoal.com' },
        workerEntity: { id: 'worker-entity-1', name: 'Omar Khalil' },
        packedStocks: [
          { id: 'ps-1', lotId: 'lot-1', bagTypeId: 'bag-1', quantity: 0,
            bagType: { id: 'bag-1', name: '10kg Bag', nominalKg: '10.000' } },
        ],
        ...overrides,
      };
    }

    it('returns the full detail shape — worker, workerEntity, sessionLots.lot, packedStocks.bagType', async () => {
      mockPrisma.packingSession.findUnique.mockResolvedValue(fullSession());

      const result = await service.findOne('session-1', { userId: 'clerk-owner-1', role: 'owner' } as any);

      expect(mockPrisma.packingSession.findUnique).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        include: {
          sessionLots: { include: { lot: true } },
          worker: true,
          workerEntity: true,
          packedStocks: { include: { bagType: true } },
        },
      });
      expect(result.worker.name).toBe('Test Owner');
      expect(result.workerEntity.name).toBe('Omar Khalil');
      expect(result.sessionLots[0].lot.charcoalType).toBe('BBQ hardwood');
      expect(result.sessionLots[0].lot.grade).toBe('A');
      expect(result.varianceKg).toBe('20.000');
      expect(result.packedStocks[0].bagType.name).toBe('10kg Bag');
    });

    it('Integrity 7: a legacy session with workerEntityId=NULL remains fully readable (not required to be attributed to view)', async () => {
      mockPrisma.packingSession.findUnique.mockResolvedValue(
        fullSession({ workerEntityId: null, workerEntity: null }),
      );

      const result = await service.findOne('session-1', { userId: 'clerk-owner-1', role: 'owner' } as any);

      expect(result.workerEntityId).toBeNull();
      expect(result.workerEntity).toBeNull();
      // Everything else on the session is still intact — a missing worker
      // attribution doesn't degrade any other field.
      expect(result.sessionEarnings).toBe('6.00');
      expect(result.worker.name).toBe('Test Owner');
    });

    it('multi-lot session: returns every source lot, never collapsed to one', async () => {
      mockPrisma.packingSession.findUnique.mockResolvedValue(fullSession({
        sessionLots: [
          { id: 'sl-1', sessionId: 'session-1', lotId: 'lot-A', kgUsed: '100.000',
            lot: { id: 'lot-A', charcoalType: 'BBQ hardwood', grade: 'A', costPerKg: '0.4500' } },
          { id: 'sl-2', sessionId: 'session-1', lotId: 'lot-B', kgUsed: '50.000',
            lot: { id: 'lot-B', charcoalType: 'Coconut', grade: 'B', costPerKg: '0.3800' } },
        ],
      }));

      const result = await service.findOne('session-1', { userId: 'clerk-owner-1', role: 'owner' } as any);

      expect(result.sessionLots).toHaveLength(2);
      expect(result.sessionLots.map((sl: any) => sl.lot.charcoalType)).toEqual(['BBQ hardwood', 'Coconut']);
    });

    it('throws NotFoundException when the session does not exist', async () => {
      mockPrisma.packingSession.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne('missing-id', { userId: 'clerk-owner-1', role: 'owner' } as any),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NOT_FOUND' }) });
    });

    it('owner/accountant role: can view any session, no ownership check performed', async () => {
      mockPrisma.packingSession.findUnique.mockResolvedValue(fullSession({ workerId: 'someone-elses-db-id' }));

      await expect(
        service.findOne('session-1', { userId: 'clerk-owner-1', role: 'owner' } as any),
      ).resolves.toBeDefined();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('worker role: can view their own session', async () => {
      mockPrisma.packingSession.findUnique.mockResolvedValue(fullSession({ workerId: 'db-worker-id-1' }));
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-worker-id-1', clerkId: 'clerk-worker-1' });

      await expect(
        service.findOne('session-1', { userId: 'clerk-worker-1', role: 'worker' } as any),
      ).resolves.toBeDefined();
    });

    it('worker role: FORBIDDEN when the session belongs to a different worker', async () => {
      mockPrisma.packingSession.findUnique.mockResolvedValue(fullSession({ workerId: 'someone-elses-db-id' }));
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-worker-id-1', clerkId: 'clerk-worker-1' });

      await expect(
        service.findOne('session-1', { userId: 'clerk-worker-1', role: 'worker' } as any),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FORBIDDEN' }) });
    });
  });
});
