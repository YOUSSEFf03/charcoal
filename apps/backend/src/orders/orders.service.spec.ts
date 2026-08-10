import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

// ---------------------------------------------------------------------------
// Shared mock factory helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

function foreignKeyError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
    code: 'P2003',
    clientVersion: 'test',
  });
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
    // Models Prisma's array-form $transaction: submits every operation
    // together and, like a real transaction, rejects (rolling back) as soon
    // as any one of them rejects — mirrored here via Promise.all.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockPrisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));

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

    // -----------------------------------------------------------------------
    // Finding #2 remediation: shipment.updateMany + clientOrder.update are now
    // wrapped in a single $transaction, so a failure partway through can never
    // leave shipments delivered while the order status is stale (or vice versa).
    // -----------------------------------------------------------------------

    it('transaction: submits shipment.updateMany and clientOrder.update together in one $transaction call', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(confirmedOrder);
      mockPrisma.shipment.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.clientOrder.update.mockResolvedValue(deliveredOrder);
      mockInvoices.createFromOrder.mockResolvedValue({ id: 'inv-1', status: 'issued' });

      const result = await service.markDelivered(orderId);

      // Exactly one $transaction call, carrying both writes as a single array —
      // proving they are submitted atomically rather than as two independent calls.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const submittedOps = mockPrisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(submittedOps)).toBe(true);
      expect(submittedOps).toHaveLength(2);
      expect(result).toEqual(deliveredOrder);
    });

    it('transaction: a failure in the order-status write rolls back — shipments are never left delivered on their own, and invoice creation is never reached', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(confirmedOrder);
      // shipment.updateMany itself "succeeds" in isolation, but because both
      // writes are submitted inside the same $transaction (modelled as
      // Promise.all below), the failing clientOrder.update rolls the whole
      // transaction back rather than letting the shipment write stand alone.
      mockPrisma.shipment.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.clientOrder.update.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.markDelivered(orderId)).rejects.toThrow('DB connection lost');

      // Both writes were requested inside the same transaction call...
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // ...and because the transaction as a whole rejected, execution never
      // reached the post-transaction invoice step.
      expect(mockInvoices.createFromOrder).not.toHaveBeenCalled();
    });

    it('invoice creation still runs exactly once, after the transaction settles, unchanged from prior behavior', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(confirmedOrder);
      mockPrisma.shipment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.clientOrder.update.mockResolvedValue(deliveredOrder);
      mockInvoices.createFromOrder.mockResolvedValue({ id: 'inv-1', status: 'issued' });

      await service.markDelivered(orderId);

      const transactionOrder = mockPrisma.$transaction.mock.invocationCallOrder[0];
      const invoiceOrder = mockInvoices.createFromOrder.mock.invocationCallOrder[0];
      expect(transactionOrder).toBeLessThan(invoiceOrder);
      expect(mockInvoices.createFromOrder).toHaveBeenCalledTimes(1);
      expect(mockInvoices.createFromOrder).toHaveBeenCalledWith(orderId, undefined, true);
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
  // create() — order creation + client.lastOrderDate/avgOrderDays side-effects
  // =========================================================================

  describe('create()', () => {
    const userId = 'clerk-user-1';
    const dbUser = { id: 'db-user-1', clerkId: userId };
    const baseDto = {
      clientId: 'client-1',
      charcoalType: 'coconut',
      grade: 'A',
      totalKgRequested: '500.000',
      pricePerBag: '850.00',
      currency: 'USD',
    };

    it('successful creation: passes through all provided fields and returns the created order', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'client-1', lastOrderDate: null, avgOrderDays: null });
      const createdOrder = { id: 'order-new-1', ...baseDto };
      mockPrisma.clientOrder.create.mockResolvedValue(createdOrder);
      mockPrisma.client.update.mockResolvedValue({ id: 'client-1' });

      const dto = {
        ...baseDto,
        bagTypeId: 'bagtype-1',
        notes: 'urgent',
        driverId: 'driver-1',
        supplierName: 'Acme Charcoal',
      };

      const result = await service.create(dto as CreateOrderDto, userId);

      expect(mockPrisma.clientOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientId: 'client-1',
            charcoalType: 'coconut',
            grade: 'A',
            totalKgRequested: '500.000',
            bagTypeId: 'bagtype-1',
            pricePerBag: '850.00',
            currency: 'USD',
            createdById: 'db-user-1',
            notes: 'urgent',
            driverId: 'driver-1',
            supplierName: 'Acme Charcoal',
          }),
        }),
      );
      expect(result).toBe(createdOrder);
    });

    it('client not found: throws NotFoundException and never opens a transaction', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      mockPrisma.client.findUnique.mockResolvedValue(null);

      await expect(service.create(baseDto as CreateOrderDto, userId)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.clientOrder.create).not.toHaveBeenCalled();
    });

    it('authenticated user not found: throws NotFoundException before ever checking the client', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.create(baseDto as CreateOrderDto, userId)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.client.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('first order: client has no lastOrderDate — avgOrderDays is not written, only lastOrderDate', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'client-1', lastOrderDate: null, avgOrderDays: null });
      mockPrisma.clientOrder.create.mockResolvedValue({ id: 'order-new-2' });
      mockPrisma.client.update.mockResolvedValue({ id: 'client-1' });

      await service.create(baseDto as CreateOrderDto, userId);

      const clientUpdateCall = mockPrisma.client.update.mock.calls[0][0];
      expect(clientUpdateCall.data).toHaveProperty('lastOrderDate');
      expect(clientUpdateCall.data).not.toHaveProperty('avgOrderDays');
    });

    it('rolling average: blends the prior avgOrderDays with the new gap since lastOrderDate', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-06T00:00:00.000Z'));
      try {
        // lastOrderDate was 10 days before "now"; prior rolling average was 6 days.
        const lastOrderDate = new Date('2026-06-26T00:00:00.000Z');
        mockPrisma.user.findUnique.mockResolvedValue(dbUser);
        mockPrisma.client.findUnique.mockResolvedValue({ id: 'client-1', lastOrderDate, avgOrderDays: 6 });
        mockPrisma.clientOrder.create.mockResolvedValue({ id: 'order-new-3' });
        mockPrisma.client.update.mockResolvedValue({ id: 'client-1' });

        await service.create(baseDto as CreateOrderDto, userId);

        // daysDiff = 10, oldAvg = 6 → newAvg = (6 + 10) / 2 = 8.00
        const clientUpdateCall = mockPrisma.client.update.mock.calls[0][0];
        expect(clientUpdateCall.data.avgOrderDays).toBe('8.00');
        expect(clientUpdateCall.data.lastOrderDate).toEqual(new Date('2026-07-06T00:00:00.000Z'));
      } finally {
        jest.useRealTimers();
      }
    });

    it('transaction: creates the order and updates the client together in one $transaction call', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'client-1', lastOrderDate: null, avgOrderDays: null });
      mockPrisma.clientOrder.create.mockResolvedValue({ id: 'order-new-4' });
      mockPrisma.client.update.mockResolvedValue({ id: 'client-1' });

      await service.create(baseDto as CreateOrderDto, userId);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const submittedOps = mockPrisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(submittedOps)).toBe(true);
      expect(submittedOps).toHaveLength(2);
    });

    it('transaction: if the client-update half fails, create() rejects (order creation does not stand alone)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'client-1', lastOrderDate: null, avgOrderDays: null });
      mockPrisma.clientOrder.create.mockResolvedValue({ id: 'order-new-5' });
      mockPrisma.client.update.mockRejectedValue(new Error('DB write failed'));

      await expect(service.create(baseDto as CreateOrderDto, userId)).rejects.toThrow('DB write failed');
    });
  });

  // =========================================================================
  // findAll() — paginated, filterable order listing
  // =========================================================================

  describe('findAll()', () => {
    beforeEach(() => {
      mockPrisma.clientOrder.findMany.mockResolvedValue([]);
      mockPrisma.clientOrder.count.mockResolvedValue(0);
    });

    it('pagination: page 2 with limit 10 skips the first 10 rows', async () => {
      await service.findAll(2, 10);

      expect(mockPrisma.clientOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('sorting: orders by createdAt descending (newest first), a @@index-backed field — stable across pages', async () => {
      await service.findAll(1, 20);

      expect(mockPrisma.clientOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('list query stays lightweight: only client (id/name) and bagType (id/name/nominalKg) are included — no shipments/invoices/driver/bagLines on the list endpoint', async () => {
      await service.findAll(1, 20);

      const call = mockPrisma.clientOrder.findMany.mock.calls[0][0];
      expect(call.include).toEqual({
        client: { select: { id: true, name: true } },
        bagType: { select: { id: true, name: true, nominalKg: true } },
      });
    });

    it('count() always runs with the SAME where filter as findMany() — total reflects the filtered set, not the whole table', async () => {
      mockPrisma.clientOrder.findMany.mockResolvedValue([{ id: 'o1' }]);
      mockPrisma.clientOrder.count.mockResolvedValue(1);

      await service.findAll(1, 20, undefined, 'confirmed' as OrderStatus);

      expect(mockPrisma.clientOrder.count).toHaveBeenCalledWith({ where: { status: 'confirmed' } });
    });

    it('client filter: adds clientId to the where clause', async () => {
      await service.findAll(1, 20, 'client-42');

      expect(mockPrisma.clientOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clientId: 'client-42' } }),
      );
    });

    it('status filter: adds status to the where clause', async () => {
      await service.findAll(1, 20, undefined, 'confirmed' as OrderStatus);

      expect(mockPrisma.clientOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'confirmed' } }),
      );
    });

    it('search filter: adds a case-insensitive client-name contains clause', async () => {
      await service.findAll(1, 20, undefined, undefined, 'acme');

      expect(mockPrisma.clientOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { client: { name: { contains: 'acme', mode: 'insensitive' } } },
        }),
      );
    });

    it('combined filters: clientId + status + search all apply together', async () => {
      const data = [{ id: 'o1' }];
      mockPrisma.clientOrder.findMany.mockResolvedValue(data);
      mockPrisma.clientOrder.count.mockResolvedValue(1);

      const result = await service.findAll(1, 20, 'client-42', 'draft' as OrderStatus, 'acme');

      expect(mockPrisma.clientOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            clientId: 'client-42',
            status: 'draft',
            client: { name: { contains: 'acme', mode: 'insensitive' } },
          },
        }),
      );
      expect(result).toEqual({ data, total: 1, page: 1, limit: 20 });
    });

    it('empty results: returns an empty data array with total 0', async () => {
      const result = await service.findAll(1, 20);

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });
  });

  // =========================================================================
  // findOne() — single order with client/driver/shipments/bagLines/invoices
  // =========================================================================

  describe('findOne()', () => {
    it('success: returns the order with the bagLines alias set from orderBagLines', async () => {
      const bagLines = [{ id: 'obl-1', bagTypeId: 'bt-1', quantity: 5 }];
      mockPrisma.clientOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'draft',
        orderBagLines: bagLines,
      });

      const result = await service.findOne('order-1');

      expect(result.orderBagLines).toBe(bagLines);
      expect(result.bagLines).toBe(bagLines);
    });

    it('not found: throws NotFoundException with code NOT_FOUND', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-order')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_FOUND' }),
      });
    });

    it('verifies the exact set of included relations requested from Prisma', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue({ id: 'order-1', orderBagLines: [] });

      await service.findOne('order-1');

      expect(mockPrisma.clientOrder.findUnique).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        include: {
          client: true,
          driver: { select: { id: true, name: true } },
          bagType: { select: { id: true, name: true, nominalKg: true } },
          shipments: { include: { bags: { include: { bagType: true } } } },
          orderBagLines: { include: { bagType: true } },
          invoices: true,
        },
      });
    });

    it('bagLines alias: an empty orderBagLines array is aliased to an empty bagLines array, not omitted', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue({ id: 'order-1', orderBagLines: [] });

      const result = await service.findOne('order-1');

      expect(result.bagLines).toEqual([]);
      expect('bagLines' in result).toBe(true);
    });
  });

  // =========================================================================
  // update() — protected-field lock once an order leaves 'draft'
  // (Finding #1 remediation: clientId, pricePerBag, currency,
  // totalKgRequested, bagTypeId may only change while status === 'draft')
  // =========================================================================

  describe('update()', () => {
    function orderWith(status: string) {
      return {
        id: 'order-uuid-upd',
        status,
        shipments: [],
        client: {},
        orderBagLines: [],
        bagType: null,
      };
    }

    it('draft order: a protected field (pricePerBag) updates successfully', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith('draft'));
      mockPrisma.clientOrder.update.mockResolvedValue({ id: 'order-uuid-upd', pricePerBag: '900.00' });

      await service.update('order-uuid-upd', { pricePerBag: '900.00' } as UpdateOrderDto);

      expect(mockPrisma.clientOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-uuid-upd' },
        data: { pricePerBag: '900.00' },
      });
    });

    it.each(['confirmed', 'partially_delivered', 'delivered', 'invoiced'])(
      '%s order: rejects a protected field change with ConflictException(code CONFLICT)',
      async (status) => {
        mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith(status));

        await expect(
          service.update('order-uuid-upd', { pricePerBag: '900.00' } as UpdateOrderDto),
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
          service.update('order-uuid-upd', { pricePerBag: '900.00' } as UpdateOrderDto),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CONFLICT' }) });

        expect(mockPrisma.clientOrder.update).not.toHaveBeenCalled();
      },
    );

    it.each(['clientId', 'pricePerBag', 'currency', 'totalKgRequested', 'bagTypeId'])(
      'confirmed order: rejects when %s alone is included',
      async (field) => {
        mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith('confirmed'));

        await expect(
          service.update('order-uuid-upd', { [field]: 'x' } as unknown as UpdateOrderDto),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(mockPrisma.clientOrder.update).not.toHaveBeenCalled();
      },
    );

    it('confirmed order: mixing a protected field with an allowed field rejects the whole update', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith('confirmed'));

      await expect(
        service.update('order-uuid-upd', { notes: 'urgent', currency: 'LBP' } as UpdateOrderDto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.clientOrder.update).not.toHaveBeenCalled();
    });

    it('confirmed order: allowed fields (notes, driverId, supplierName, charcoalType, grade) still update successfully', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith('confirmed'));
      mockPrisma.clientOrder.update.mockResolvedValue({ id: 'order-uuid-upd', notes: 'urgent' });

      await service.update('order-uuid-upd', {
        notes: 'urgent',
        driverId: 'driver-uuid-1',
        supplierName: 'Acme Charcoal',
        charcoalType: 'coconut',
        grade: 'B',
      } as UpdateOrderDto);

      expect(mockPrisma.clientOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-uuid-upd' },
        data: {
          charcoalType: 'coconut',
          grade: 'B',
          notes: 'urgent',
          driverId: 'driver-uuid-1',
          supplierName: 'Acme Charcoal',
        },
      });
    });

    it('delivered order: an empty/no-op update (no protected fields present) still succeeds', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith('delivered'));
      mockPrisma.clientOrder.update.mockResolvedValue({ id: 'order-uuid-upd' });

      await expect(service.update('order-uuid-upd', {} as UpdateOrderDto)).resolves.toBeDefined();
      expect(mockPrisma.clientOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-uuid-upd' },
        data: {},
      });
    });

    // -----------------------------------------------------------------------
    // Finding #4 remediation: partial-update whitelisting behavior
    // -----------------------------------------------------------------------

    it('partial update: only the single provided field (grade) is written, nothing else', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith('draft'));
      mockPrisma.clientOrder.update.mockResolvedValue({ id: 'order-uuid-upd', grade: 'C' });

      await service.update('order-uuid-upd', { grade: 'C' } as UpdateOrderDto);

      expect(mockPrisma.clientOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-uuid-upd' },
        data: { grade: 'C' },
      });
    });

    it('explicit null clearing: notes: null is written as null, not omitted', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith('confirmed'));
      mockPrisma.clientOrder.update.mockResolvedValue({ id: 'order-uuid-upd', notes: null });

      await service.update('order-uuid-upd', { notes: null } as unknown as UpdateOrderDto);

      expect(mockPrisma.clientOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-uuid-upd' },
        data: { notes: null },
      });
    });

    it('explicit null clearing: bagTypeId: null on a draft order clears the bag-type reference', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith('draft'));
      mockPrisma.clientOrder.update.mockResolvedValue({ id: 'order-uuid-upd', bagTypeId: null });

      await service.update('order-uuid-upd', { bagTypeId: null } as unknown as UpdateOrderDto);

      expect(mockPrisma.clientOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-uuid-upd' },
        data: { bagTypeId: null },
      });
    });

    it('unchanged fields: fields absent from the DTO never appear in the write payload', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith('draft'));
      mockPrisma.clientOrder.update.mockResolvedValue({ id: 'order-uuid-upd' });

      await service.update('order-uuid-upd', { grade: 'B', notes: 'hello' } as UpdateOrderDto);

      const writtenData = mockPrisma.clientOrder.update.mock.calls[0][0].data;
      expect(Object.keys(writtenData).sort()).toEqual(['grade', 'notes']);
      expect(writtenData).not.toHaveProperty('clientId');
      expect(writtenData).not.toHaveProperty('pricePerBag');
      expect(writtenData).not.toHaveProperty('currency');
      expect(writtenData).not.toHaveProperty('totalKgRequested');
      expect(writtenData).not.toHaveProperty('bagTypeId');
      expect(writtenData).not.toHaveProperty('driverId');
      expect(writtenData).not.toHaveProperty('supplierName');
      expect(writtenData).not.toHaveProperty('charcoalType');
    });

    it('draft order: every allowed and protected field can be updated together in a single call', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith('draft'));
      const fullDto = {
        clientId: 'client-2',
        charcoalType: 'hardwood',
        grade: 'B',
        totalKgRequested: '750.000',
        bagTypeId: 'bagtype-2',
        pricePerBag: '920.00',
        currency: 'LBP',
        notes: 'rush order',
        driverId: 'driver-2',
        supplierName: 'New Supplier',
      };
      mockPrisma.clientOrder.update.mockResolvedValue({ id: 'order-uuid-upd', ...fullDto });

      await service.update('order-uuid-upd', fullDto as UpdateOrderDto);

      expect(mockPrisma.clientOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-uuid-upd' },
        data: fullDto,
      });
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

  // =========================================================================
  // Finding #3 remediation: a raw P2003 from delete() itself — e.g. a
  // shipment/stock-exit/invoice created in the narrow window between the
  // status/shipments checks above and the delete call — is now translated
  // into the same clean 409 instead of leaking as an unhandled 500.
  // =========================================================================

  it('defense in depth: converts a raw P2003 from delete() into a 409, not an unhandled error', async () => {
    const orderId = 'order-uuid-race';

    // Checks pass: draft status, no shipments known at check time...
    mockPrisma.clientOrder.findUnique.mockResolvedValue({
      id: orderId,
      status: 'draft',
      shipments: [],
      client: {},
      orderBagLines: [],
    });
    // ...but the delete itself still hits a foreign-key constraint, e.g. a
    // shipment/stock-exit/invoice created for this order after the checks ran.
    mockPrisma.clientOrder.delete.mockRejectedValue(foreignKeyError());

    await expect(service.remove(orderId)).rejects.toThrow(ConflictException);
    await expect(service.remove(orderId)).rejects.toMatchObject({
      response: { error: 'Order has linked shipments and cannot be deleted', code: 'CONFLICT' },
    });
  });

  it('re-throws a non-P2003 error from delete() unchanged (not swallowed as a 409)', async () => {
    const orderId = 'order-uuid-db-error';

    mockPrisma.clientOrder.findUnique.mockResolvedValue({
      id: orderId,
      status: 'draft',
      shipments: [],
      client: {},
      orderBagLines: [],
    });
    const otherError = new Error('connection lost');
    mockPrisma.clientOrder.delete.mockRejectedValue(otherError);

    await expect(service.remove(orderId)).rejects.toBe(otherError);
  });

  }); // end describe('remove()')
}); // end describe('OrdersService')
