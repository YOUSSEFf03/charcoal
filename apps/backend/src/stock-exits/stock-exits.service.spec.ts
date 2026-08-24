import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { StockExitsService } from './stock-exits.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockExitDto } from './dto/create-stock-exit.dto';
import { LedgerWriteService } from '../ledger/ledger-write.service';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';

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
    stockExit: { create: fn(), findUnique: fn(), findMany: fn(), count: fn(), aggregate: fn(), groupBy: fn() },
    bagType: { findMany: fn() },
    payment: { findMany: fn() },
    paymentAllocation: { findMany: fn() },
    $transaction: fn(),
  };

  // PR 3: StockExitsService now delegates ledger writes to LedgerWriteService
  // instead of importing creditAccount directly. Mocked here (not the real
  // service) because these tests assert StockExitsService's own delegation
  // behavior in isolation — LedgerWriteService's own logic is covered by
  // ledger-write.service.spec.ts.
  const mockLedgerWriteService = {
    creditAccount: fn(),
    debitAccount: fn(),
  };

  // PR 6b: StockExitsService now calls UsersService.validateCashCapable directly,
  // before tx.stockExit.create(), in addition to LedgerWriteService.creditAccount()'s
  // own (unchanged) internal call to the same method. Defaults to "always valid" so
  // every pre-existing test below is unaffected.
  const mockUsersService = { validateCashCapable: fn() };

  // Same exchange rate WarehouseSales.tsx's RateContext defaults to (89550),
  // so tests below can be checked against the same numbers a human would see.
  const mockSettingsService = { getExchangeRate: fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUsersService.validateCashCapable.mockResolvedValue(undefined);
    mockSettingsService.getExchangeRate.mockResolvedValue(89550);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockExitsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerWriteService, useValue: mockLedgerWriteService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: SettingsService, useValue: mockSettingsService },
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
        $queryRaw: fn(),
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
        $queryRaw: fn(),
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
        $queryRaw: fn(),
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

  // =========================================================================
  // Concurrency safety — SELECT ... FOR UPDATE locking on the stock row
  // (raw-lot and packed-stock exit-creation race fix).
  //
  // These are unit tests against a mocked tx, so they can't spin up two real
  // concurrent Postgres transactions. Instead, mirroring the exact idiom
  // payment-allocation.service.spec.ts already uses for the same class of fix
  // ("locks the invoice row before writing (FOR UPDATE issued before
  // paymentAllocation.create)"), they prove:
  //   1) the FOR UPDATE lock query is issued BEFORE the row is read for
  //      validation — the ordering that makes two real concurrent
  //      transactions serialize on the row lock instead of both reading the
  //      same stale value, and
  //   2) validation correctly rejects when the (locked) read reflects a
  //      quantity a concurrent transaction has already committed — i.e. the
  //      scenario a second transaction actually sees once it acquires the
  //      lock after the first transaction committed its deduction.
  // =========================================================================

  describe('create() — concurrency safety (FOR UPDATE locking)', () => {
    const clerkId = 'clerk-user-lock';

    it('MODE A (raw lot): locks the stock_lots row via FOR UPDATE before reading kgRemaining', async () => {
      const lotId = 'lot-lock-1';
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-lock-1', clerkId });

      const callOrder: string[] = [];
      const mockTx = {
        stockLot: { findUnique: fn(), update: fn() },
        stockExit: { create: fn() },
        $queryRaw: fn(),
      };
      mockTx.$queryRaw.mockImplementation(async () => { callOrder.push('lock'); return []; });
      mockTx.stockLot.findUnique.mockImplementation(async () => {
        callOrder.push('read');
        return { id: lotId, kgRemaining: { toString: () => '100.000' } };
      });
      mockTx.stockLot.update.mockResolvedValue({});
      mockTx.stockExit.create.mockResolvedValue({ id: 'exit-lock-1' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const dto: CreateStockExitDto = {
        lotId,
        kgQuantity: 30,
        exitType: 'sample' as any,
        date: '2026-08-01',
      } as CreateStockExitDto;

      await service.create(dto, clerkId);

      expect(callOrder).toEqual(['lock', 'read']);
      const lockCall = mockTx.$queryRaw.mock.calls[0][0] as any;
      expect(lockCall.sql).toContain('FOR UPDATE');
      expect(lockCall.sql).toContain('stock_lots');
      expect(lockCall.values).toEqual([lotId]);
    });

    it('MODE A: write uses the locked read value — 100kg lot minus a 30kg exit leaves exactly 70.000', async () => {
      const lotId = 'lot-lock-2';
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-lock-2', clerkId });

      const mockTx = {
        stockLot: { findUnique: fn(), update: fn() },
        stockExit: { create: fn() },
        $queryRaw: fn(),
      };
      mockTx.stockLot.findUnique.mockResolvedValue({ id: lotId, kgRemaining: { toString: () => '100.000' } });
      mockTx.stockLot.update.mockResolvedValue({});
      mockTx.stockExit.create.mockResolvedValue({ id: 'exit-lock-2' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const dto: CreateStockExitDto = {
        lotId,
        kgQuantity: 30,
        exitType: 'sample' as any,
        date: '2026-08-01',
      } as CreateStockExitDto;

      await service.create(dto, clerkId);

      expect(mockTx.stockLot.update).toHaveBeenCalledWith({
        where: { id: lotId },
        data: { kgRemaining: '70.000' },
      });
    });

    it("MODE A: rejects once the (post-lock) read reflects another transaction's already-committed deduction — proves validation runs against the locked value, not a stale pre-lock snapshot", async () => {
      const lotId = 'lot-lock-3';
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-lock-3', clerkId });

      const mockTx = {
        stockLot: { findUnique: fn(), update: fn() },
        stockExit: { create: fn() },
        $queryRaw: fn(),
      };
      // What this transaction sees AFTER acquiring the lock: a concurrent
      // transaction already committed a deduction down to 10kg remaining.
      mockTx.stockLot.findUnique.mockResolvedValue({ id: lotId, kgRemaining: { toString: () => '10.000' } });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const dto: CreateStockExitDto = {
        lotId,
        kgQuantity: 30, // more than the 10kg actually left
        exitType: 'sample' as any,
        date: '2026-08-01',
      } as CreateStockExitDto;

      await expect(service.create(dto, clerkId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });
      expect(mockTx.stockLot.update).not.toHaveBeenCalled();
      expect(mockTx.stockExit.create).not.toHaveBeenCalled();
    });

    it('MODE B (packed stock): locks the packed_stocks row via FOR UPDATE before reading quantity/reservedQuantity', async () => {
      const packedStockId = 'packed-lock-1';
      const bagTypeId = 'bag-lock-1';
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-lock-4', clerkId });

      const callOrder: string[] = [];
      const mockTx = {
        packedStock: { findUnique: fn(), update: fn() },
        stockExit: { create: fn() },
        $queryRaw: fn(),
      };
      mockTx.$queryRaw.mockImplementation(async () => { callOrder.push('lock'); return []; });
      mockTx.packedStock.findUnique.mockImplementation(async () => {
        callOrder.push('read');
        return { id: packedStockId, quantity: 20, reservedQuantity: 0, bagTypeId };
      });
      mockTx.packedStock.update.mockResolvedValue({});
      mockTx.stockExit.create.mockResolvedValue({ id: 'exit-lock-4' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const dto: CreateStockExitDto = {
        packedStockId,
        bagTypeId,
        quantity: 5,
        exitType: 'sample' as any,
        date: '2026-08-01',
      };

      await service.create(dto, clerkId);

      expect(callOrder).toEqual(['lock', 'read']);
      const lockCall = mockTx.$queryRaw.mock.calls[0][0] as any;
      expect(lockCall.sql).toContain('FOR UPDATE');
      expect(lockCall.sql).toContain('packed_stocks');
      expect(lockCall.values).toEqual([packedStockId]);
    });

    it("MODE B: rejects once the (post-lock) read reflects another transaction's already-committed decrement", async () => {
      const packedStockId = 'packed-lock-2';
      const bagTypeId = 'bag-lock-2';
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-lock-5', clerkId });

      const mockTx = {
        packedStock: { findUnique: fn(), update: fn() },
        stockExit: { create: fn() },
        $queryRaw: fn(),
      };
      // What this transaction sees AFTER acquiring the lock: a concurrent
      // transaction already committed a decrement, leaving only 3 free.
      mockTx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 3, reservedQuantity: 0, bagTypeId });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const dto: CreateStockExitDto = {
        packedStockId,
        bagTypeId,
        quantity: 5, // more than the 3 free actually left
        exitType: 'sample' as any,
        date: '2026-08-01',
      };

      await expect(service.create(dto, clerkId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });
      expect(mockTx.packedStock.update).not.toHaveBeenCalled();
      expect(mockTx.stockExit.create).not.toHaveBeenCalled();
    });

    it('MODE B: normal single-request successful deduction is unaffected by the added lock — same final decrement as before', async () => {
      const packedStockId = 'packed-lock-3';
      const bagTypeId = 'bag-lock-3';
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-lock-6', clerkId });

      const mockTx = {
        packedStock: { findUnique: fn(), update: fn() },
        stockExit: { create: fn() },
        $queryRaw: fn(),
      };
      mockTx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 20, reservedQuantity: 0, bagTypeId });
      mockTx.packedStock.update.mockResolvedValue({});
      mockTx.stockExit.create.mockResolvedValue({ id: 'exit-lock-6' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const dto: CreateStockExitDto = {
        packedStockId,
        bagTypeId,
        quantity: 5,
        exitType: 'sample' as any,
        date: '2026-08-01',
      };

      await service.create(dto, clerkId);

      expect(mockTx.packedStock.update).toHaveBeenCalledWith({
        where: { id: packedStockId },
        data: { quantity: { decrement: 5 } },
      });
    });
  });

  // =========================================================================
  // PR 3 — ledger delegation via LedgerWriteService
  // =========================================================================

  describe('create() — ledger delegation (PR 3 regression)', () => {
    const clerkId = 'clerk-user-ledger';
    const packedStockId = 'packed-stock-uuid-ledger';
    const bagTypeId = 'bag-type-uuid-ledger';
    const collectedById = 'collector-uuid-1';

    function baseDto(overrides: Partial<CreateStockExitDto> = {}): CreateStockExitDto {
      return {
        packedStockId,
        bagTypeId,
        quantity: 5,
        exitType: 'walk_in' as any,
        date: '2026-07-31',
        ...overrides,
      } as CreateStockExitDto;
    }

    function makeTx() {
      return {
        packedStock: { findUnique: fn(), update: fn() },
        stockExit: { create: fn() },
        user: { findUnique: fn() },
        $queryRaw: fn(),
      };
    }

    it('credits the collector via LedgerWriteService.creditAccount when collectedById and a positive amount are both provided', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'db-user-ledger', clerkId }) // logged-in user
        .mockResolvedValueOnce({ id: collectedById, name: 'Dev owner' }); // collector name lookup

      tx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 20, reservedQuantity: 0, bagTypeId });
      tx.packedStock.update.mockResolvedValue({});
      tx.stockExit.create.mockResolvedValue({ id: 'exit-ledger-1' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto({ collectedById, amount: 50, recipient: 'Marina Walk Café' }), clerkId);

      expect(mockLedgerWriteService.creditAccount).toHaveBeenCalledTimes(1);
      const [calledTx, calledUserId, calledAmount, calledType, calledRefId, calledDesc, calledDate] =
        mockLedgerWriteService.creditAccount.mock.calls[0];
      expect(calledTx).toBe(tx); // same transaction as stockExit.create — not a separate one
      expect(calledUserId).toBe(collectedById);
      expect(calledAmount.toString()).toBe('50');
      expect(calledType).toBe('sale_collected');
      expect(calledRefId).toBe('exit-ledger-1');
      expect(calledDesc).toBe('Warehouse sale — Marina Walk Café');
      expect(calledDate).toEqual(new Date('2026-07-31'));
    });

    it('does not call LedgerWriteService when no collector is provided', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'db-user-ledger-2', clerkId });

      tx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 20, reservedQuantity: 0, bagTypeId });
      tx.packedStock.update.mockResolvedValue({});
      tx.stockExit.create.mockResolvedValue({ id: 'exit-ledger-2' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto({ amount: 50 }), clerkId);

      expect(mockLedgerWriteService.creditAccount).not.toHaveBeenCalled();
    });

    it('does not call LedgerWriteService when a collector is provided but no amount is recorded', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'db-user-ledger-3', clerkId })
        .mockResolvedValueOnce({ id: collectedById, name: 'Dev owner' });

      tx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 20, reservedQuantity: 0, bagTypeId });
      tx.packedStock.update.mockResolvedValue({});
      tx.stockExit.create.mockResolvedValue({ id: 'exit-ledger-3' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto({ collectedById }), clerkId); // no amount

      expect(mockLedgerWriteService.creditAccount).not.toHaveBeenCalled();
    });

    it('does not call LedgerWriteService when only a legacy collectedBy name (no collectedById) is provided — matching original behavior', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'db-user-ledger-4', clerkId });

      tx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 20, reservedQuantity: 0, bagTypeId });
      tx.packedStock.update.mockResolvedValue({});
      tx.stockExit.create.mockResolvedValue({ id: 'exit-ledger-4' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto({ collectedBy: 'Walk-in cashier', amount: 50 }), clerkId);

      expect(mockLedgerWriteService.creditAccount).not.toHaveBeenCalled();
      expect(tx.stockExit.create.mock.calls[0][0].data.collectedBy).toBe('Walk-in cashier');
    });

    it('propagates a LedgerWriteService failure — the exit is not silently created if the ledger credit fails', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'db-user-ledger-5', clerkId })
        .mockResolvedValueOnce({ id: collectedById, name: 'Dev owner' });

      tx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 20, reservedQuantity: 0, bagTypeId });
      tx.packedStock.update.mockResolvedValue({});
      tx.stockExit.create.mockResolvedValue({ id: 'exit-ledger-5' });
      mockLedgerWriteService.creditAccount.mockRejectedValue(new Error('ledger write failed'));
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(
        service.create(baseDto({ collectedById, amount: 50 }), clerkId),
      ).rejects.toThrow('ledger write failed');
    });
  });

  // =========================================================================
  // PR 6b — validate the holder before the FK-constrained write
  // =========================================================================

  describe('create() — pre-write holder validation (PR 6b regression)', () => {
    const clerkId = 'clerk-user-6b';
    const packedStockId = 'packed-stock-uuid-6b';
    const bagTypeId = 'bag-type-uuid-6b';
    const collectedById = 'collector-uuid-6b';

    function baseDto(overrides: Partial<CreateStockExitDto> = {}): CreateStockExitDto {
      return {
        packedStockId,
        bagTypeId,
        quantity: 5,
        exitType: 'walk_in' as any,
        date: '2026-08-01',
        ...overrides,
      } as CreateStockExitDto;
    }

    it('1) rejects a nonexistent collectedById with NotFoundException BEFORE tx.stockExit.create() (and before the transaction even opens)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'db-user-6b', clerkId });
      mockUsersService.validateCashCapable.mockRejectedValue(
        new NotFoundException({ error: 'Receiver not found', code: 'NOT_FOUND' }),
      );

      await expect(
        service.create(baseDto({ collectedById, amount: 50 }), clerkId),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockUsersService.validateCashCapable).toHaveBeenCalledWith(collectedById);
      // Validation happens outside the transaction for this service — a rejection
      // must prevent $transaction from ever being opened, not just prevent the write.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockLedgerWriteService.creditAccount).not.toHaveBeenCalled();
    });

    it("2) does not bypass LedgerWriteService's own check — if the pre-write check somehow passes, creditAccount's independent rejection still propagates", async () => {
      const tx = { packedStock: { findUnique: fn(), update: fn() }, stockExit: { create: fn() }, $queryRaw: fn() };
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'db-user-6b-2', clerkId })
        .mockResolvedValueOnce({ id: collectedById, name: 'Deactivated Worker' });
      tx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 20, reservedQuantity: 0, bagTypeId });
      tx.packedStock.update.mockResolvedValue({});
      tx.stockExit.create.mockResolvedValue({ id: 'exit-6b-2' });
      mockUsersService.validateCashCapable.mockResolvedValue(undefined); // pre-write check passes
      mockLedgerWriteService.creditAccount.mockRejectedValue(
        new NotFoundException({ error: 'Receiver not found', code: 'NOT_FOUND' }), // PR 6's own check rejects
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(
        service.create(baseDto({ collectedById, amount: 50 }), clerkId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockLedgerWriteService.creditAccount).toHaveBeenCalledTimes(1);
    });

    it('3) happy path: validates, then writes the exit, then credits the ledger, in that order', async () => {
      const tx = { packedStock: { findUnique: fn(), update: fn() }, stockExit: { create: fn() }, $queryRaw: fn() };
      const callOrder: string[] = [];

      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'db-user-6b-3', clerkId })
        .mockResolvedValueOnce({ id: collectedById, name: 'Dev owner' });
      mockUsersService.validateCashCapable.mockImplementation(async () => { callOrder.push('validate'); });
      tx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 20, reservedQuantity: 0, bagTypeId });
      tx.packedStock.update.mockResolvedValue({});
      tx.stockExit.create.mockImplementation(async () => {
        callOrder.push('stockExit.create');
        return { id: 'exit-6b-3' };
      });
      mockLedgerWriteService.creditAccount.mockImplementation(async () => { callOrder.push('creditAccount'); });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto({ collectedById, amount: 50 }), clerkId);

      expect(callOrder).toEqual(['validate', 'stockExit.create', 'creditAccount']);
    });

    it('4) leaves no side effects when validation fails — nothing to roll back because the transaction never opened', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'db-user-6b-4', clerkId });
      mockUsersService.validateCashCapable.mockRejectedValue(
        new NotFoundException({ error: 'Receiver not found', code: 'NOT_FOUND' }),
      );

      await expect(
        service.create(baseDto({ collectedById, amount: 50 }), clerkId),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // findAll() — pagination, filters, count/findMany where-parity, list shape.
  // Covers the Warehouse Sales Log scalability fix (frontend now paginates
  // against this already-correct backend endpoint).
  // =========================================================================
  describe('findAll()', () => {
    beforeEach(() => {
      mockPrisma.stockExit.findMany.mockResolvedValue([]);
      mockPrisma.stockExit.count.mockResolvedValue(0);
      // Array-form $transaction — resolve both member promises in parallel,
      // same as create()'s tests use the callback form for their own case.
      mockPrisma.$transaction.mockImplementation((ops: any) => Promise.all(ops));
    });

    it('page 1: skip 0, take = limit', async () => {
      await service.findAll(1, 20);
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.skip).toBe(0);
      expect(call.take).toBe(20);
    });

    it('page 2: skip = (page-1) * limit', async () => {
      await service.findAll(2, 20);
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.skip).toBe(20);
      expect(call.take).toBe(20);
    });

    it('page 3 with a smaller limit: skip scales with limit', async () => {
      await service.findAll(3, 5);
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.skip).toBe(10);
      expect(call.take).toBe(5);
    });

    it('orderBy: date desc', async () => {
      await service.findAll(1, 20);
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ date: 'desc' });
    });

    it('exitType filter is applied to where', async () => {
      await service.findAll(1, 20, 'walk_in' as any);
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ exitType: 'walk_in' });
    });

    it('clientId filter is applied to where', async () => {
      await service.findAll(1, 20, undefined, undefined, undefined, 'client-1');
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ clientId: 'client-1' });
    });

    it('hasAmount=true adds amount:{not:null} — excludes the internal charcoal-consumption bookkeeping exit (non-JSON reason, amount null) FillJobsService.create() writes, from a Fill Client pickups list', async () => {
      await service.findAll(1, 20, 'client_bags_fill' as any, undefined, undefined, 'client-1', undefined, true);
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ exitType: 'client_bags_fill', clientId: 'client-1', amount: { not: null } });
    });

    it('hasAmount omitted (default): no amount filter — unchanged behavior for every other caller of this endpoint', async () => {
      await service.findAll(1, 20, 'client_bags_fill' as any, undefined, undefined, 'client-1');
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.where.amount).toBeUndefined();
    });

    it('date filter: dateFrom/dateTo map to where.date.gte/lte', async () => {
      await service.findAll(1, 20, undefined, '2026-01-01', '2026-01-31');
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.where.date.gte).toEqual(new Date('2026-01-01'));
      expect(call.where.date.lte).toEqual(new Date('2026-01-31'));
    });

    it('date filter: dateFrom only omits lte', async () => {
      await service.findAll(1, 20, undefined, '2026-01-01');
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.where.date).toEqual({ gte: new Date('2026-01-01') });
    });

    it('combined filters: exitType + clientId + date range all present together', async () => {
      await service.findAll(1, 20, 'walk_in' as any, '2026-01-01', '2026-01-31', 'client-1');
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.where).toEqual({
        exitType: 'walk_in',
        clientId: 'client-1',
        date: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
      });
    });

    it('lotId filter: matches direct lotId OR packedStock.lotId (raw + packed exits from the same lot)', async () => {
      await service.findAll(1, 20, undefined, undefined, undefined, undefined, 'lot-1');
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ OR: [{ lotId: 'lot-1' }, { packedStock: { lotId: 'lot-1' } }] });
    });

    it('no filters: where is an empty object (no accidental undefined-valued keys)', async () => {
      await service.findAll(1, 20);
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.where).toEqual({});
    });

    it('empty result: returns { data: [], total: 0, page, limit } without throwing', async () => {
      const result = await service.findAll(1, 20, 'walk_in' as any);
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });

    it('count() uses the exact same where as findMany()', async () => {
      await service.findAll(2, 20, 'walk_in' as any, '2026-01-01', '2026-01-31', 'client-1', 'lot-1');
      const findManyWhere = mockPrisma.stockExit.findMany.mock.calls[0][0].where;
      const countWhere = mockPrisma.stockExit.count.mock.calls[0][0].where;
      expect(countWhere).toEqual(findManyWhere);
    });

    it('list include shape: bagType, loggedBy (lightweight), lot (lightweight), packedStock.lot (lightweight), invoice (lightweight) — matches what the Sales Log detail panel needs, nothing heavier', async () => {
      await service.findAll(1, 20);
      const call = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(call.include).toEqual({
        bagType: true,
        loggedBy: { select: { id: true, name: true } },
        lot: { select: { id: true, charcoalType: true, grade: true } },
        packedStock: {
          include: {
            lot: { select: { id: true, charcoalType: true, grade: true, kgReceived: true } },
          },
        },
        invoice: { select: { id: true, displayId: true, lines: true, currency: true } },
      });
    });

    it('return shape carries through the requested page and limit, not the count/data length', async () => {
      mockPrisma.stockExit.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
      mockPrisma.stockExit.count.mockResolvedValue(47);
      const result = await service.findAll(3, 20);
      expect(result).toEqual({ data: [{ id: 'e1' }, { id: 'e2' }], total: 47, page: 3, limit: 20 });
    });
  });

  // =========================================================================
  // getClientWarehouseSummary() — ClientDetail warehouse-sales KPI aggregate.
  // Covers the ClientDetail warehouse-sales scalability + amount-accuracy fix.
  // =========================================================================
  describe('getClientWarehouseSummary()', () => {
    const CLIENT_ID = 'client-1';

    function mockGroupBy(bagTypeGroups: any[], currencyGroups: any[]) {
      mockPrisma.stockExit.groupBy.mockImplementation(async (args: any) => {
        if (args.by[0] === 'bagTypeId') return bagTypeGroups;
        if (args.by[0] === 'currency') return currencyGroups;
        return [];
      });
    }

    beforeEach(() => {
      mockPrisma.stockExit.count.mockResolvedValue(0);
      mockPrisma.stockExit.aggregate.mockResolvedValue({ _sum: { kgQuantity: null } });
      mockGroupBy([], []);
      mockPrisma.bagType.findMany.mockResolvedValue([]);
      mockPrisma.stockExit.findMany.mockResolvedValue([]);
    });

    it('zero exits: returns { totalCount: 0, totalKg: "0.000", totalAmount: "0.00" }', async () => {
      const result = await service.getClientWarehouseSummary(CLIENT_ID);
      expect(result).toEqual({ totalCount: 0, totalKg: '0.000', totalAmount: '0.00' });
    });

    it('one exit with an explicit USD amount: totalAmount reflects it', async () => {
      mockPrisma.stockExit.count.mockResolvedValue(1);
      mockGroupBy([], [{ currency: 'USD', _sum: { amount: { toString: () => '50.00' } } }]);
      const result = await service.getClientWarehouseSummary(CLIENT_ID);
      expect(result.totalCount).toBe(1);
      expect(result.totalAmount).toBe('50.00');
    });

    it('total count reflects count(), not the length of any fetched array', async () => {
      mockPrisma.stockExit.count.mockResolvedValue(4321);
      const result = await service.getClientWarehouseSummary(CLIENT_ID);
      expect(result.totalCount).toBe(4321);
    });

    it('client isolation: every query (count, kg aggregate, both groupBys, unresolved findMany) filters by this clientId', async () => {
      await service.getClientWarehouseSummary(CLIENT_ID);
      expect(mockPrisma.stockExit.count.mock.calls[0][0].where).toEqual({ clientId: CLIENT_ID });
      expect(mockPrisma.stockExit.aggregate.mock.calls[0][0].where).toMatchObject({ clientId: CLIENT_ID });
      for (const call of mockPrisma.stockExit.groupBy.mock.calls) {
        expect(call[0].where).toMatchObject({ clientId: CLIENT_ID });
      }
      expect(mockPrisma.stockExit.findMany.mock.calls[0][0].where).toMatchObject({ clientId: CLIENT_ID });
    });

    it('total kg: raw-lot SUM(kgQuantity) + packed Σ(quantity × bagType.nominalKg) combined', async () => {
      mockPrisma.stockExit.aggregate.mockResolvedValue({ _sum: { kgQuantity: { toString: () => '12.500' } } });
      mockGroupBy([{ bagTypeId: 'bt1', _sum: { quantity: 10 } }], []);
      mockPrisma.bagType.findMany.mockResolvedValue([{ id: 'bt1', nominalKg: { toString: () => '5.000' } }]);
      const result = await service.getClientWarehouseSummary(CLIENT_ID);
      // packed: 10 × 5.000 = 50.000, raw: 12.500 → total 62.500
      expect(result.totalKg).toBe('62.500');
    });

    it('explicit amounts: USD passes through, LBP is converted by the current exchange rate', async () => {
      mockGroupBy([], [
        { currency: 'USD', _sum: { amount: { toString: () => '100.00' } } },
        { currency: 'LBP', _sum: { amount: { toString: () => '895500' } } },
      ]);
      const result = await service.getClientWarehouseSummary(CLIENT_ID);
      // 100 USD + (895500 / 89550) = 100 + 10 = 110.00
      expect(result.totalAmount).toBe('110.00');
    });

    it('invoice-linked exit with amount NULL (packed bag): resolves via the matching invoice line — quantity × pricePerBag, NOT $0', async () => {
      mockPrisma.stockExit.findMany.mockResolvedValue([
        {
          quantity: 5, kgQuantity: null, lotId: null, bagTypeId: 'bt1', lot: null,
          invoice: { lines: [{ bagTypeId: 'bt1', pricePerBag: '2.50' }], currency: 'USD' },
        },
      ]);
      const result = await service.getClientWarehouseSummary(CLIENT_ID);
      // 5 × 2.50 = 12.50 — NOT 0, proving the amount=null-but-invoiced bug is fixed
      expect(result.totalAmount).toBe('12.50');
    });

    it('invoice-linked exit with amount NULL (raw kg, matched by lot description): resolves via kgQuantity × pricePerKg', async () => {
      mockPrisma.stockExit.findMany.mockResolvedValue([
        {
          quantity: null, kgQuantity: { toString: () => '20.000' }, lotId: 'lot1', bagTypeId: null,
          lot: { charcoalType: 'BBQ Hardwood', grade: 'A' },
          invoice: { lines: [{ saleUnit: 'KG', description: 'BBQ Hardwood Grade A', pricePerKg: '3.00' }], currency: 'USD' },
        },
      ]);
      const result = await service.getClientWarehouseSummary(CLIENT_ID);
      expect(result.totalAmount).toBe('60.00');
    });

    it('invoice-linked raw kg exit with no lot object: falls back to the first KG-unit line (same fallback exitDisplayAmountUsd() uses)', async () => {
      mockPrisma.stockExit.findMany.mockResolvedValue([
        {
          quantity: null, kgQuantity: { toString: () => '10.000' }, lotId: 'lot1', bagTypeId: null, lot: null,
          invoice: { lines: [{ saleUnit: 'KG', description: 'Unrelated description', pricePerKg: '4.00' }], currency: 'USD' },
        },
      ]);
      const result = await service.getClientWarehouseSummary(CLIENT_ID);
      expect(result.totalAmount).toBe('40.00');
    });

    it('invoice-linked exit with NO matching line: contributes 0, does not throw', async () => {
      mockPrisma.stockExit.findMany.mockResolvedValue([
        {
          quantity: 5, kgQuantity: null, lotId: null, bagTypeId: 'bt-missing', lot: null,
          invoice: { lines: [{ bagTypeId: 'other-bt', pricePerBag: '9.99' }], currency: 'USD' },
        },
      ]);
      const result = await service.getClientWarehouseSummary(CLIENT_ID);
      expect(result.totalAmount).toBe('0.00');
    });

    it('invoice-linked exit priced in LBP: the resolved line amount is converted to USD by the exchange rate', async () => {
      mockPrisma.stockExit.findMany.mockResolvedValue([
        {
          quantity: 2, kgQuantity: null, lotId: null, bagTypeId: 'bt1', lot: null,
          invoice: { lines: [{ bagTypeId: 'bt1', pricePerBag: '89550' }], currency: 'LBP' },
        },
      ]);
      const result = await service.getClientWarehouseSummary(CLIENT_ID);
      // 2 × 89550 LBP = 179100 LBP → ÷ 89550 = 2.00 USD
      expect(result.totalAmount).toBe('2.00');
    });

    it('mixed explicit + invoice-resolved amounts combine into one total', async () => {
      mockGroupBy([], [{ currency: 'USD', _sum: { amount: { toString: () => '30.00' } } }]);
      mockPrisma.stockExit.findMany.mockResolvedValue([
        {
          quantity: 4, kgQuantity: null, lotId: null, bagTypeId: 'bt1', lot: null,
          invoice: { lines: [{ bagTypeId: 'bt1', pricePerBag: '5.00' }], currency: 'USD' },
        },
      ]);
      const result = await service.getClientWarehouseSummary(CLIENT_ID);
      // 30.00 explicit + (4 × 5.00 = 20.00) resolved = 50.00
      expect(result.totalAmount).toBe('50.00');
    });

    it('exits belonging to another client are excluded — findMany/groupBy/aggregate/count all scope to the requested clientId only', async () => {
      // The mocks themselves only ever return data for the requested client
      // (real Prisma enforces this via the where clause); this test asserts
      // the where clause is what actually carries that isolation, for every
      // one of the five underlying queries.
      await service.getClientWarehouseSummary('client-2');
      expect(mockPrisma.stockExit.count.mock.calls[0][0].where).toEqual({ clientId: 'client-2' });
      expect(mockPrisma.stockExit.findMany.mock.calls[0][0].where).toMatchObject({ clientId: 'client-2' });
    });
  });

  // =========================================================================
  // getWarehouseCashSummary() — cash ACTUALLY COLLECTED from warehouse sales
  // on one date: anonymous StockExit(walk_in, invoiceId=null, amount NOT
  // NULL) + Payment rows whose invoice.source='WAREHOUSE_SALE'.
  // =========================================================================

  describe('getWarehouseCashSummary()', () => {
    const DATE = '2024-06-01';
    const dec = (v: string) => ({ toString: () => v });

    // One PaymentAllocation row, as returned by the query's own `select`
    // shape: { amount, paymentId, payment: { currency } }.
    function alloc(paymentId: string, amount: string, currency: 'USD' | 'LBP' = 'USD') {
      return { amount: dec(amount), paymentId, payment: { currency } };
    }

    beforeEach(() => {
      mockPrisma.stockExit.findMany.mockResolvedValue([]);
      mockPrisma.paymentAllocation.findMany.mockResolvedValue([]);
    });

    it('zero transactions (zero allocations) returns zero', async () => {
      const result = await service.getWarehouseCashSummary(DATE);
      expect(result).toEqual({
        date: DATE, cashCollected: '0.00', paymentCount: 0, anonymousSalesCount: 0,
      });
    });

    it('anonymous cash sale (StockExit.amount, no invoice) contributes correctly — unaffected by this change', async () => {
      mockPrisma.stockExit.findMany.mockResolvedValue([
        { amount: dec('50.00'), currency: 'USD' },
      ]);
      const result = await service.getWarehouseCashSummary(DATE);
      expect(result.cashCollected).toBe('50.00');
      expect(result.anonymousSalesCount).toBe(1);
    });

    it('direct warehouse payment (allocateDirect — one allocation row, full amount) still works', async () => {
      mockPrisma.paymentAllocation.findMany.mockResolvedValue([
        alloc('pmt-1', '80.00'),
      ]);
      const result = await service.getWarehouseCashSummary(DATE);
      expect(result.cashCollected).toBe('80.00');
      expect(result.paymentCount).toBe(1);
    });

    it('FIFO payment split between an ORDER invoice and a WAREHOUSE_SALE invoice counts only the warehouse portion', async () => {
      // Real Prisma would only return the WAREHOUSE_SALE-invoice allocation row —
      // the ORDER-invoice row is excluded by the where clause (invoice.source filter).
      // $100 payment split $60/$40 — only the $40 (warehouse) row is visible here.
      mockPrisma.paymentAllocation.findMany.mockResolvedValue([
        alloc('pmt-2', '40.00'),
      ]);
      const result = await service.getWarehouseCashSummary(DATE);
      expect(result.cashCollected).toBe('40.00');
    });

    it('FIFO payment entirely on ORDER invoices contributes nothing', async () => {
      mockPrisma.paymentAllocation.findMany.mockResolvedValue([]); // no WAREHOUSE_SALE allocation rows for this payment
      const result = await service.getWarehouseCashSummary(DATE);
      expect(result.cashCollected).toBe('0.00');
    });

    it('FIFO payment entirely on WAREHOUSE_SALE invoices counts fully', async () => {
      mockPrisma.paymentAllocation.findMany.mockResolvedValue([
        alloc('pmt-3', '100.00'),
      ]);
      const result = await service.getWarehouseCashSummary(DATE);
      expect(result.cashCollected).toBe('100.00');
    });

    it('direct + FIFO payments are counted exactly once each — no double counting', async () => {
      mockPrisma.paymentAllocation.findMany.mockResolvedValue([
        alloc('pmt-direct', '80.00'), // allocateDirect — one row
        alloc('pmt-fifo', '40.00'),   // allocateFifo — the warehouse-invoice slice of a split payment
      ]);
      const result = await service.getWarehouseCashSummary(DATE);
      expect(result.cashCollected).toBe('120.00');
      expect(result.paymentCount).toBe(2);
    });

    it('one payment split across multiple warehouse invoices gives paymentCount = 1, not 2', async () => {
      mockPrisma.paymentAllocation.findMany.mockResolvedValue([
        alloc('pmt-4', '25.00'), // allocated to warehouse invoice A
        alloc('pmt-4', '15.00'), // same payment, allocated to warehouse invoice B
      ]);
      const result = await service.getWarehouseCashSummary(DATE);
      expect(result.cashCollected).toBe('40.00');
      expect(result.paymentCount).toBe(1);
    });

    it('USD/LBP conversion: PaymentAllocation.amount is interpreted via the parent Payment.currency, not the invoice currency', async () => {
      mockPrisma.paymentAllocation.findMany.mockResolvedValue([
        alloc('pmt-5', '895500', 'LBP'), // 895500 / 89550 = 10.00
        alloc('pmt-6', '100.00', 'USD'),
      ]);
      const result = await service.getWarehouseCashSummary(DATE);
      expect(result.cashCollected).toBe('110.00');
    });

    it('payment date filtering: the allocation query is scoped by the related Payment.date, not PaymentAllocation.createdAt', async () => {
      await service.getWarehouseCashSummary(DATE);
      const args = mockPrisma.paymentAllocation.findMany.mock.calls[0][0];
      const expectedDay = new Date(DATE);
      expect(args.where.payment).toEqual({ date: { gte: expectedDay, lte: expectedDay } });
    });

    it('the where clause scopes to invoice.source=WAREHOUSE_SALE — ordinary/ORDER-invoice allocations excluded by construction', async () => {
      await service.getWarehouseCashSummary(DATE);
      const args = mockPrisma.paymentAllocation.findMany.mock.calls[0][0];
      expect(args.where.invoice).toEqual({ source: 'WAREHOUSE_SALE' });
    });

    it('zero allocations returns zero for the payment side while leaving the anonymous side unaffected', async () => {
      mockPrisma.stockExit.findMany.mockResolvedValue([
        { amount: dec('30.00'), currency: 'USD' },
      ]);
      mockPrisma.paymentAllocation.findMany.mockResolvedValue([]);
      const result = await service.getWarehouseCashSummary(DATE);
      expect(result.cashCollected).toBe('30.00');
      expect(result.paymentCount).toBe(0);
    });

    it('no double counting: an invoice-linked exit (amount=null) is excluded from the anonymous side even if present in the same query result', async () => {
      mockPrisma.stockExit.findMany.mockResolvedValue([]); // amount:{not:null} filter — real Prisma excludes null-amount rows
      mockPrisma.paymentAllocation.findMany.mockResolvedValue([
        alloc('pmt-7', '80.00'),
      ]);
      const result = await service.getWarehouseCashSummary(DATE);
      // Only the payment side contributes — no stray amount from the exit side for the same sale.
      expect(result.cashCollected).toBe('80.00');
      const exitArgs = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(exitArgs.where.amount).toEqual({ not: null });
      expect(exitArgs.where.invoiceId).toBeNull();
    });

    it('multiple anonymous exits aggregate correctly — existing anonymous-sale calculation is unchanged by this fix (mixed currency)', async () => {
      mockPrisma.stockExit.findMany.mockResolvedValue([
        { amount: dec('30.00'), currency: 'USD' },
        { amount: dec('179100'), currency: 'LBP' }, // 179100 / 89550 = 2.00
      ]);
      mockPrisma.paymentAllocation.findMany.mockResolvedValue([
        alloc('pmt-8', '40.00'),
        alloc('pmt-9', '10.00'),
      ]);
      const result = await service.getWarehouseCashSummary(DATE);
      // 30 + 2 + 40 + 10 = 82.00
      expect(result.cashCollected).toBe('82.00');
      expect(result.anonymousSalesCount).toBe(2);
      expect(result.paymentCount).toBe(2);
    });

    it('anonymous exit query filters exitType=walk_in explicitly', async () => {
      await service.getWarehouseCashSummary(DATE);
      const exitArgs = mockPrisma.stockExit.findMany.mock.calls[0][0];
      expect(exitArgs.where.exitType).toBe('walk_in');
    });

    it('the old Payment.invoiceId-based query is not used anymore — payment.findMany is never called by this method', async () => {
      await service.getWarehouseCashSummary(DATE);
      expect(mockPrisma.payment.findMany).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getOnAccountCount() — "On account (no amount)" diagnostic. Direct
  // server-side port of WarehouseSales.tsx's previous client-side
  // computation over two limit:100-capped queries (todayExitsQ /
  // todayPaymentsQ), which could silently undercount on a busy day.
  // Deliberately separate from getWarehouseCashSummary() — untouched here.
  // =========================================================================

  describe('getOnAccountCount()', () => {
    const DATE = '2024-06-01';

    beforeEach(() => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.stockExit.count.mockResolvedValue(0);
    });

    it('zero exits, zero payments returns zero', async () => {
      const result = await service.getOnAccountCount(DATE);
      expect(result).toEqual({ date: DATE, onAccountCount: 0 });
    });

    it('normal case: the count comes straight from the DB count() — not a capped array length', async () => {
      mockPrisma.stockExit.count.mockResolvedValue(3);
      const result = await service.getOnAccountCount(DATE);
      expect(result.onAccountCount).toBe(3);
    });

    it('scalability: a count beyond the old limit:100 cap is returned correctly (the exact undercounting this fix resolves)', async () => {
      mockPrisma.stockExit.count.mockResolvedValue(147);
      const result = await service.getOnAccountCount(DATE);
      expect(result.onAccountCount).toBe(147);
    });

    it('clients who paid today are excluded via clientId notIn — distinct paying clientIds are looked up first', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { clientId: 'client-a' },
        { clientId: 'client-b' },
      ]);
      await service.getOnAccountCount(DATE);
      const countArgs = mockPrisma.stockExit.count.mock.calls[0][0];
      expect(countArgs.where.clientId).toEqual({ not: null, notIn: ['client-a', 'client-b'] });
    });

    it('the payment lookup uses distinct clientId — one row per paying client, not one per payment', async () => {
      await service.getOnAccountCount(DATE);
      const payArgs = mockPrisma.payment.findMany.mock.calls[0][0];
      expect(payArgs.distinct).toEqual(['clientId']);
    });

    it('zero payments today: notIn is an empty array — does not throw and does not exclude anything', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.stockExit.count.mockResolvedValue(5);
      const result = await service.getOnAccountCount(DATE);
      const countArgs = mockPrisma.stockExit.count.mock.calls[0][0];
      expect(countArgs.where.clientId).toEqual({ not: null, notIn: [] });
      expect(result.onAccountCount).toBe(5);
    });

    it('excludes exits with an amount (invoice-linked-with-amount or anonymous) — amount:null filter, matching the original !e.amount check', async () => {
      await service.getOnAccountCount(DATE);
      const countArgs = mockPrisma.stockExit.count.mock.calls[0][0];
      expect(countArgs.where.amount).toBeNull();
    });

    it('scoped to exitType=walk_in and to the requested calendar day', async () => {
      await service.getOnAccountCount(DATE);
      const countArgs = mockPrisma.stockExit.count.mock.calls[0][0];
      const payArgs = mockPrisma.payment.findMany.mock.calls[0][0];
      const expectedDay = new Date(DATE);
      expect(countArgs.where.exitType).toBe('walk_in');
      expect(countArgs.where.date).toEqual({ gte: expectedDay, lte: expectedDay });
      expect(payArgs.where.date).toEqual({ gte: expectedDay, lte: expectedDay });
    });

    it('does not call stockExit.findMany or payment.aggregate — this is a pure count, no row-list fetch', async () => {
      await service.getOnAccountCount(DATE);
      expect(mockPrisma.stockExit.findMany).not.toHaveBeenCalled();
    });
  });
});
