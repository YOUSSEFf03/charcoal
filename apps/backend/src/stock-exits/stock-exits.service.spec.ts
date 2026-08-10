import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { StockExitsService } from './stock-exits.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockExitDto } from './dto/create-stock-exit.dto';
import { LedgerWriteService } from '../ledger/ledger-write.service';
import { UsersService } from '../users/users.service';

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

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUsersService.validateCashCapable.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockExitsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerWriteService, useValue: mockLedgerWriteService },
        { provide: UsersService, useValue: mockUsersService },
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
      const tx = { packedStock: { findUnique: fn(), update: fn() }, stockExit: { create: fn() } };
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
      const tx = { packedStock: { findUnique: fn(), update: fn() }, stockExit: { create: fn() } };
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
});
