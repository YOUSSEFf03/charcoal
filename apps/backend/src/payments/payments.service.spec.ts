import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentAllocationService } from '../invoices/payment-allocation.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerWriteService } from '../ledger/ledger-write.service';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';

// ---------------------------------------------------------------------------
// Shared mock factory helper
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('PaymentsService', () => {
  let service: PaymentsService;

  const mockPrisma = {
    user: { findUnique: fn() },
    client: { findUnique: fn(), update: fn() },
    invoice: { findUnique: fn(), update: fn() },
    payment: { findUnique: fn(), findMany: fn(), count: fn(), create: fn(), aggregate: fn() },
    $transaction: fn(),
  };

  // PaymentAllocationService owns the actual allocation + invoice.paidAmount/status
  // recompute logic (unit-tested in payment-allocation.service.spec.ts). These
  // tests only assert PaymentsService delegates to it correctly.
  const mockPaymentAllocationService = {
    allocateDirect: fn(),
    allocateFifo: fn(),
  };

  // PR 2: PaymentsService now delegates ledger writes to LedgerWriteService
  // instead of importing creditAccount directly. Mocked here (not the real
  // service) because these tests assert PaymentsService's own delegation
  // behavior in isolation — LedgerWriteService's own logic is covered by
  // ledger-write.service.spec.ts.
  const mockLedgerWriteService = {
    creditAccount: fn(),
    debitAccount: fn(),
  };

  // PR 6b: PaymentsService now calls UsersService.validateCashCapable directly,
  // before tx.payment.create(), in addition to LedgerWriteService.creditAccount()'s
  // own (unchanged) internal call to the same method. Defaults to "always valid"
  // so every pre-existing test below is unaffected; the dedicated PR 6b block
  // overrides this per-test to exercise the new rejection path.
  const mockUsersService = { validateCashCapable: fn() };

  // Currency conversion (mirrors WalkInSalesService.toClientCurrency) — defaults
  // to a usable rate so every pre-existing test (all currency:'USD', matching the
  // 'USD' client mocks above) takes the no-conversion path unchanged. The
  // dedicated currency-conversion block below overrides this per-test.
  const mockSettingsService = { getExchangeRate: fn() };

  // Helper to build a tx object for the $transaction callback
  function makeTx(overrides: Record<string, any> = {}) {
    return {
      client: { findUnique: fn(), update: fn(), ...overrides.client },
      invoice: { findUnique: fn(), update: fn(), ...overrides.invoice },
      payment: { create: fn(), aggregate: fn(), ...overrides.payment },
      user: { findUnique: fn(), ...overrides.user },
      $queryRaw: fn().mockResolvedValue([]),
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUsersService.validateCashCapable.mockResolvedValue(undefined);
    mockPaymentAllocationService.allocateDirect.mockResolvedValue(undefined);
    mockPaymentAllocationService.allocateFifo.mockResolvedValue({ allocations: [], unapplied: '0.00' });
    mockSettingsService.getExchangeRate.mockResolvedValue(89550);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaymentAllocationService, useValue: mockPaymentAllocationService },
        { provide: LedgerWriteService, useValue: mockLedgerWriteService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  // =========================================================================
  // findAll() — paginated payment listing. Previously had ZERO test coverage.
  // The `invoice` include (id/displayId only) is new — added so ClientDetail's
  // Payments tab can resolve invoice references directly from each payment row
  // instead of a second, unbounded invoice fetch — see the ClientDetail
  // invoice-scalability audit.
  // =========================================================================

  describe('findAll()', () => {
    beforeEach(() => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation((ops: any) => Promise.all(ops));
    });

    it('pagination: page 1 with limit 20 requests skip 0, take 20', async () => {
      await service.findAll(1, 20);

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('pagination: page 2 with limit 20 skips the first 20 rows', async () => {
      await service.findAll(2, 20);

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
    });

    it('sorting: defaults to date descending when no sortBy is given', async () => {
      await service.findAll(1, 20);
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { date: 'desc' } }),
      );
    });

    it('sortBy=amount, sortOrder=asc sorts by the amount column ascending', async () => {
      await service.findAll(1, 20, undefined, undefined, undefined, undefined, 'amount', 'asc');
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { amount: 'asc' } }),
      );
    });

    it('sortBy=date, sortOrder=asc sorts by the date column ascending (oldest first)', async () => {
      await service.findAll(1, 20, undefined, undefined, undefined, undefined, 'date', 'asc');
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { date: 'asc' } }),
      );
    });

    it('an unrecognized sortBy value falls back to the default (date desc)', async () => {
      await service.findAll(1, 20, undefined, undefined, undefined, undefined, 'method' as any);
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { date: 'desc' } }),
      );
    });

    it('clientId filter: adds clientId to the where clause — remains applied alongside the new include', async () => {
      await service.findAll(1, 20, 'client-42');

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clientId: 'client-42' } }),
      );
    });

    it('include: requests client, loggedBy, invoice, and receiver — invoice select is id/displayId ONLY (no lines/payments/allocations/other heavy relations), receiver select is id/name ONLY (no email/phone — GET /users/receivers privacy pattern)', async () => {
      await service.findAll(1, 20);

      const call = mockPrisma.payment.findMany.mock.calls[0][0];
      expect(call.include).toEqual({
        client: { select: { id: true, name: true } },
        loggedBy: { select: { id: true, name: true } },
        invoice: { select: { id: true, displayId: true } },
        receiver: { select: { id: true, name: true } },
      });
    });

    it('a payment WITH a receiver returns the minimal receiver relation (id/name) directly on the row — Payment History must show the SAME receiver as cash attribution, not a frontend-reconstructed name', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'p1', clientId: 'client-42', receiverId: 'user-9', receiver: { id: 'user-9', name: 'Abo Baker' }, amount: '50.00' },
      ]);
      mockPrisma.payment.count.mockResolvedValue(1);

      const result = await service.findAll(1, 20);

      expect(result.data[0].receiver).toEqual({ id: 'user-9', name: 'Abo Baker' });
    });

    it('a payment with no receiver returns receiver: null — unattributed historical payments must still be readable, not crash the list', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'p1', clientId: 'client-42', receiverId: null, receiver: null, amount: '50.00' },
      ]);
      mockPrisma.payment.count.mockResolvedValue(1);

      const result = await service.findAll(1, 20);

      expect(result.data[0].receiver).toBeNull();
    });

    it('total count reflects count(), not data.length, and uses the same where as findMany', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
      mockPrisma.payment.count.mockResolvedValue(57);

      const result = await service.findAll(1, 20, 'client-42');

      expect(result.total).toBe(57);
      expect(result.data).toHaveLength(2);
      expect(mockPrisma.payment.count).toHaveBeenCalledWith({ where: { clientId: 'client-42' } });
    });

    it('a payment with no invoiceId (unapplied/client-level payment) still returns normally, with invoice: null — unchanged behavior', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'p1', clientId: 'client-42', invoiceId: null, invoice: null, amount: '50.00' },
      ]);
      mockPrisma.payment.count.mockResolvedValue(1);

      const result = await service.findAll(1, 20);

      expect(result.data[0].invoice).toBeNull();
      expect(result.data[0].invoiceId).toBeNull();
    });

    it('a payment WITH an invoice returns the lightweight invoice reference directly on the row', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'p1', clientId: 'client-42', invoiceId: 'inv-1', invoice: { id: 'inv-1', displayId: 'INV-001' }, amount: '50.00' },
      ]);
      mockPrisma.payment.count.mockResolvedValue(1);

      const result = await service.findAll(1, 20);

      expect(result.data[0].invoice).toEqual({ id: 'inv-1', displayId: 'INV-001' });
    });
  });

  describe('findOne()', () => {
    it('include: requests receiver and allocations→invoice alongside client/invoice/loggedBy — the Fill Client Payment Detail page reads all of these', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({ id: 'p1' });

      await service.findOne('p1');

      const call = mockPrisma.payment.findUnique.mock.calls[0][0];
      expect(call.include).toEqual({
        client: true,
        invoice: true,
        loggedBy: { select: { id: true, name: true } },
        receiver: { select: { id: true, name: true } },
        allocations: { include: { invoice: { select: { id: true, displayId: true } } } },
      });
    });

    it('throws NotFoundException when the payment does not exist', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // =========================================================================
  // create() — invoice status update on full payment
  // =========================================================================

  describe('create() with invoiceId', () => {
    const clientId = 'client-uuid-1';
    const invoiceId = 'inv-uuid-1';
    const clerkUserId = 'clerk-user-1';
    const userId = 'db-user-1';

    function baseDto() {
      return {
        clientId,
        invoiceId,
        amount: '100.00',
        currency: 'USD' as any,
        method: 'bank_transfer' as any,
      };
    }

    it('delegates to PaymentAllocationService.allocateDirect with the payment id, invoiceId and Decimal amount', async () => {
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });

      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client A', currency: 'USD' });
      tx.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'issued',
        total: { toString: () => '100.00' },
        clientId,
      });
      tx.payment.create.mockResolvedValue({
        id: 'pay-1',
        clientId,
        invoiceId,
        amount: '100.00',
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto(), clerkUserId);

      expect(mockPaymentAllocationService.allocateDirect).toHaveBeenCalledTimes(1);
      const [calledTx, calledPaymentId, calledInvoiceId, calledAmount] =
        mockPaymentAllocationService.allocateDirect.mock.calls[0];
      expect(calledTx).toBe(tx);
      expect(calledPaymentId).toBe('pay-1');
      expect(calledInvoiceId).toBe(invoiceId);
      expect(calledAmount.toString()).toBe('100');
      expect(mockPaymentAllocationService.allocateFifo).not.toHaveBeenCalled();
    });

    it('locks the invoice (FOR UPDATE) before reading it for the status/client guard checks', async () => {
      const tx = makeTx();
      const callOrder: string[] = [];

      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client A', currency: 'USD' });
      tx.$queryRaw.mockImplementation(async () => { callOrder.push('lock'); return []; });
      tx.invoice.findUnique.mockImplementation(async () => {
        callOrder.push('read');
        return { id: invoiceId, status: 'issued', total: { toString: () => '100.00' }, clientId };
      });
      tx.payment.create.mockResolvedValue({ id: 'pay-1', clientId, invoiceId, amount: '100.00' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto(), clerkUserId);

      expect(callOrder).toEqual(['lock', 'read']);
    });

    it('CONSTRAINT 15: client.update is NEVER called — no balance field written on Client', async () => {
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });

      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client A', currency: 'USD' });
      tx.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'issued',
        total: { toString: () => '100.00' },
        clientId,
      });
      tx.payment.create.mockResolvedValue({
        id: 'pay-3',
        clientId,
        invoiceId,
        amount: '100.00',
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto(), clerkUserId);

      // client.update must never be called anywhere
      expect(tx.client.update).not.toHaveBeenCalled();
      expect(mockPrisma.client.update).not.toHaveBeenCalled();

      // The payment.create data must NOT contain a 'balance' key
      const paymentCreateCall = tx.payment.create.mock.calls[0][0];
      expect(paymentCreateCall.data).not.toHaveProperty('balance');
    });

    it('throws BadRequestException INVALID_STATE when invoice status is draft', async () => {
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });

      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client A', currency: 'USD' });
      tx.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'draft',
        total: { toString: () => '100.00' },
        clientId,
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.create(baseDto(), clerkUserId)).rejects.toThrow(BadRequestException);
      await expect(service.create(baseDto(), clerkUserId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_STATE' }),
      });
    });

    it('throws BadRequestException INVALID_STATE when invoice status is paid', async () => {
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });

      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client A', currency: 'USD' });
      tx.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'paid',
        total: { toString: () => '100.00' },
        clientId,
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.create(baseDto(), clerkUserId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_STATE' }),
      });
    });

    it('throws BadRequestException CONSTRAINT_VIOLATION when invoice.clientId does not match dto.clientId', async () => {
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });

      // Client exists for dto.clientId
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client A', currency: 'USD' });

      // But the invoice belongs to a DIFFERENT client
      tx.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'issued',
        total: { toString: () => '100.00' },
        clientId: 'different-client-uuid',
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.create(baseDto(), clerkUserId)).rejects.toThrow(BadRequestException);
      await expect(service.create(baseDto(), clerkUserId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });
    });
  });

  // =========================================================================
  // create() without invoiceId — FIFO allocation across the client's open invoices
  // =========================================================================

  describe('create() without invoiceId', () => {
    it('delegates to PaymentAllocationService.allocateFifo with the client id, payment id and Decimal amount — never allocateDirect', async () => {
      const clientId = 'client-uuid-2';
      const clerkUserId = 'clerk-user-2';
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-2', clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client B', currency: 'USD' });
      tx.payment.create.mockResolvedValue({
        id: 'pay-standalone',
        clientId,
        amount: '200.00',
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(
        {
          clientId,
          amount: '200.00',
          currency: 'USD' as any,
          // bank_transfer, not cash — this test is about allocateFifo
          // delegation and is intentionally receiver-agnostic; a receiver-
          // required method here would 400 before ever reaching allocation.
          method: 'bank_transfer' as any,
        },
        clerkUserId,
      );

      expect(tx.invoice.update).not.toHaveBeenCalled();
      expect(mockPaymentAllocationService.allocateDirect).not.toHaveBeenCalled();
      expect(mockPaymentAllocationService.allocateFifo).toHaveBeenCalledTimes(1);
      const [calledTx, calledClientId, calledPaymentId, calledAmount] =
        mockPaymentAllocationService.allocateFifo.mock.calls[0];
      expect(calledTx).toBe(tx);
      expect(calledClientId).toBe(clientId);
      expect(calledPaymentId).toBe('pay-standalone');
      expect(calledAmount.toString()).toBe('200');
    });

    it('does not lock any invoice via $queryRaw when no invoiceId is provided (locking happens inside allocateFifo itself)', async () => {
      const clientId = 'client-uuid-2b';
      const clerkUserId = 'clerk-user-2b';
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-2b', clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client B', currency: 'USD' });
      tx.payment.create.mockResolvedValue({ id: 'pay-standalone-2', clientId, amount: '50.00' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(
        { clientId, amount: '50.00', currency: 'USD' as any, method: 'bank_transfer' as any },
        clerkUserId,
      );

      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // PR 2 — ledger delegation via LedgerWriteService
  // =========================================================================

  describe('create() — ledger delegation (PR 2 regression)', () => {
    const clientId = 'client-uuid-3';
    const receiverId = 'receiver-uuid-1';
    const clerkUserId = 'clerk-user-3';

    function baseDto(overrides: Record<string, any> = {}) {
      return {
        clientId,
        amount: '75.00',
        currency: 'USD' as any,
        method: 'cash' as any,
        ...overrides,
      };
    }

    it('credits the receiver via LedgerWriteService.creditAccount when receiverId is provided', async () => {
      const tx = makeTx();
      const paymentDate = new Date('2026-07-31');

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-3', clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Marina Walk Café', currency: 'USD' });
      tx.user.findUnique.mockResolvedValue({ id: receiverId, name: 'Dev owner' });
      tx.payment.create.mockResolvedValue({
        id: 'pay-ledger-1',
        clientId,
        amount: '75.00',
        date: paymentDate,
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto({ receiverId }), clerkUserId);

      expect(mockLedgerWriteService.creditAccount).toHaveBeenCalledTimes(1);
      const [calledTx, calledUserId, calledAmount, calledType, calledRefId, calledDesc, calledDate] =
        mockLedgerWriteService.creditAccount.mock.calls[0];
      expect(calledTx).toBe(tx); // same transaction as payment.create — not a separate one
      expect(calledUserId).toBe(receiverId);
      expect(calledAmount.toString()).toBe('75');
      expect(calledType).toBe('payment_received');
      expect(calledRefId).toBe('pay-ledger-1');
      expect(calledDesc).toBe('Payment — Marina Walk Café');
      expect(calledDate).toBe(paymentDate);
    });

    it('does not call LedgerWriteService when no receiver is provided (bank_transfer — a receiver-required method here would 400 first, covered separately)', async () => {
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-4', clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Marina Walk Café', currency: 'USD' });
      tx.payment.create.mockResolvedValue({ id: 'pay-no-receiver', clientId, amount: '75.00' });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto({ method: 'bank_transfer' as any }), clerkUserId);

      expect(mockLedgerWriteService.creditAccount).not.toHaveBeenCalled();
    });

    it('does not call LedgerWriteService when only a legacy receiverName (no receiverId) is provided — matching original behavior (bank_transfer, where a receiver is never required)', async () => {
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-5', clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Marina Walk Café', currency: 'USD' });
      tx.payment.create.mockResolvedValue({ id: 'pay-name-only', clientId, amount: '75.00' });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto({ method: 'bank_transfer' as any, receiverName: 'Walk-in cashier' }), clerkUserId);

      expect(mockLedgerWriteService.creditAccount).not.toHaveBeenCalled();
      expect(tx.payment.create.mock.calls[0][0].data.receiverName).toBe('Walk-in cashier');
    });

    it('propagates a LedgerWriteService failure — the payment is not silently created if the ledger credit fails', async () => {
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-6', clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Marina Walk Café', currency: 'USD' });
      tx.user.findUnique.mockResolvedValue({ id: receiverId, name: 'Dev owner' });
      tx.payment.create.mockResolvedValue({ id: 'pay-fail', clientId, amount: '75.00', date: new Date() });

      mockLedgerWriteService.creditAccount.mockRejectedValue(new Error('ledger write failed'));
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.create(baseDto({ receiverId }), clerkUserId)).rejects.toThrow('ledger write failed');
    });
  });

  // =========================================================================
  // PR 6b — validate the holder before the FK-constrained write
  // =========================================================================

  describe('create() — pre-write holder validation (PR 6b regression)', () => {
    const clientId = 'client-uuid-6b';
    const receiverId = 'receiver-uuid-6b';
    const clerkUserId = 'clerk-user-6b';

    function baseDto(overrides: Record<string, any> = {}) {
      return {
        clientId,
        amount: '30.00',
        currency: 'USD' as any,
        method: 'cash' as any,
        ...overrides,
      };
    }

    it('1) rejects a nonexistent receiverId with NotFoundException BEFORE tx.payment.create() is called', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-6b', clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Marina Walk Café', currency: 'USD' });
      mockUsersService.validateCashCapable.mockRejectedValue(
        new NotFoundException({ error: 'Receiver not found', code: 'NOT_FOUND' }),
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.create(baseDto({ receiverId }), clerkUserId)).rejects.toBeInstanceOf(NotFoundException);

      expect(mockUsersService.validateCashCapable).toHaveBeenCalledWith(receiverId);
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(mockLedgerWriteService.creditAccount).not.toHaveBeenCalled();
    });

    it('4) leaves no side effects when validation fails — nothing to roll back because nothing was written', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-6b-2', clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Marina Walk Café', currency: 'USD' });
      mockUsersService.validateCashCapable.mockRejectedValue(
        new NotFoundException({ error: 'Receiver not found', code: 'NOT_FOUND' }),
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.create(baseDto({ receiverId }), clerkUserId)).rejects.toBeInstanceOf(NotFoundException);

      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.invoice.update).not.toHaveBeenCalled();
    });

    it("2) does not bypass LedgerWriteService's own check — if the pre-write check somehow passes, creditAccount's independent rejection still propagates", async () => {
      // Simulates PR 6's defense-in-depth: even if the new earlier check ever
      // passed something it shouldn't have, the untouched check inside
      // LedgerWriteService.creditAccount() (PR 6) is still the final gate.
      const tx = makeTx();
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-6b-3', clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Marina Walk Café', currency: 'USD' });
      tx.user.findUnique.mockResolvedValue({ id: receiverId, name: 'Deactivated User' });
      tx.payment.create.mockResolvedValue({ id: 'pay-6b-3', clientId, amount: '30.00', date: new Date() });
      mockUsersService.validateCashCapable.mockResolvedValue(undefined); // pre-write check passes
      mockLedgerWriteService.creditAccount.mockRejectedValue(
        new NotFoundException({ error: 'Receiver not found', code: 'NOT_FOUND' }), // PR 6's own check rejects
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.create(baseDto({ receiverId }), clerkUserId)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockLedgerWriteService.creditAccount).toHaveBeenCalledTimes(1);
    });

    it('3) happy path: validates, then writes the document, then credits the ledger, in that order', async () => {
      const tx = makeTx();
      const paymentDate = new Date('2026-08-01');
      const callOrder: string[] = [];

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-6b-4', clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Marina Walk Café', currency: 'USD' });
      tx.user.findUnique.mockResolvedValue({ id: receiverId, name: 'Dev owner' });
      mockUsersService.validateCashCapable.mockImplementation(async () => { callOrder.push('validate'); });
      tx.payment.create.mockImplementation(async () => {
        callOrder.push('payment.create');
        return { id: 'pay-6b-4', clientId, amount: '30.00', date: paymentDate };
      });
      mockLedgerWriteService.creditAccount.mockImplementation(async () => { callOrder.push('creditAccount'); });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto({ receiverId }), clerkUserId);

      expect(callOrder).toEqual(['validate', 'payment.create', 'creditAccount']);
    });
  });

  // =========================================================================
  // RECEIVER_REQUIRED — a cash/whish/omt payment must not silently lose WHO
  // RECEIVED IT. bank_transfer (and cheque) are exempt — see
  // RECEIVER_REQUIRED_METHODS' doc comment in payments.service.ts.
  // =========================================================================

  describe('create() — receiver requirement (cash/whish/omt)', () => {
    const clientId = 'client-uuid-recv';
    const receiverId = 'receiver-uuid-recv';
    const clerkUserId = 'clerk-user-recv';
    const userId = 'db-user-recv';

    function dto(overrides: Record<string, any> = {}) {
      return {
        clientId,
        amount: '40.00',
        currency: 'USD' as any,
        method: 'cash' as any,
        ...overrides,
      };
    }

    function setUp() {
      const tx = makeTx();
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Receiver Test Client', currency: 'USD' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      return tx;
    }

    it.each(['cash', 'whish', 'omt'])(
      'rejects a %s payment with no receiverId (BadRequestException, code RECEIVER_REQUIRED) — before tx.payment.create()',
      async (method) => {
        const tx = setUp();

        await expect(service.create(dto({ method: method as any }), clerkUserId)).rejects.toThrow(BadRequestException);
        await expect(service.create(dto({ method: method as any }), clerkUserId)).rejects.toMatchObject({
          response: expect.objectContaining({ code: 'RECEIVER_REQUIRED' }),
        });
        expect(tx.payment.create).not.toHaveBeenCalled();
      },
    );

    it('rejects a cash payment that has only a legacy receiverName, no receiverId — a free-text name is not a valid receiver', async () => {
      const tx = setUp();

      await expect(
        service.create(dto({ receiverName: 'Someone at the door' }), clerkUserId),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'RECEIVER_REQUIRED' }) });
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('accepts a cash payment with a valid receiverId', async () => {
      const tx = setUp();
      tx.user.findUnique.mockResolvedValue({ id: receiverId, name: 'Abo Baker' });
      tx.payment.create.mockResolvedValue({ id: 'pay-recv-ok', clientId, amount: '40.00', date: new Date() });

      const result = await service.create(dto({ receiverId }), clerkUserId);

      expect(result.id).toBe('pay-recv-ok');
      expect(tx.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ receiverId }) }),
      );
    });

    it.each(['bank_transfer', 'cheque'])(
      'does NOT require a receiver for %s — succeeds with no receiverId at all',
      async (method) => {
        const tx = setUp();
        tx.payment.create.mockResolvedValue({ id: 'pay-no-recv-ok', clientId, amount: '40.00', date: new Date() });

        const result = await service.create(dto({ method: method as any }), clerkUserId);

        expect(result.id).toBe('pay-no-recv-ok');
        expect(tx.payment.create).toHaveBeenCalled();
      },
    );

    it('an invalid (nonexistent) receiverId is still rejected via validateCashCapable, even though it satisfies the presence check', async () => {
      const tx = setUp();
      mockUsersService.validateCashCapable.mockRejectedValue(
        new NotFoundException({ error: 'Receiver not found', code: 'NOT_FOUND' }),
      );

      await expect(service.create(dto({ receiverId: 'does-not-exist' }), clerkUserId)).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.payment.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // create() — currency conversion (mirrors WalkInSalesService.toClientCurrency).
  // Regression coverage for: a payment quoted in a currency other than the
  // target client's own currency must be converted before being stored —
  // otherwise every balance calculation that sums Payment.amount alongside
  // Invoice.total (ClientBalanceService, getClientLedger, getArSummary)
  // silently mixes USD and LBP figures as if they were the same unit.
  // =========================================================================

  describe('create() — currency conversion', () => {
    const clientId = 'client-uuid-ccy';
    const clerkUserId = 'clerk-user-ccy';
    const userId = 'db-user-ccy';

    function dto(overrides: Record<string, any> = {}) {
      return {
        clientId,
        amount: '100.00',
        currency: 'USD' as any,
        // bank_transfer, not cash — this describe block is about currency
        // conversion arithmetic and is intentionally receiver-agnostic; the
        // one test below that DOES care about receiver crediting passes
        // receiverId explicitly (crediting is unconditional on method).
        method: 'bank_transfer' as any,
        ...overrides,
      };
    }

    it('a payment quoted in USD for an LBP client is converted (× rate) before being stored', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'LBP Client', currency: 'LBP' });
      mockSettingsService.getExchangeRate.mockResolvedValue(90000);
      tx.payment.create.mockResolvedValue({ id: 'pay-ccy-1', clientId, date: new Date() });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(dto({ amount: '100.00', currency: 'USD' }), clerkUserId);

      expect(tx.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: '9000000.00', currency: 'LBP' }) }),
      );
    });

    it('a payment quoted in LBP for a USD client is converted (÷ rate) before being stored', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'USD Client', currency: 'USD' });
      mockSettingsService.getExchangeRate.mockResolvedValue(90000);
      tx.payment.create.mockResolvedValue({ id: 'pay-ccy-2', clientId, date: new Date() });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(dto({ amount: '9000000', currency: 'LBP' }), clerkUserId);

      expect(tx.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: '100.00', currency: 'USD' }) }),
      );
    });

    it('a payment already quoted in the client\'s own currency is stored unchanged — no conversion, no exchange-rate lookup needed', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'USD Client', currency: 'USD' });
      tx.payment.create.mockResolvedValue({ id: 'pay-ccy-3', clientId, date: new Date() });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(dto({ amount: '250.00', currency: 'USD' }), clerkUserId);

      expect(tx.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: '250.00', currency: 'USD' }) }),
      );
      expect(mockSettingsService.getExchangeRate).not.toHaveBeenCalled();
    });

    it('rejects with RATE_UNAVAILABLE (never $0) when a conversion is required but the exchange rate is zero', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'LBP Client', currency: 'LBP' });
      mockSettingsService.getExchangeRate.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.create(dto({ amount: '100.00', currency: 'USD' }), clerkUserId))
        .rejects.toMatchObject({ response: { code: 'RATE_UNAVAILABLE' } });
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('the CONVERTED amount — not the originally quoted amount — is what gets allocated to invoices (allocateFifo)', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'LBP Client', currency: 'LBP' });
      mockSettingsService.getExchangeRate.mockResolvedValue(90000);
      tx.payment.create.mockResolvedValue({ id: 'pay-ccy-5', clientId, date: new Date() });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(dto({ amount: '100.00', currency: 'USD' }), clerkUserId);

      expect(mockPaymentAllocationService.allocateFifo).toHaveBeenCalledTimes(1);
      const [, , , calledAmount] = mockPaymentAllocationService.allocateFifo.mock.calls[0];
      expect(calledAmount.toString()).toBe('9000000');
    });

    it('the receiver ledger is credited with the CONVERTED amount, not the originally quoted amount', async () => {
      const tx = makeTx();
      const receiverId = 'receiver-ccy-1';
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'LBP Client', currency: 'LBP' });
      tx.user.findUnique.mockResolvedValue({ id: receiverId, name: 'Receiver' });
      mockSettingsService.getExchangeRate.mockResolvedValue(90000);
      tx.payment.create.mockResolvedValue({ id: 'pay-ccy-6', clientId, date: new Date() });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(dto({ amount: '100.00', currency: 'USD', receiverId }), clerkUserId);

      expect(mockLedgerWriteService.creditAccount).toHaveBeenCalledTimes(1);
      const [, , calledAmount] = mockLedgerWriteService.creditAccount.mock.calls[0];
      expect(calledAmount.toString()).toBe('9000000');
    });
  });
});
