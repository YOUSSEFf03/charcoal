import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InvoicesService } from './invoices.service';
import { InvoiceCalculatorService, EnrichedBagLine, EnrichedKgLine } from './invoice-calculator.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { InvoiceLineDto } from './dto/invoice-line.dto';

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

describe('InvoicesService', () => {
  let service: InvoicesService;
  let calculator: InvoiceCalculatorService;

  const mockPrisma = {
    client: { findUnique: fn() },
    clientOrder: { findUnique: fn() },
    invoice: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      count: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
    },
    payment: { findMany: fn(), aggregate: fn() },
    $transaction: fn(),
  };

  const mockCalculator = {
    computeLines: jest.fn() as any,
    computeTotal: jest.fn() as any,
    validateIssuable: jest.fn() as any,
    validateCancellable: jest.fn() as any,
    recomputeStatus: jest.fn() as any,
  };

  // BUG-J: issue() now resolves the exchange rate to snapshot it on the invoice.
  const mockSettings = {
    getExchangeRate: jest.fn() as any,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSettings.getExchangeRate.mockResolvedValue(89550);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InvoiceCalculatorService, useValue: mockCalculator },
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
    calculator = module.get<InvoiceCalculatorService>(InvoiceCalculatorService);
  });

  // =========================================================================
  // cancel() — status transition guards
  // =========================================================================

  describe('cancel()', () => {
    it('throws BadRequestException INVALID_TRANSITION when invoice is paid', async () => {
      const invoiceId = 'inv-uuid-1';

      const tx = {
        invoice: {
          findUnique: jest.fn() as any,
          update: jest.fn() as any,
        },
      };
      tx.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'paid',
      });

      // validateCancellable on the REAL calculator would throw — but we're using the real
      // InvoiceCalculatorService logic here, so we call the real method behaviour via mock
      mockCalculator.validateCancellable.mockImplementation((inv: any) => {
        if (inv.status === 'paid' || inv.status === 'cancelled') {
          throw new BadRequestException({
            message: 'Invoice cannot be cancelled from its current status',
            error: 'Invoice cannot be cancelled from its current status',
            code: 'INVALID_TRANSITION',
          });
        }
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.cancel(invoiceId)).rejects.toThrow(BadRequestException);
      await expect(service.cancel(invoiceId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_TRANSITION' }),
      });
    });

    it('throws BadRequestException INVALID_TRANSITION when invoice is already cancelled', async () => {
      const invoiceId = 'inv-uuid-2';

      const tx = {
        invoice: {
          findUnique: jest.fn() as any,
          update: jest.fn() as any,
        },
      };
      tx.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'cancelled',
      });

      mockCalculator.validateCancellable.mockImplementation((inv: any) => {
        if (inv.status === 'paid' || inv.status === 'cancelled') {
          throw new BadRequestException({
            message: 'Invoice cannot be cancelled from its current status',
            error: 'Invoice cannot be cancelled from its current status',
            code: 'INVALID_TRANSITION',
          });
        }
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.cancel(invoiceId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_TRANSITION' }),
      });
    });

    it('succeeds and calls invoice.update with status=cancelled when invoice is issued', async () => {
      const invoiceId = 'inv-uuid-3';

      const tx = {
        invoice: {
          findUnique: jest.fn() as any,
          update: jest.fn() as any,
        },
      };
      tx.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'issued',
      });
      tx.invoice.update.mockResolvedValue({ id: invoiceId, status: 'cancelled' });

      // validateCancellable: issued is valid, so do nothing
      mockCalculator.validateCancellable.mockReturnValue(undefined);

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const result = await service.cancel(invoiceId);

      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: invoiceId },
          data: { status: 'cancelled' },
        }),
      );
      expect(result).toMatchObject({ status: 'cancelled' });
    });
  });

  // =========================================================================
  // update() — draft-only guard
  // =========================================================================

  describe('update()', () => {
    it('throws BadRequestException CONSTRAINT_VIOLATION when invoice is not draft (issued)', async () => {
      const invoiceId = 'inv-uuid-4';

      // update() calls this.findOne(id) first, which calls invoice.findUnique
      mockPrisma.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'issued',
        client: { id: 'client-1', name: 'Client A' },
        payments: [],
      });

      await expect(
        service.update(invoiceId, { currency: 'USD' as any }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.update(invoiceId, { currency: 'USD' as any }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });
    });

    it('succeeds and calls invoice.update when invoice is draft', async () => {
      const invoiceId = 'inv-uuid-5';

      mockPrisma.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'draft',
        client: { id: 'client-1', name: 'Client A' },
        payments: [],
      });

      mockCalculator.computeLines.mockReturnValue({
        lines: [
          {
            bagTypeId: 'bt-1',
            bagTypeName: '2kg',
            qty: 10,
            pricePerBag: '5.00',
            lineTotal: '50.00',
          },
        ],
        subtotal: '50.00',
      });
      mockCalculator.computeTotal.mockReturnValue('50.00');

      mockPrisma.invoice.update.mockResolvedValue({
        id: invoiceId,
        status: 'draft',
        subtotal: '50.00',
        total: '50.00',
      });

      const result = await service.update(invoiceId, {
        lines: [
          {
            bagTypeId: 'bt-1',
            bagTypeName: '2kg',
            qty: 10,
            pricePerBag: '5.00',
          },
        ],
      });

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: invoiceId } }),
      );
      expect(result).toBeDefined();
    });
  });

  // =========================================================================
  // issue() — status transition guard
  // =========================================================================

  describe('issue()', () => {
    it('throws BadRequestException INVALID_TRANSITION when invoice is not draft (already issued)', async () => {
      const invoiceId = 'inv-uuid-6';

      const tx = {
        invoice: {
          findUnique: jest.fn() as any,
          update: jest.fn() as any,
        },
      };
      tx.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'issued',
      });

      mockCalculator.validateIssuable.mockImplementation((inv: any) => {
        if (inv.status !== 'draft') {
          throw new BadRequestException({
            message: 'Invoice can only be issued from draft status',
            error: 'Invoice can only be issued from draft status',
            code: 'INVALID_TRANSITION',
          });
        }
      });

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.issue(invoiceId)).rejects.toThrow(BadRequestException);
      await expect(service.issue(invoiceId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_TRANSITION' }),
      });
    });

    it('succeeds and calls invoice.update with status=issued and issuedAt when draft', async () => {
      const invoiceId = 'inv-uuid-7';

      const tx = {
        invoice: {
          findUnique: jest.fn() as any,
          update: jest.fn() as any,
        },
      };
      tx.invoice.findUnique.mockResolvedValue({
        id: invoiceId,
        status: 'draft',
      });
      tx.invoice.update.mockResolvedValue({
        id: invoiceId,
        status: 'issued',
        issuedAt: new Date(),
      });

      mockCalculator.validateIssuable.mockReturnValue(undefined);

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const result = await service.issue(invoiceId);

      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: invoiceId },
          data: expect.objectContaining({
            status: 'issued',
            issuedAt: expect.any(Date),
            // BUG-J (P5): the issue-time rate is snapshotted onto the invoice.
            exchangeRateSnapshot: '89550',
          }),
        }),
      );
      expect(mockSettings.getExchangeRate).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ status: 'issued' });
    });
  });

  // =========================================================================
  // create() — CONSTRAINT 10: no price validation
  // =========================================================================

  describe('create()', () => {
    it('CONSTRAINT 10: succeeds with pricePerBag="999.99" — no price cap validation', async () => {
      const clientId = 'client-uuid-1';

      mockPrisma.client.findUnique.mockResolvedValue({ id: clientId, name: 'BigClient' });

      mockCalculator.computeLines.mockReturnValue({
        lines: [
          {
            bagTypeId: 'bt-1',
            bagTypeName: '2kg',
            qty: 100,
            pricePerBag: '999.99',
            lineTotal: '99999.00',
          },
        ],
        subtotal: '99999.00',
      });
      mockCalculator.computeTotal.mockReturnValue('99999.00');

      mockPrisma.invoice.create.mockResolvedValue({
        id: 'new-inv-1',
        clientId,
        status: 'draft',
        subtotal: '99999.00',
        total: '99999.00',
        client: { id: clientId, name: 'BigClient' },
      });

      const result = await service.create({
        clientId,
        lines: [
          {
            bagTypeId: 'bt-1',
            bagTypeName: '2kg',
            qty: 100,
            pricePerBag: '999.99',
          },
        ],
        currency: 'USD' as any,
      });

      expect(mockPrisma.invoice.create).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.status).toBe('draft');
    });

    // ── source field (Phase 2) ──────────────────────────────────────────────

    it('Phase 2 — source is ORDER when orderId is provided', async () => {
      const clientId = 'client-uuid-2';
      const orderId = 'order-uuid-1';

      mockPrisma.client.findUnique.mockResolvedValue({ id: clientId, name: 'Test' });
      mockPrisma.clientOrder.findUnique.mockResolvedValue({ id: orderId });
      mockCalculator.computeLines.mockReturnValue({ lines: [], subtotal: '0.00' });
      mockCalculator.computeTotal.mockReturnValue('0.00');
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-order', clientId, status: 'draft', source: 'ORDER', client: { id: clientId, name: 'Test' } });

      await service.create({
        clientId,
        orderId,
        lines: [{ bagTypeId: 'bt-1', bagTypeName: '2kg', qty: 1, pricePerBag: '1.00' }],
        currency: 'USD' as any,
      });

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: 'ORDER' }),
        }),
      );
    });

    it('Phase 2 — source is WAREHOUSE_SALE when orderId is absent', async () => {
      const clientId = 'client-uuid-3';

      mockPrisma.client.findUnique.mockResolvedValue({ id: clientId, name: 'Test' });
      mockCalculator.computeLines.mockReturnValue({ lines: [], subtotal: '0.00' });
      mockCalculator.computeTotal.mockReturnValue('0.00');
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-wh', clientId, status: 'draft', source: 'WAREHOUSE_SALE', client: { id: clientId, name: 'Test' } });

      await service.create({
        clientId,
        lines: [{ bagTypeId: 'bt-1', bagTypeName: '2kg', qty: 1, pricePerBag: '1.00' }],
        currency: 'USD' as any,
      });

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: 'WAREHOUSE_SALE' }),
        }),
      );
    });
  });

  // =========================================================================
  // createFromOrder() — order → invoice automation
  // =========================================================================

  describe('createFromOrder()', () => {
    const orderId = 'order-auto-uuid';
    const clientId = 'client-auto-uuid';

    const kgOrder = {
      id: orderId,
      clientId,
      charcoalType: 'shisha',
      grade: 'A',
      totalKgRequested: { toString: () => '2000.000' },
      pricePerBag: { toString: () => '1.20' },
      currency: 'USD',
      status: 'delivered',
      bagTypeId: null,
      bagType: null,
    };

    const bagOrder = {
      id: orderId,
      clientId,
      charcoalType: 'BBQ Hardwood',
      grade: 'A',
      totalKgRequested: { toString: () => '1800.000' },
      pricePerBag: { toString: () => '2.00' },
      currency: 'USD',
      status: 'delivered',
      bagTypeId: 'bt-uuid',
      bagType: {
        id: 'bt-uuid',
        name: '1.8 Kg Bag',
        nominalKg: { toString: () => '1.800' },
      },
    };

    it('KG order: creates invoice with saleUnit=KG, kgQuantity, pricePerKg, description', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(kgOrder);
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      mockCalculator.computeLines.mockReturnValue({
        lines: [{ saleUnit: 'KG', kgQuantity: '2000.000', pricePerKg: '1.20', description: 'shisha Grade A', lineTotal: '2400.00' }],
        subtotal: '2400.00',
      });
      mockCalculator.computeTotal.mockReturnValue('2400.00');
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-kg', orderId, status: 'draft' });

      const result = await service.createFromOrder(orderId);

      expect(mockCalculator.computeLines).toHaveBeenCalledWith([
        expect.objectContaining({ saleUnit: 'KG', kgQuantity: '2000.000', pricePerKg: '1.20', description: 'shisha Grade A' }),
      ]);
      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId,
            clientId,
            source: 'ORDER',
            status: 'draft',
            currency: 'USD',
          }),
        }),
      );
      expect(result).toMatchObject({ status: 'draft' });
    });

    it('BAG order: creates invoice with saleUnit=BAG, qty=round(totalKg/nominalKg), pricePerBag', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(bagOrder);
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      mockCalculator.computeLines.mockReturnValue({
        lines: [{ saleUnit: 'BAG', qty: 1000, pricePerBag: '2.00', bagTypeId: 'bt-uuid', bagTypeName: '1.8 Kg Bag', lineTotal: '2000.00' }],
        subtotal: '2000.00',
      });
      mockCalculator.computeTotal.mockReturnValue('2000.00');
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-bag', orderId, status: 'draft' });

      await service.createFromOrder(orderId);

      // round(1800 / 1.8) = 1000 exactly
      expect(mockCalculator.computeLines).toHaveBeenCalledWith([
        expect.objectContaining({ saleUnit: 'BAG', qty: 1000, bagTypeId: 'bt-uuid', bagTypeName: '1.8 Kg Bag', pricePerBag: '2.00' }),
      ]);
      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: 'ORDER', status: 'draft' }),
        }),
      );
    });

    it('throws NotFoundException when order does not exist', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(null);

      await expect(service.createFromOrder('no-such-order')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException CONSTRAINT_VIOLATION for non-delivered order', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue({ ...kgOrder, status: 'confirmed' });

      await expect(service.createFromOrder(orderId)).rejects.toThrow(BadRequestException);
      await expect(service.createFromOrder(orderId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('idempotent: returns existing non-cancelled invoice without creating a duplicate', async () => {
      const existingInvoice = { id: 'existing-inv', orderId, status: 'draft' };
      mockPrisma.clientOrder.findUnique.mockResolvedValue(kgOrder);
      mockPrisma.invoice.findFirst.mockResolvedValue(existingInvoice);

      const result = await service.createFromOrder(orderId);

      expect(result).toBe(existingInvoice);
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('idempotent: also returns existing issued invoice (same guard)', async () => {
      const existingInvoice = { id: 'existing-inv-issued', orderId, status: 'issued' };
      mockPrisma.clientOrder.findUnique.mockResolvedValue(kgOrder);
      mockPrisma.invoice.findFirst.mockResolvedValue(existingInvoice);

      const result = await service.createFromOrder(orderId);

      expect(result).toBe(existingInvoice);
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('allows new invoice when previous invoice is cancelled (findFirst returns null)', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(kgOrder);
      // findFirst filters status != cancelled, so cancelled invoice → null
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      mockCalculator.computeLines.mockReturnValue({ lines: [], subtotal: '0.00' });
      mockCalculator.computeTotal.mockReturnValue('0.00');
      mockPrisma.invoice.create.mockResolvedValue({ id: 'new-inv-after-cancel', orderId, status: 'draft' });

      const result = await service.createFromOrder(orderId);

      expect(mockPrisma.invoice.create).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ status: 'draft' });
    });

    it('autoIssue=false (default): creates draft, does not call getExchangeRate', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(kgOrder);
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      mockCalculator.computeLines.mockReturnValue({ lines: [], subtotal: '0.00' });
      mockCalculator.computeTotal.mockReturnValue('0.00');
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-draft', orderId, status: 'draft' });

      await service.createFromOrder(orderId);

      const createCall = mockPrisma.invoice.create.mock.calls[0][0];
      expect(createCall.data.status).toBe('draft');
      expect(createCall.data.issuedAt).toBeUndefined();
      expect(createCall.data.exchangeRateSnapshot).toBeUndefined();
      expect(mockSettings.getExchangeRate).not.toHaveBeenCalled();
    });

    it('autoIssue=true: creates invoice as issued with issuedAt and exchangeRateSnapshot in one write', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(kgOrder);
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      mockCalculator.computeLines.mockReturnValue({
        lines: [{ saleUnit: 'KG', kgQuantity: '2000.000', pricePerKg: '1.20', description: 'shisha Grade A', lineTotal: '2400.00' }],
        subtotal: '2400.00',
      });
      mockCalculator.computeTotal.mockReturnValue('2400.00');
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-issued', orderId, status: 'issued', issuedAt: new Date(), exchangeRateSnapshot: '89550' });

      const result = await service.createFromOrder(orderId, undefined, true);

      expect(mockSettings.getExchangeRate).toHaveBeenCalledTimes(1);
      const createCall = mockPrisma.invoice.create.mock.calls[0][0];
      expect(createCall.data.status).toBe('issued');
      expect(createCall.data.issuedAt).toBeInstanceOf(Date);
      expect(createCall.data.exchangeRateSnapshot).toBe('89550');
      // Single write — no separate update call.
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'issued' });
    });

    it('autoIssue=true: issues an existing draft invoice found by the idempotency guard', async () => {
      const existingDraft = { id: 'existing-draft', orderId, status: 'draft' };
      mockPrisma.clientOrder.findUnique.mockResolvedValue(kgOrder);
      mockPrisma.invoice.findFirst.mockResolvedValue(existingDraft);
      mockPrisma.invoice.update.mockResolvedValue({ ...existingDraft, status: 'issued', issuedAt: new Date(), exchangeRateSnapshot: '89550' });

      const result = await service.createFromOrder(orderId, undefined, true);

      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: existingDraft.id },
          data: expect.objectContaining({
            status: 'issued',
            issuedAt: expect.any(Date),
            exchangeRateSnapshot: '89550',
          }),
        }),
      );
      expect(result).toMatchObject({ status: 'issued' });
    });

    it('autoIssue=true: returns existing issued invoice as-is (idempotent re-delivery)', async () => {
      const existingIssued = { id: 'existing-issued', orderId, status: 'issued' };
      mockPrisma.clientOrder.findUnique.mockResolvedValue(kgOrder);
      mockPrisma.invoice.findFirst.mockResolvedValue(existingIssued);

      const result = await service.createFromOrder(orderId, undefined, true);

      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
      expect(result).toBe(existingIssued);
    });

    it('autoIssue=true with tx: all writes (create + issue) use the tx client', async () => {
      const txMock = {
        clientOrder: { findUnique: jest.fn() as any },
        invoice: { findFirst: jest.fn() as any, create: jest.fn() as any, update: jest.fn() as any },
      };
      txMock.clientOrder.findUnique.mockResolvedValue(kgOrder);
      txMock.invoice.findFirst.mockResolvedValue(null);
      txMock.invoice.create.mockResolvedValue({ id: 'tx-issued', orderId, status: 'issued' });
      mockCalculator.computeLines.mockReturnValue({ lines: [], subtotal: '0.00' });
      mockCalculator.computeTotal.mockReturnValue('0.00');

      await service.createFromOrder(orderId, txMock as any, true);

      expect(txMock.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'issued', exchangeRateSnapshot: '89550' }),
        }),
      );
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('uses the provided transaction client instead of this.prisma when tx is passed', async () => {
      const txMock = {
        clientOrder: { findUnique: jest.fn() as any },
        invoice: { findFirst: jest.fn() as any, create: jest.fn() as any },
      };
      txMock.clientOrder.findUnique.mockResolvedValue(kgOrder);
      txMock.invoice.findFirst.mockResolvedValue(null);
      txMock.invoice.create.mockResolvedValue({ id: 'tx-inv', orderId, status: 'draft' });
      mockCalculator.computeLines.mockReturnValue({ lines: [], subtotal: '0.00' });
      mockCalculator.computeTotal.mockReturnValue('0.00');

      await service.createFromOrder(orderId, txMock as any);

      // All DB calls must go through the tx mock, not this.prisma
      expect(txMock.clientOrder.findUnique).toHaveBeenCalled();
      expect(txMock.invoice.findFirst).toHaveBeenCalled();
      expect(txMock.invoice.create).toHaveBeenCalled();
      expect(mockPrisma.clientOrder.findUnique).not.toHaveBeenCalled();
    });
  });
});

// =========================================================================
// InvoiceCalculatorService — computeLines unit tests (pure function)
// =========================================================================

describe('InvoiceCalculatorService (real instance — no DB calls needed)', () => {
  let calculator: InvoiceCalculatorService;

  // computeLines is pure (no DB calls), so we instantiate with a dummy prisma
  const dummyPrisma = {} as any;

  beforeEach(() => {
    calculator = new InvoiceCalculatorService(dummyPrisma);
  });

  it('computeLines: 100 bags × pricePerBag="2.50" → lineTotal="250.00", subtotal="250.00"', () => {
    const result = calculator.computeLines([
      {
        bagTypeId: 'uuid-bt-1',
        bagTypeName: '2kg',
        qty: 100,
        pricePerBag: '2.50',
      },
    ]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].lineTotal).toBe('250.00');
    expect(result.subtotal).toBe('250.00');
  });

  it('computeLines: multiple lines sum correctly without float drift', () => {
    // 3 × 1.10 = 3.30; 7 × 2.50 = 17.50; subtotal = 20.80
    const result = calculator.computeLines([
      { bagTypeId: 'bt-1', bagTypeName: '1kg', qty: 3, pricePerBag: '1.10' },
      { bagTypeId: 'bt-2', bagTypeName: '2kg', qty: 7, pricePerBag: '2.50' },
    ]);

    expect(result.lines[0].lineTotal).toBe('3.30');
    expect(result.lines[1].lineTotal).toBe('17.50');
    expect(result.subtotal).toBe('20.80');
  });

  it('computeLines: pricePerBag is preserved with 2 decimal places', () => {
    const result = calculator.computeLines([
      { bagTypeId: 'bt-1', bagTypeName: '2kg', qty: 1, pricePerBag: '5' },
    ]);
    const line = result.lines[0] as EnrichedBagLine;
    expect(line.pricePerBag).toBe('5.00');
  });

  // ── Phase 3: BAG line — explicit saleUnit written to output ────────────────

  it('Phase 3 — BAG line without saleUnit: output carries saleUnit:"BAG"', () => {
    const result = calculator.computeLines([
      { bagTypeId: 'bt-1', bagTypeName: '10kg', qty: 5, pricePerBag: '10.00' },
    ]);
    expect(result.lines[0].saleUnit).toBe('BAG');
  });

  it('Phase 3 — BAG line with explicit saleUnit:"BAG": output unchanged', () => {
    const result = calculator.computeLines([
      { saleUnit: 'BAG', bagTypeId: 'bt-1', bagTypeName: '10kg', qty: 5, pricePerBag: '10.00' },
    ]);
    const line = result.lines[0] as EnrichedBagLine;
    expect(line.saleUnit).toBe('BAG');
    expect(line.lineTotal).toBe('50.00');
  });

  // ── Phase 3: KG line ────────────────────────────────────────────────────────

  it('Phase 3 — KG line: lineTotal = kgQuantity × pricePerKg', () => {
    const result = calculator.computeLines([
      { saleUnit: 'KG', kgQuantity: '500.000', description: 'BBQ Hardwood Grade A', pricePerKg: '2.50' },
    ]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].saleUnit).toBe('KG');
    const line = result.lines[0] as EnrichedKgLine;
    expect(line.kgQuantity).toBe('500.000');
    expect(line.pricePerKg).toBe('2.50');
    expect(line.lineTotal).toBe('1250.00');
    expect(result.subtotal).toBe('1250.00');
  });

  it('Phase 3 — KG line: kgQuantity is normalised to 3 decimal places', () => {
    const result = calculator.computeLines([
      { saleUnit: 'KG', kgQuantity: '50', description: 'Shisha Grade A', pricePerKg: '3.00' },
    ]);
    const line = result.lines[0] as EnrichedKgLine;
    expect(line.kgQuantity).toBe('50.000');
    expect(line.lineTotal).toBe('150.00');
  });

  it('Phase 3 — mixed BAG + KG lines: subtotal = sum of both lineTotals', () => {
    // BAG: 10 × 12.00 = 120.00
    // KG:  200 × 2.50 = 500.00
    // subtotal = 620.00
    const result = calculator.computeLines([
      { saleUnit: 'BAG', bagTypeId: 'bt-1', bagTypeName: '25kg Bag', qty: 10, pricePerBag: '12.00' },
      { saleUnit: 'KG', kgQuantity: '200.000', description: 'Restaurant Grade A', pricePerKg: '2.50' },
    ]);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].saleUnit).toBe('BAG');
    expect(result.lines[1].saleUnit).toBe('KG');
    expect((result.lines[0] as EnrichedBagLine).lineTotal).toBe('120.00');
    expect((result.lines[1] as EnrichedKgLine).lineTotal).toBe('500.00');
    expect(result.subtotal).toBe('620.00');
  });

  it('Phase 3 — KG line: no float drift (0.1 + 0.2 = 0.3 exactly)', () => {
    // 100.123 × 3.3 = 330.4059 → toFixed(2) = 330.41
    const result = calculator.computeLines([
      { saleUnit: 'KG', kgQuantity: '100.123', description: 'Test', pricePerKg: '3.3' },
    ]);
    const line = result.lines[0] as EnrichedKgLine;
    expect(line.lineTotal).toBe('330.41');
  });

  it('validateCancellable: throws INVALID_TRANSITION for paid status', () => {
    expect(() =>
      calculator.validateCancellable({ status: 'paid' as any }),
    ).toThrow(BadRequestException);
  });

  it('validateCancellable: throws INVALID_TRANSITION for cancelled status', () => {
    expect(() =>
      calculator.validateCancellable({ status: 'cancelled' as any }),
    ).toThrow(BadRequestException);
  });

  it('validateCancellable: does not throw for issued status', () => {
    expect(() =>
      calculator.validateCancellable({ status: 'issued' as any }),
    ).not.toThrow();
  });

  it('validateIssuable: throws INVALID_TRANSITION for issued status', () => {
    expect(() =>
      calculator.validateIssuable({ status: 'issued' as any }),
    ).toThrow(BadRequestException);
  });

  it('validateIssuable: does not throw for draft status', () => {
    expect(() =>
      calculator.validateIssuable({ status: 'draft' as any }),
    ).not.toThrow();
  });
});

// =========================================================================
// InvoiceLineDto — class-validator DTO tests
// =========================================================================

describe('InvoiceLineDto validation', () => {
  // ── BAG line validation (saleUnit absent → BAG fields required) ───────────

  it('BAG: fails validation when bagTypeId is missing (no saleUnit supplied)', async () => {
    const dto = plainToInstance(InvoiceLineDto, {
      bagTypeName: '2kg',
      qty: 10,
      pricePerBag: '2.50',
    });
    const errors = await validate(dto);
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('bagTypeId');
  });

  it('BAG: fails validation when qty is 0 (Min(1) constraint)', async () => {
    const dto = plainToInstance(InvoiceLineDto, {
      bagTypeId: '550e8400-e29b-41d4-a716-446655440001',
      bagTypeName: '2kg',
      qty: 0,
      pricePerBag: '2.50',
    });
    const errors = await validate(dto);
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('qty');
  });

  it('BAG: fails validation when pricePerBag is a non-numeric string ("free")', async () => {
    const dto = plainToInstance(InvoiceLineDto, {
      bagTypeId: '550e8400-e29b-41d4-a716-446655440001',
      bagTypeName: '2kg',
      qty: 10,
      pricePerBag: 'free',
    });
    const errors = await validate(dto);
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('pricePerBag');
  });

  it('BAG CONSTRAINT 10: passes validation with pricePerBag="999.99" — zero errors', async () => {
    const dto = plainToInstance(InvoiceLineDto, {
      bagTypeId: '550e8400-e29b-41d4-a716-446655440001',
      bagTypeName: '2kg',
      qty: 10,
      pricePerBag: '999.99',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('BAG: explicit saleUnit:"BAG" passes validation — zero errors', async () => {
    const dto = plainToInstance(InvoiceLineDto, {
      saleUnit: 'BAG',
      bagTypeId: '550e8400-e29b-41d4-a716-446655440001',
      bagTypeName: '25kg Standard',
      qty: 50,
      pricePerBag: '12.50',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  // ── KG line validation ────────────────────────────────────────────────────

  it('Phase 3 — KG: passes validation with all KG fields present', async () => {
    const dto = plainToInstance(InvoiceLineDto, {
      saleUnit: 'KG',
      kgQuantity: '500.000',
      description: 'BBQ Hardwood Grade A',
      pricePerKg: '2.50',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('Phase 3 — KG: fails validation when kgQuantity is missing', async () => {
    const dto = plainToInstance(InvoiceLineDto, {
      saleUnit: 'KG',
      description: 'BBQ Hardwood Grade A',
      pricePerKg: '2.50',
    });
    const errors = await validate(dto);
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('kgQuantity');
  });

  it('Phase 3 — KG: fails validation when description is missing', async () => {
    const dto = plainToInstance(InvoiceLineDto, {
      saleUnit: 'KG',
      kgQuantity: '500.000',
      pricePerKg: '2.50',
    });
    const errors = await validate(dto);
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('description');
  });

  it('Phase 3 — KG: fails validation when pricePerKg is a non-numeric string', async () => {
    const dto = plainToInstance(InvoiceLineDto, {
      saleUnit: 'KG',
      kgQuantity: '500.000',
      description: 'BBQ Hardwood Grade A',
      pricePerKg: 'free',
    });
    const errors = await validate(dto);
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('pricePerKg');
  });

  it('Phase 3 — KG: BAG fields are not validated when saleUnit is "KG"', async () => {
    // bagTypeId, bagTypeName, qty, pricePerBag are absent — should not produce errors
    const dto = plainToInstance(InvoiceLineDto, {
      saleUnit: 'KG',
      kgQuantity: '100.000',
      description: 'Shisha Grade A',
      pricePerKg: '3.00',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('Phase 3 — invalid saleUnit value fails validation', async () => {
    const dto = plainToInstance(InvoiceLineDto, {
      saleUnit: 'PALLET',
      bagTypeId: '550e8400-e29b-41d4-a716-446655440001',
      bagTypeName: '2kg',
      qty: 10,
      pricePerBag: '2.50',
    });
    const errors = await validate(dto);
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('saleUnit');
  });
});
