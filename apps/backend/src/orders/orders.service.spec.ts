import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { ShipmentsService } from '../shipments/shipments.service';
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
// markDelivered() stock-drain fixtures
//
// A real ShipmentsService instance (not a mock) is used for these tests so
// markDelivered() exercises ShipmentsService.drainShipment()'s actual logic —
// the same method ShipmentsService.confirmDelivery() uses — rather than
// asserting it was merely "called". drainShipment() only ever touches the
// `tx` argument passed to it, so ShipmentsService's other constructor
// dependencies (InvoicesService, PaymentAllocationService, LedgerWriteService,
// UsersService) are never invoked here and can stay unused stubs.
// ---------------------------------------------------------------------------

interface PsRow {
  id: string;
  bagTypeId: string;
  quantity: number;
  reservedQuantity: number;
  createdAt: Date;
}
interface ResRow {
  id: string;
  shipmentId: string;
  packedStockId: string;
  quantity: number;
}
interface ShipRow {
  id: string;
  orderId: string;
  status: string;
}

/**
 * Minimal in-transaction store covering exactly what
 * OrdersService.markDelivered() + ShipmentsService.drainShipment() touch:
 * packed_stocks, shipment_reservations, stock_exits, shipments, and the
 * order-status write. Modelled on shipments.service.spec.ts's makeStore().
 */
function makeDeliveryTx(
  packedRows: PsRow[],
  shipRows: ShipRow[],
  resRows: ResRow[],
  // Optional fixture for the no-shipment direct-deduction path's inside-tx
  // re-fetch (tx.clientOrder.findUnique) — only needed by tests that exercise
  // that branch (activeShipments.length === 0).
  orderFixture?: { id: string; bagTypeId: string | null; totalKgRequested: string; bagType: { nominalKg: string } | null },
) {
  const packed: PsRow[] = packedRows.map((r) => ({ ...r }));
  const reservations: ResRow[] = resRows.map((r) => ({ ...r }));
  const shipments = new Map<string, ShipRow>(shipRows.map((s) => [s.id, { ...s }]));

  const tx: any = {
    _packed: packed,
    _reservations: reservations,
    _shipments: shipments,
    $queryRaw: fn().mockResolvedValue([]),
    packedStock: {
      update: fn().mockImplementation(async (args: any) => {
        const row = packed.find((r) => r.id === args.where.id)!;
        if (args.data.quantity?.decrement != null) row.quantity -= args.data.quantity.decrement;
        if (args.data.reservedQuantity?.decrement != null) row.reservedQuantity -= args.data.reservedQuantity.decrement;
        return row;
      }),
    },
    shipmentReservation: {
      delete: fn().mockImplementation(async (args: any) => {
        const idx = reservations.findIndex((r) => r.id === args.where.id);
        if (idx >= 0) reservations.splice(idx, 1);
        return {};
      }),
    },
    stockExit: { create: fn().mockResolvedValue({}) },
    shipment: {
      findUnique: fn().mockImplementation(async (args: any) => {
        const s = shipments.get(args.where.id);
        if (!s) return null;
        const myRes = reservations
          .filter((r) => r.shipmentId === s.id)
          .map((r) => ({ ...r, packedStock: packed.find((p) => p.id === r.packedStockId)! }));
        return { ...s, reservations: myRes };
      }),
      update: fn().mockImplementation(async (args: any) => {
        const s = shipments.get(args.where.id);
        if (s) Object.assign(s, args.data);
        return s;
      }),
    },
    clientOrder: {
      update: fn().mockResolvedValue({ id: 'updated-order', status: 'delivered' }),
      findUnique: fn().mockResolvedValue(orderFixture ?? null),
    },
  };
  return tx;
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

  // Real ShipmentsService — see the "markDelivered() stock-drain fixtures"
  // comment above makeDeliveryTx() for why this isn't a mock. Its own
  // constructor dependencies are never exercised by drainShipment(); only
  // drainPackedStockDirect() (the no-shipment path) touches packedStockService,
  // via getFifoDraw() — mocked here so its plan can be controlled per test
  // without re-deriving PackedStockService's own FIFO logic (already covered
  // by packed-stock.service.spec.ts).
  const mockPackedStockService = { getFifoDraw: jest.fn() as any };
  const realShipmentsService = new ShipmentsService(
    {} as any, // PrismaService — unused by drainShipment()/drainPackedStockDirect(), which only touch their `tx` arg
    {} as any, // InvoicesService
    {} as any, // PaymentAllocationService
    {} as any, // LedgerWriteService
    {} as any, // UsersService
    mockPackedStockService as any, // PackedStockService
  );

  beforeEach(async () => {
    jest.clearAllMocks();
    // Models Prisma's array-form $transaction: submits every operation
    // together and, like a real transaction, rejects (rolling back) as soon
    // as any one of them rejects — mirrored here via Promise.all. markDelivered()
    // tests override this per-test with a callback-form implementation (see
    // makeDeliveryTx() usage below), matching the callback-form $transaction it
    // actually uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockPrisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InvoicesService, useValue: mockInvoices },
        { provide: ShipmentsService, useValue: realShipmentsService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  // =========================================================================
  // markDelivered() — owner override delivery path
  // =========================================================================

  describe('markDelivered()', () => {
    const orderId = 'order-uuid-md';
    const clerkUserId = 'clerk-owner-1';
    const internalUserId = 'db-user-owner-1';

    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: internalUserId, clerkId: clerkUserId });
      mockInvoices.createFromOrder.mockResolvedValue({ id: 'inv-1', status: 'issued' });
    });

    function orderWith(shipments: Array<{ id: string; status: string }>) {
      return {
        id: orderId,
        status: 'confirmed',
        shipments,
        client: {},
        orderBagLines: [],
        bagType: null,
      };
    }

    // No-shipment order fixture — bagTypeId + totalKgRequested + bagType.nominalKg
    // drive the same qty formula InvoicesService.createFromOrder() uses.
    function noShipOrder(bagTypeId: string, totalKgRequested: string, nominalKg: string, status = 'confirmed') {
      return {
        id: orderId,
        status,
        shipments: [] as Array<{ id: string; status: string }>,
        client: {},
        orderBagLines: [],
        bagTypeId,
        totalKgRequested,
        bagType: { nominalKg },
      };
    }

    // -----------------------------------------------------------------------
    // BUG fix (Order→Sale stock desync): markDelivered() must actually drain
    // packed stock through ShipmentsService.drainShipment() — the same logic
    // ShipmentsService.confirmDelivery() uses — not just flip status columns.
    // -----------------------------------------------------------------------

    it('[edge case A] single shipment, single reservation: decrements PackedStock.quantity/reservedQuantity exactly once, consumes the reservation, creates one StockExit, and still issues the invoice', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith([{ id: 'ship-1', status: 'pending' }]));
      const tx = makeDeliveryTx(
        [{ id: 'ps-1', bagTypeId: 'bt-1', quantity: 100, reservedQuantity: 20, createdAt: new Date('2024-01-01') }],
        [{ id: 'ship-1', orderId, status: 'pending' }],
        [{ id: 'res-1', shipmentId: 'ship-1', packedStockId: 'ps-1', quantity: 20 }],
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.markDelivered(orderId, clerkUserId);

      // 1) PackedStock.quantity decremented exactly once, by the reserved amount.
      expect(tx.packedStock.update).toHaveBeenCalledTimes(1);
      expect(tx._packed[0]).toMatchObject({ quantity: 80, reservedQuantity: 0 });
      // 2) ShipmentReservation consumed.
      expect(tx._reservations).toHaveLength(0);
      // 3) reservedQuantity decremented correctly (asserted above: 20 → 0).
      // 4) StockExit created with the required fields.
      expect(tx.stockExit.create).toHaveBeenCalledTimes(1);
      expect(tx.stockExit.create.mock.calls[0][0].data).toMatchObject({
        exitType: 'order',
        packedStockId: 'ps-1',
        quantity: 20,
        orderId,
        loggedById: internalUserId,
      });
      // Shipment and order both finalized as delivered.
      expect(tx._shipments.get('ship-1')?.status).toBe('delivered');
      expect(tx.clientOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: orderId }, data: { status: 'delivered' } }),
      );
      // 5) Invoice still created/issued after successful physical delivery.
      expect(mockInvoices.createFromOrder).toHaveBeenCalledWith(orderId, undefined, true);
    });

    it('[edge case B / task 7] multiple reservations across multiple PackedStock rows are each drained exactly once, each with its own StockExit', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith([{ id: 'ship-1', status: 'loaded' }]));
      const tx = makeDeliveryTx(
        [
          { id: 'ps-a', bagTypeId: 'bt-a', quantity: 100, reservedQuantity: 30, createdAt: new Date('2024-01-01') },
          { id: 'ps-b', bagTypeId: 'bt-b', quantity: 50, reservedQuantity: 10, createdAt: new Date('2024-01-02') },
        ],
        [{ id: 'ship-1', orderId, status: 'loaded' }],
        [
          { id: 'res-a', shipmentId: 'ship-1', packedStockId: 'ps-a', quantity: 30 },
          { id: 'res-b', shipmentId: 'ship-1', packedStockId: 'ps-b', quantity: 10 },
        ],
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.markDelivered(orderId, clerkUserId);

      expect(tx._packed.find((p: PsRow) => p.id === 'ps-a')).toMatchObject({ quantity: 70, reservedQuantity: 0 });
      expect(tx._packed.find((p: PsRow) => p.id === 'ps-b')).toMatchObject({ quantity: 40, reservedQuantity: 0 });
      expect(tx._reservations).toHaveLength(0);
      expect(tx.stockExit.create).toHaveBeenCalledTimes(2);
      const exitedIds = tx.stockExit.create.mock.calls.map((c: any) => c[0].data.packedStockId).sort();
      expect(exitedIds).toEqual(['ps-a', 'ps-b']);
    });

    it('[edge case C] multiple shipments on one order: every eligible shipment is processed exactly once', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(
        orderWith([{ id: 'ship-1', status: 'pending' }, { id: 'ship-2', status: 'pending' }]),
      );
      const tx = makeDeliveryTx(
        [
          { id: 'ps-1', bagTypeId: 'bt-1', quantity: 50, reservedQuantity: 10, createdAt: new Date('2024-01-01') },
          { id: 'ps-2', bagTypeId: 'bt-2', quantity: 30, reservedQuantity: 5, createdAt: new Date('2024-01-01') },
        ],
        [{ id: 'ship-1', orderId, status: 'pending' }, { id: 'ship-2', orderId, status: 'pending' }],
        [
          { id: 'res-1', shipmentId: 'ship-1', packedStockId: 'ps-1', quantity: 10 },
          { id: 'res-2', shipmentId: 'ship-2', packedStockId: 'ps-2', quantity: 5 },
        ],
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.markDelivered(orderId, clerkUserId);

      expect(tx._shipments.get('ship-1')?.status).toBe('delivered');
      expect(tx._shipments.get('ship-2')?.status).toBe('delivered');
      expect(tx._packed.find((p: PsRow) => p.id === 'ps-1')).toMatchObject({ quantity: 40, reservedQuantity: 0 });
      expect(tx._packed.find((p: PsRow) => p.id === 'ps-2')).toMatchObject({ quantity: 25, reservedQuantity: 0 });
      expect(tx.stockExit.create).toHaveBeenCalledTimes(2);
      expect(tx.clientOrder.update).toHaveBeenCalledTimes(1);
    });

    it('[edge case D / task 8] a cancelled shipment is never fetched or drained', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(
        orderWith([{ id: 'ship-cancelled', status: 'cancelled' }, { id: 'ship-active', status: 'pending' }]),
      );
      const tx = makeDeliveryTx(
        [{ id: 'ps-1', bagTypeId: 'bt-1', quantity: 50, reservedQuantity: 10, createdAt: new Date('2024-01-01') }],
        [{ id: 'ship-cancelled', orderId, status: 'cancelled' }, { id: 'ship-active', orderId, status: 'pending' }],
        [{ id: 'res-1', shipmentId: 'ship-active', packedStockId: 'ps-1', quantity: 10 }],
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.markDelivered(orderId, clerkUserId);

      // The cancelled shipment was excluded before the transaction even opened —
      // the only shipment.findUnique call inside tx is for the active one.
      expect(tx.shipment.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.shipment.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ship-active' } }));
      expect(tx._shipments.get('ship-cancelled')?.status).toBe('cancelled');
      expect(tx._packed[0]).toMatchObject({ quantity: 40, reservedQuantity: 0 });
    });

    it('[edge case E / task 6] insufficient/inconsistent stock fails the transaction safely — no invoice issued, order not advanced, no partial drain', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith([{ id: 'ship-1', status: 'pending' }]));
      // Corrupted state: reservation asks for more than the row physically has.
      const tx = makeDeliveryTx(
        [{ id: 'ps-1', bagTypeId: 'bt-1', quantity: 5, reservedQuantity: 5, createdAt: new Date('2024-01-01') }],
        [{ id: 'ship-1', orderId, status: 'pending' }],
        [{ id: 'res-1', shipmentId: 'ship-1', packedStockId: 'ps-1', quantity: 20 }],
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.markDelivered(orderId, clerkUserId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });

      // Nothing was drained, the shipment/order were never finalized, and the
      // invoice — which would otherwise auto-issue — is never reached.
      expect(tx.packedStock.update).not.toHaveBeenCalled();
      expect(tx.stockExit.create).not.toHaveBeenCalled();
      expect(tx.clientOrder.update).not.toHaveBeenCalled();
      expect(mockInvoices.createFromOrder).not.toHaveBeenCalled();
    });

    it('[edge case F / task 9] an already-delivered shipment is skipped entirely — no double deduction', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith([{ id: 'ship-1', status: 'delivered' }]));
      const tx = makeDeliveryTx(
        [{ id: 'ps-1', bagTypeId: 'bt-1', quantity: 80, reservedQuantity: 0, createdAt: new Date('2024-01-01') }],
        [{ id: 'ship-1', orderId, status: 'delivered' }],
        [], // reservation already consumed by the original delivery
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.markDelivered(orderId, clerkUserId);

      // Already-delivered shipments are filtered out before any tx read/write.
      expect(tx.shipment.findUnique).not.toHaveBeenCalled();
      expect(tx.packedStock.update).not.toHaveBeenCalled();
      expect(tx.stockExit.create).not.toHaveBeenCalled();
      expect(tx._packed[0].quantity).toBe(80); // unchanged
      // The order is still finalized / invoice still (idempotently) generated.
      expect(tx.clientOrder.update).toHaveBeenCalled();
      expect(mockInvoices.createFromOrder).toHaveBeenCalledWith(orderId, undefined, true);
    });

    it('still returns the updated order even if createFromOrder() rejects (best-effort invoice) — stock is already correctly drained by then', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith([{ id: 'ship-1', status: 'pending' }]));
      const tx = makeDeliveryTx(
        [{ id: 'ps-1', bagTypeId: 'bt-1', quantity: 40, reservedQuantity: 10, createdAt: new Date('2024-01-01') }],
        [{ id: 'ship-1', orderId, status: 'pending' }],
        [{ id: 'res-1', shipmentId: 'ship-1', packedStockId: 'ps-1', quantity: 10 }],
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      // Simulate transient invoice creation failure
      mockInvoices.createFromOrder.mockRejectedValue(new Error('DB timeout'));

      // markDelivered propagates the error from createFromOrder — callers
      // should handle it and the owner can use POST /orders/:id/invoice
      await expect(service.markDelivered(orderId, clerkUserId)).rejects.toThrow('DB timeout');
      // But the stock WAS drained and the order WAS marked delivered before the failure.
      expect(tx._packed[0]).toMatchObject({ quantity: 30, reservedQuantity: 0 });
      expect(tx.clientOrder.update).toHaveBeenCalled();
    });

    it('throws NotFoundException when order does not exist', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(null);

      await expect(service.markDelivered('no-such-order', clerkUserId)).rejects.toThrow(NotFoundException);
      expect(mockInvoices.createFromOrder).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the caller user does not exist, before opening a transaction', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith([{ id: 'ship-1', status: 'pending' }]));
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.markDelivered(orderId, 'no-such-clerk-user')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockInvoices.createFromOrder).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // No-shipment direct deduction (shipments are no longer required to mark
    // an order delivered). An order with zero active shipments now succeeds
    // via ShipmentsService.drainPackedStockDirect() instead of the old
    // NO_SHIPMENT rejection — reusing PackedStockService.getFifoDraw() for
    // the FIFO plan (mocked here per-test) and the real decrement/StockExit
    // write path.
    // -----------------------------------------------------------------------

    it('order with 10kg bags, no shipment: mark delivered decreases PackedStock correctly and creates StockExit(exitType:order)', async () => {
      const orderFixture = { id: orderId, bagTypeId: 'bt-10', totalKgRequested: '100', bagType: { nominalKg: '10' } };
      // zero shipments — used to be NO_SHIPMENT; outer fixture needs bagTypeId
      // set so markDelivered() takes the direct-deduction branch.
      mockPrisma.clientOrder.findUnique.mockResolvedValue(noShipOrder('bt-10', '100', '10'));
      const tx = makeDeliveryTx(
        [{ id: 'ps-1', bagTypeId: 'bt-10', quantity: 50, reservedQuantity: 0, createdAt: new Date('2024-01-01') }],
        [], [],
        orderFixture,
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      // 100kg / 10kg-per-bag = 10 bags — same formula createFromOrder() uses.
      mockPackedStockService.getFifoDraw.mockResolvedValue({
        draws: [{ packedStockId: 'ps-1', quantity: 10 }], fulfilled: true, requested: 10, available: 50,
      });

      await service.markDelivered(orderId, clerkUserId);

      expect(mockPackedStockService.getFifoDraw).toHaveBeenCalledWith('bt-10', 10);
      expect(tx._packed[0]).toMatchObject({ quantity: 40 });
      expect(tx.stockExit.create).toHaveBeenCalledTimes(1);
      expect(tx.stockExit.create.mock.calls[0][0].data).toMatchObject({
        exitType: 'order', packedStockId: 'ps-1', bagTypeId: 'bt-10', quantity: 10, orderId, loggedById: internalUserId,
      });
      // No Shipment or ShipmentReservation is touched or required for this path.
      expect(tx.shipment.findUnique).not.toHaveBeenCalled();
      expect(tx.clientOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: orderId }, data: { status: 'delivered' } }),
      );
      expect(mockInvoices.createFromOrder).toHaveBeenCalledWith(orderId, undefined, true);
    });

    it('direct-deduction path locks the order row via FOR UPDATE before reading it, closing the race with a concurrent PATCH /orders/:id', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(noShipOrder('bt-10', '100', '10'));
      const orderFixture = { id: orderId, bagTypeId: 'bt-10', totalKgRequested: '100', bagType: { nominalKg: '10' } };
      const tx = makeDeliveryTx(
        [{ id: 'ps-1', bagTypeId: 'bt-10', quantity: 50, reservedQuantity: 0, createdAt: new Date('2024-01-01') }],
        [], [],
        orderFixture,
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      mockPackedStockService.getFifoDraw.mockResolvedValue({
        draws: [{ packedStockId: 'ps-1', quantity: 10 }], fulfilled: true, requested: 10, available: 50,
      });

      const callOrder: string[] = [];
      const originalQueryRaw = tx.$queryRaw;
      tx.$queryRaw = fn().mockImplementation(async (...args: any[]) => { callOrder.push('lock'); return originalQueryRaw(...args); });
      const originalFindUnique = tx.clientOrder.findUnique;
      tx.clientOrder.findUnique = fn().mockImplementation(async (...args: any[]) => { callOrder.push('read'); return originalFindUnique(...args); });

      await service.markDelivered(orderId, clerkUserId);

      // First two events prove the order-row lock precedes the order read.
      // (A third 'lock' event follows — drainPackedStockDirect()'s own
      // separate PackedStock-row lock — already covered by its own tests.)
      expect(callOrder.slice(0, 2)).toEqual(['lock', 'read']);
      const lockCall = tx.$queryRaw.mock.calls[0][0] as any;
      expect(lockCall.sql).toContain('FOR UPDATE');
      expect(lockCall.sql).toContain('client_orders');
    });

    it.each([
      ['bt-2', '16', '2', 8],
      ['bt-5', '20', '5', 4],
      ['bt-10', '20', '10', 2],
    ])('order with %s-kg bags (nominalKg=%s, totalKg=%s): correct quantity (%i bags) deducted', async (bagTypeId, totalKg, nominalKg, expectedQty) => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(noShipOrder(bagTypeId, totalKg, nominalKg));
      const orderFixture = { id: orderId, bagTypeId, totalKgRequested: totalKg, bagType: { nominalKg } };
      const tx = makeDeliveryTx(
        [{ id: 'ps-1', bagTypeId, quantity: 100, reservedQuantity: 0, createdAt: new Date('2024-01-01') }],
        [], [],
        orderFixture,
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      mockPackedStockService.getFifoDraw.mockResolvedValue({
        draws: [{ packedStockId: 'ps-1', quantity: expectedQty }], fulfilled: true, requested: expectedQty, available: 100,
      });

      await service.markDelivered(orderId, clerkUserId);

      expect(mockPackedStockService.getFifoDraw).toHaveBeenCalledWith(bagTypeId, expectedQty);
      expect(tx._packed[0]).toMatchObject({ quantity: 100 - expectedQty });
    });

    it('insufficient stock, no shipment: fails safely — no invoice issued, order status not advanced, nothing partially deducted', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(noShipOrder('bt-10', '100', '10'));
      const orderFixture = { id: orderId, bagTypeId: 'bt-10', totalKgRequested: '100', bagType: { nominalKg: '10' } };
      const tx = makeDeliveryTx(
        [{ id: 'ps-1', bagTypeId: 'bt-10', quantity: 3, reservedQuantity: 0, createdAt: new Date('2024-01-01') }],
        [], [],
        orderFixture,
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      mockPackedStockService.getFifoDraw.mockResolvedValue({
        draws: [{ packedStockId: 'ps-1', quantity: 3 }], fulfilled: false, requested: 10, available: 3,
      });

      await expect(service.markDelivered(orderId, clerkUserId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });

      expect(tx.packedStock.update).not.toHaveBeenCalled();
      expect(tx.stockExit.create).not.toHaveBeenCalled();
      expect(tx.clientOrder.update).not.toHaveBeenCalled();
      expect(mockInvoices.createFromOrder).not.toHaveBeenCalled();
    });

    it('second delivery attempt on an already-delivered order: idempotent no-op, no second deduction', async () => {
      // order.status is already 'delivered' — the idempotency guard returns
      // before opening a transaction at all, so a second click can never
      // deduct stock twice.
      const deliveredFixture = orderWith([]);
      deliveredFixture.status = 'delivered';
      mockPrisma.clientOrder.findUnique.mockResolvedValue(deliveredFixture);

      const result = await service.markDelivered(orderId, clerkUserId);

      // findOne() aliases orderBagLines → bagLines on its way out, so compare
      // by contained fields rather than deep-equal against the raw fixture.
      expect(result).toMatchObject({ id: orderId, status: 'delivered' });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPackedStockService.getFifoDraw).not.toHaveBeenCalled();
      expect(mockInvoices.createFromOrder).not.toHaveBeenCalled();
    });

    it('KG order (no bagTypeId), no shipment: order still transitions to delivered with no packed-stock deduction attempted', async () => {
      const kgOrder = orderWith([]);
      (kgOrder as any).bagTypeId = null;
      mockPrisma.clientOrder.findUnique.mockResolvedValue(kgOrder);
      const tx = makeDeliveryTx([], [], []);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.markDelivered(orderId, clerkUserId);

      expect(mockPackedStockService.getFifoDraw).not.toHaveBeenCalled();
      expect(tx.clientOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: orderId }, data: { status: 'delivered' } }),
      );
      expect(mockInvoices.createFromOrder).toHaveBeenCalledWith(orderId, undefined, true);
    });

    it('succeeds when at least one shipment is non-cancelled, even if others on the order are cancelled', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(
        orderWith([{ id: 'ship-cancelled', status: 'cancelled' }, { id: 'ship-active', status: 'pending' }]),
      );
      const tx = makeDeliveryTx(
        [{ id: 'ps-1', bagTypeId: 'bt-1', quantity: 20, reservedQuantity: 5, createdAt: new Date('2024-01-01') }],
        [{ id: 'ship-cancelled', orderId, status: 'cancelled' }, { id: 'ship-active', orderId, status: 'pending' }],
        [{ id: 'res-1', shipmentId: 'ship-active', packedStockId: 'ps-1', quantity: 5 }],
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.markDelivered(orderId, clerkUserId);

      expect(tx.clientOrder.update).toHaveBeenCalled();
      expect(mockInvoices.createFromOrder).toHaveBeenCalledTimes(1);
      expect(tx._packed[0]).toMatchObject({ quantity: 15, reservedQuantity: 0 });
    });

    it('invoice creation runs exactly once, after the transaction settles, with the same (id, undefined, true) signature as before', async () => {
      mockPrisma.clientOrder.findUnique.mockResolvedValue(orderWith([{ id: 'ship-1', status: 'pending' }]));
      const tx = makeDeliveryTx(
        [{ id: 'ps-1', bagTypeId: 'bt-1', quantity: 20, reservedQuantity: 5, createdAt: new Date('2024-01-01') }],
        [{ id: 'ship-1', orderId, status: 'pending' }],
        [{ id: 'res-1', shipmentId: 'ship-1', packedStockId: 'ps-1', quantity: 5 }],
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.markDelivered(orderId, clerkUserId);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
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
