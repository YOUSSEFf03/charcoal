import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { InvoiceCalculatorService } from '../invoices/invoice-calculator.service';
import { PrismaService } from '../prisma/prisma.service';

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

  const mockCalculator = {
    computeLines: jest.fn() as any,
    computeTotal: jest.fn() as any,
    validateIssuable: jest.fn() as any,
    validateCancellable: jest.fn() as any,
    recomputeStatus: jest.fn() as any,
  };

  // Helper to build a tx object for the $transaction callback
  function makeTx(overrides: Record<string, any> = {}) {
    return {
      client: { findUnique: fn(), update: fn(), ...overrides.client },
      invoice: { findUnique: fn(), update: fn(), ...overrides.invoice },
      payment: { create: fn(), aggregate: fn(), ...overrides.payment },
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InvoiceCalculatorService, useValue: mockCalculator },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
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

    it('sets invoice.status=paid when paidAmount >= total after payment', async () => {
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });

      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client A' });
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

      // recomputeStatus returns paid when total is covered
      mockCalculator.recomputeStatus.mockResolvedValue({
        paidAmount: '100.00',
        status: 'paid',
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(baseDto(), clerkUserId);

      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: invoiceId },
          data: { paidAmount: '100.00', status: 'paid' },
        }),
      );
    });

    it('sets invoice.status=partially_paid when paidAmount < total after payment', async () => {
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });

      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client A' });
      tx.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'issued',
        total: { toString: () => '100.00' },
        clientId,
      });
      tx.payment.create.mockResolvedValue({
        id: 'pay-2',
        clientId,
        invoiceId,
        amount: '50.00',
      });

      mockCalculator.recomputeStatus.mockResolvedValue({
        paidAmount: '50.00',
        status: 'partially_paid',
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create({ ...baseDto(), amount: '50.00' }, clerkUserId);

      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: invoiceId },
          data: { paidAmount: '50.00', status: 'partially_paid' },
        }),
      );
    });

    it('CONSTRAINT 15: client.update is NEVER called — no balance field written on Client', async () => {
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, clerkId: clerkUserId });

      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client A' });
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

      mockCalculator.recomputeStatus.mockResolvedValue({
        paidAmount: '100.00',
        status: 'paid',
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

      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client A' });
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

      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client A' });
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
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client A' });

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
  // create() without invoiceId — no invoice update
  // =========================================================================

  describe('create() without invoiceId', () => {
    it('does not call invoice.update when no invoiceId is provided', async () => {
      const clientId = 'client-uuid-2';
      const clerkUserId = 'clerk-user-2';
      const tx = makeTx();

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-2', clerkId: clerkUserId });
      tx.client.findUnique.mockResolvedValue({ id: clientId, name: 'Client B' });
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
          method: 'cash' as any,
        },
        clerkUserId,
      );

      expect(tx.invoice.update).not.toHaveBeenCalled();
      expect(mockCalculator.recomputeStatus).not.toHaveBeenCalled();
    });
  });
});
