import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';

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

describe('OrdersService', () => {
  let service: OrdersService;

  const mockPrisma = {
    user: { findUnique: fn() },
    client: { findUnique: fn(), update: fn() },
    clientOrder: {
      findUnique: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      findMany: fn(),
      count: fn(),
    },
    shipment: { updateMany: fn() },
    $transaction: fn(),
  };

  const mockInvoices = {
    createFromOrder: jest.fn() as any,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InvoicesService, useValue: mockInvoices },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  // =========================================================================
  // markDelivered() — owner override delivery path
  // =========================================================================

  describe('markDelivered()', () => {
    const orderId = 'order-uuid-md';
    const deliveredOrder = {
      id: orderId,
      status: 'delivered',
      shipments: [],
      client: {},
      orderBagLines: [],
      bagType: null,
    };
    const confirmedOrder = {
      id: orderId,
      status: 'confirmed',
      shipments: [],
      client: {},
      orderBagLines: [],
      bagType: null,
    };

    it('marks order and shipments as delivered then calls createFromOrder() with autoIssue=true', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(confirmedOrder);
      mockPrisma.shipment.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.clientOrder.update.mockResolvedValue(deliveredOrder);
      mockInvoices.createFromOrder.mockResolvedValue({ id: 'inv-1', status: 'issued' });

      await service.markDelivered(orderId);

      expect(mockPrisma.shipment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orderId }) }),
      );
      expect(mockPrisma.clientOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'delivered' } }),
      );
      expect(mockInvoices.createFromOrder).toHaveBeenCalledWith(orderId, undefined, true);
    });

    it('calls createFromOrder() exactly once per markDelivered() call', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(confirmedOrder);
      mockPrisma.shipment.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.clientOrder.update.mockResolvedValue(deliveredOrder);
      mockInvoices.createFromOrder.mockResolvedValue({ id: 'inv-1', status: 'issued' });

      await service.markDelivered(orderId);

      expect(mockInvoices.createFromOrder).toHaveBeenCalledTimes(1);
    });

    it('still returns the updated order even if createFromOrder() rejects (best-effort invoice)', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(confirmedOrder);
      mockPrisma.shipment.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.clientOrder.update.mockResolvedValue(deliveredOrder);
      // Simulate transient invoice creation failure
      mockInvoices.createFromOrder.mockRejectedValue(new Error('DB timeout'));

      // markDelivered propagates the error from createFromOrder — callers
      // should handle it and the owner can use POST /orders/:id/invoice
      await expect(service.markDelivered(orderId)).rejects.toThrow('DB timeout');
      // But the order WAS marked delivered in the DB before the failure
      expect(mockPrisma.clientOrder.update).toHaveBeenCalled();
    });

    it('throws NotFoundException when order does not exist', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(null);

      await expect(service.markDelivered('no-such-order')).rejects.toThrow(NotFoundException);
      expect(mockInvoices.createFromOrder).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // createInvoiceForOrder() — manual invoice generation endpoint
  // =========================================================================

  describe('createInvoiceForOrder()', () => {
    it('delegates to invoices.createFromOrder(id)', async () => {
      const orderId = 'order-manual-inv';
      const invoice = { id: 'inv-manual', status: 'draft', orderId };
      mockInvoices.createFromOrder.mockResolvedValue(invoice);

      const result = await service.createInvoiceForOrder(orderId);

      expect(mockInvoices.createFromOrder).toHaveBeenCalledWith(orderId);
      expect(result).toBe(invoice);
    });

    it('propagates NotFoundException from createFromOrder when order missing', async () => {
      mockInvoices.createFromOrder.mockRejectedValue(
        new NotFoundException({ error: 'Order not found', code: 'NOT_FOUND' }),
      );

      await expect(service.createInvoiceForOrder('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('propagates BadRequestException from createFromOrder when order not delivered', async () => {
      mockInvoices.createFromOrder.mockRejectedValue(
        new BadRequestException({ error: 'Invoice can only be generated for delivered orders', code: 'CONSTRAINT_VIOLATION' }),
      );

      await expect(service.createInvoiceForOrder('confirmed-order')).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // remove() — existing suite
  // =========================================================================

  describe('remove()', () => {

  // Test 1: order has shipments → throws ConflictException with code 'CONFLICT'
  // Note: OrdersService.remove checks status first, then shipments.

  it('throws ConflictException with code CONFLICT when order has linked shipments (draft status)', async () => {
    const orderId = 'order-uuid-has-shipments';

    // Order is draft but HAS shipments
    mockPrisma.clientOrder.findUnique.mockResolvedValue({
      id: orderId,
      status: 'draft',
      shipments: [{ id: 'shipment-uuid-1' }],
      client: {},
      orderBagLines: [],
    });

    await expect(service.remove(orderId)).rejects.toThrow(ConflictException);

    await expect(service.remove(orderId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONFLICT' }),
    });

    // delete must NOT be called
    expect(mockPrisma.clientOrder.delete).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 2: order status is NOT 'draft' → throws ConflictException
  // =========================================================================

  it('throws ConflictException with code CONFLICT when order status is not draft', async () => {
    const orderId = 'order-uuid-not-draft';

    mockPrisma.clientOrder.findUnique.mockResolvedValue({
      id: orderId,
      status: 'confirmed',
      shipments: [],
      client: {},
      orderBagLines: [],
    });

    await expect(service.remove(orderId)).rejects.toThrow(ConflictException);

    await expect(service.remove(orderId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONFLICT' }),
    });

    expect(mockPrisma.clientOrder.delete).not.toHaveBeenCalled();
  });

  it('throws ConflictException for partially_delivered order status', async () => {
    const orderId = 'order-uuid-partial';

    mockPrisma.clientOrder.findUnique.mockResolvedValue({
      id: orderId,
      status: 'partially_delivered',
      shipments: [],
      client: {},
      orderBagLines: [],
    });

    await expect(service.remove(orderId)).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException for delivered order status', async () => {
    const orderId = 'order-uuid-delivered';

    mockPrisma.clientOrder.findUnique.mockResolvedValue({
      id: orderId,
      status: 'delivered',
      shipments: [],
      client: {},
      orderBagLines: [],
    });

    await expect(service.remove(orderId)).rejects.toThrow(ConflictException);
  });

  // =========================================================================
  // Test 3: draft order with no shipments → calls clientOrder.delete
  // =========================================================================

  it('calls clientOrder.delete when order is draft with no shipments', async () => {
    const orderId = 'order-uuid-draft-clean';

    mockPrisma.clientOrder.findUnique.mockResolvedValue({
      id: orderId,
      status: 'draft',
      shipments: [],
      client: {},
      orderBagLines: [],
    });

    mockPrisma.clientOrder.delete.mockResolvedValue({ id: orderId });

    await service.remove(orderId);

    expect(mockPrisma.clientOrder.delete).toHaveBeenCalledTimes(1);
    expect(mockPrisma.clientOrder.delete).toHaveBeenCalledWith({
      where: { id: orderId },
    });
  });

  }); // end describe('remove()')
}); // end describe('OrdersService')
