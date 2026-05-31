import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InvoicesService } from './invoices.service';
import { InvoiceCalculatorService } from './invoice-calculator.service';
import { PrismaService } from '../prisma/prisma.service';
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

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InvoiceCalculatorService, useValue: mockCalculator },
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
          }),
        }),
      );
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
    expect(result.lines[0].pricePerBag).toBe('5.00');
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
  it('fails validation when bagTypeId is missing', async () => {
    const dto = plainToInstance(InvoiceLineDto, {
      bagTypeName: '2kg',
      qty: 10,
      pricePerBag: '2.50',
    });
    const errors = await validate(dto);
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('bagTypeId');
  });

  it('fails validation when qty is 0 (Min(1) constraint)', async () => {
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

  it('fails validation when pricePerBag is a non-numeric string ("free")', async () => {
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

  it('CONSTRAINT 10: passes validation with pricePerBag="999.99" — zero errors', async () => {
    const dto = plainToInstance(InvoiceLineDto, {
      bagTypeId: '550e8400-e29b-41d4-a716-446655440001',
      bagTypeName: '2kg',
      qty: 10,
      pricePerBag: '999.99',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
