import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { PrismaService } from '../prisma/prisma.service';

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

describe('ShipmentsService', () => {
  let service: ShipmentsService;

  const mockPrisma = {
    packedStock: { aggregate: fn(), findMany: fn(), update: fn(), findFirst: fn() },
    shipment: { create: fn(), findUnique: fn(), update: fn(), findMany: fn() },
    stockExit: { create: fn() },
    user: { findUnique: fn() },
    clientOrder: { update: fn() },
    payment: { create: fn() },
    $transaction: fn(),
  };

  // createShipment now runs inside a transaction and reserves FIFO. Build a tx whose
  // packedStock rows carry quantity + reservedQuantity.
  function makeCreateTx(rows: Array<{ id: string; bagTypeId: string; quantity: number; reservedQuantity: number; createdAt: Date }>) {
    const store = rows.map((r) => ({ ...r }));
    return {
      _store: store,
      packedStock: {
        findMany: fn().mockImplementation(async (args: any) => {
          let res = store.filter((r) => r.bagTypeId === args.where.bagTypeId);
          if (args?.where?.reservedQuantity?.gt !== undefined) res = res.filter((r) => r.reservedQuantity > args.where.reservedQuantity.gt);
          if (args?.where?.quantity?.gt !== undefined) res = res.filter((r) => r.quantity > args.where.quantity.gt);
          return res.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }),
        update: fn().mockImplementation(async (args: any) => {
          const row = store.find((r) => r.id === args.where.id)!;
          if (args.data.reservedQuantity?.increment) row.reservedQuantity += args.data.reservedQuantity.increment;
          if (args.data.reservedQuantity?.decrement) row.reservedQuantity -= args.data.reservedQuantity.decrement;
          if (args.data.quantity?.decrement) row.quantity -= args.data.quantity.decrement;
          return row;
        }),
      },
      shipment: { create: fn() },
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ShipmentsService>(ShipmentsService);
  });

  // =========================================================================
  // createShipment()
  // =========================================================================

  describe('createShipment()', () => {

    // =========================================================================
    // Test 1: CONSTRAINT 4 — insufficient stock throws before any DB write
    // =========================================================================

    it('CONSTRAINT 4: throws CONSTRAINT_VIOLATION and does not create the shipment when free stock < required quantity', async () => {
      const bagTypeId = 'bag-type-uuid-1';

      // 5 in stock, none reserved; we request 10 → cannot fully reserve.
      const tx = makeCreateTx([{ id: 'ps-1', bagTypeId, quantity: 5, reservedQuantity: 0, createdAt: new Date('2024-01-01') }]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const dto = {
        orderId: 'order-uuid-1',
        address: '123 Main St',
        nominalKg: '50.000',
        bags: [{ bagTypeId, quantity: 10 }],
      };

      await expect(
        service.createShipment(dto as any, 'clerk-user-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });

      // shipment.create must NOT have been called
      expect(tx.shipment.create).not.toHaveBeenCalled();
    });

    // =========================================================================
    // Test 2: sufficient stock → calls shipment.create with correct shape
    // =========================================================================

    it('reserves stock and calls shipment.create with the right shape when stock is sufficient', async () => {
      const bagTypeId = 'bag-type-uuid-2';
      const orderId = 'order-uuid-2';

      const tx = makeCreateTx([{ id: 'ps-2', bagTypeId, quantity: 20, reservedQuantity: 0, createdAt: new Date('2024-01-01') }]);
      const createdShipment = {
        id: 'shipment-uuid-1', orderId, address: '456 Delivery Ave', nominalKg: '30.000', bags: [],
      };
      tx.shipment.create.mockResolvedValue(createdShipment);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const dto = {
        orderId, address: '456 Delivery Ave', nominalKg: '30.000', bags: [{ bagTypeId, quantity: 5 }],
      };

      const result = await service.createShipment(dto as any, 'clerk-user-1');

      expect(tx.shipment.create).toHaveBeenCalledTimes(1);
      const createArg = tx.shipment.create.mock.calls[0][0];
      expect(createArg.data.orderId).toBe(orderId);
      expect(createArg.data.address).toBe('456 Delivery Ave');
      expect(createArg.data.nominalKg).toBe('30.000');
      expect(createArg.data.bags.create).toEqual(
        expect.arrayContaining([expect.objectContaining({ bagTypeId, quantity: 5 })]),
      );
      // BUG-2: the 5 bags are now reserved, physical quantity unchanged.
      expect(tx._store[0].reservedQuantity).toBe(5);
      expect(tx._store[0].quantity).toBe(20);
      expect(result).toBe(createdShipment);
    });

    // =========================================================================
    // BUG-2 (P2): joint over-allocation across two shipments is impossible
    // =========================================================================

    it('BUG-2: two shipments for the same bag type cannot jointly exceed packed stock', async () => {
      const bagTypeId = 'bag-type-joint';
      // Shared stateful store: reservation from shipment 1 is visible to shipment 2.
      const tx = makeCreateTx([{ id: 'ps-j', bagTypeId, quantity: 100, reservedQuantity: 0, createdAt: new Date('2024-01-01') }]);
      tx.shipment.create.mockResolvedValue({ id: 's', bags: [] });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      // First reserves 70 — OK.
      await service.createShipment(
        { orderId: 'o1', address: 'a', nominalKg: '1', bags: [{ bagTypeId, quantity: 70 }] } as any,
        'clerk-1',
      );
      expect(tx._store[0].reservedQuantity).toBe(70);

      // Second wants 50, only 30 free → rejected.
      await expect(
        service.createShipment(
          { orderId: 'o2', address: 'a', nominalKg: '1', bags: [{ bagTypeId, quantity: 50 }] } as any,
          'clerk-1',
        ),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }) });

      // INVARIANT: reserved never exceeds physical quantity.
      expect(tx._store[0].reservedQuantity).toBeLessThanOrEqual(tx._store[0].quantity);
    });
  });

  // =========================================================================
  // cancelShipment() — BUG-2 reservation release
  // =========================================================================

  describe('cancelShipment()', () => {
    function makeCancelTx(rows: Array<{ id: string; bagTypeId: string; quantity: number; reservedQuantity: number; createdAt: Date }>, shipment: any) {
      const store = rows.map((r) => ({ ...r }));
      return {
        _store: store,
        packedStock: {
          findMany: fn().mockImplementation(async (args: any) => {
            let res = store.filter((r) => r.bagTypeId === args.where.bagTypeId);
            if (args?.where?.reservedQuantity?.gt !== undefined) res = res.filter((r) => r.reservedQuantity > args.where.reservedQuantity.gt);
            return res.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          }),
          update: fn().mockImplementation(async (args: any) => {
            const row = store.find((r) => r.id === args.where.id)!;
            if (args.data.reservedQuantity?.decrement) row.reservedQuantity -= args.data.reservedQuantity.decrement;
            return row;
          }),
        },
        shipment: {
          findUnique: fn().mockResolvedValue(shipment),
          update: fn().mockResolvedValue({ id: shipment?.id }),
        },
      };
    }

    it('BUG-2: cancel releases the reservation only (quantity untouched) and marks cancelled', async () => {
      const bagTypeId = 'bag-cancel';
      const tx = makeCancelTx(
        [{ id: 'ps-c', bagTypeId, quantity: 100, reservedQuantity: 40, createdAt: new Date('2024-01-01') }],
        { id: 'ship-c', status: 'pending', bags: [{ bagTypeId, quantity: 40 }] },
      );
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.cancelShipment('ship-c');

      expect(tx._store[0].reservedQuantity).toBe(0);
      expect(tx._store[0].quantity).toBe(100);
      expect(tx.shipment.update.mock.calls[0][0].data.status).toBe('cancelled');
    });

    it('BUG-2: cancel is rejected for a delivered shipment', async () => {
      const tx = makeCancelTx([], { id: 'ship-d', status: 'delivered', bags: [] });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(service.cancelShipment('ship-d')).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // confirmDelivery()
  // =========================================================================

  describe('confirmDelivery()', () => {

    // =========================================================================
    // Test 3: happy-path FIFO drain
    // stocks [qty:5, qty:10], bag needs 7 → first stock decremented by 5, second by 2
    // StockExit loggedById = user.id (CONSTRAINT 5)
    // shipment marked delivered
    // =========================================================================

    it('FIFO drain: decrements first stock by 5 and second by 2 for a bag needing 7; StockExit uses user.id (CONSTRAINT 5)', async () => {
      const shipmentId = 'shipment-uuid-confirm-1';
      const bagTypeId = 'bag-type-uuid-3';
      const userId = 'clerk-user-confirm';
      const internalUserId = 'db-user-confirm-id';
      const stockId1 = 'stock-id-1';
      const stockId2 = 'stock-id-2';
      const orderId = 'order-uuid-confirm';

      // User lookup now happens outside the transaction
      mockPrisma.user.findUnique.mockResolvedValue({ id: internalUserId, clerkId: userId });

      // Build the mock tx object
      const mockTx = {
        shipment: {
          findUnique: fn(),
          update: fn(),
          findMany: fn(),
        },
        packedStock: { findMany: fn(), update: fn() },
        stockExit: { create: fn() },
        clientOrder: { update: fn() },
        payment: { create: fn() },
      };

      // Step 1: shipment with one bag needing qty=7
      mockTx.shipment.findUnique
        .mockResolvedValueOnce({
          id: shipmentId,
          orderId,
          bags: [{ bagTypeId, quantity: 7 }],
          order: { clientId: 'client-uuid-1', currency: 'USD' },
        })
        // Final findUnique at end of transaction
        .mockResolvedValueOnce({ id: shipmentId, bags: [] });

      // Step 3: FIFO packed stocks for this bag type (with reservations from creation).
      mockTx.packedStock.findMany.mockResolvedValue([
        { id: stockId1, bagTypeId, quantity: 5, reservedQuantity: 5, createdAt: new Date('2024-01-01') },
        { id: stockId2, bagTypeId, quantity: 10, reservedQuantity: 2, createdAt: new Date('2024-01-02') },
      ]);

      mockTx.packedStock.update.mockResolvedValue({});
      mockTx.stockExit.create.mockResolvedValue({});
      mockTx.shipment.update.mockResolvedValue({});

      // Siblings: all delivered
      mockTx.shipment.findMany.mockResolvedValue([{ status: 'delivered' }]);
      mockTx.clientOrder.update.mockResolvedValue({});

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await service.confirmDelivery(shipmentId, {} as any, userId);

      // Verify packedStock.update calls
      const updateCalls = mockTx.packedStock.update.mock.calls;
      expect(updateCalls).toHaveLength(2);

      const firstUpdate = updateCalls[0][0];
      expect(firstUpdate.where.id).toBe(stockId1);
      expect(firstUpdate.data.quantity.decrement).toBe(5);
      // BUG-2: delivery releases the reservation it held (5 reserved → release 5).
      expect(firstUpdate.data.reservedQuantity.decrement).toBe(5);

      const secondUpdate = updateCalls[1][0];
      expect(secondUpdate.where.id).toBe(stockId2);
      expect(secondUpdate.data.quantity.decrement).toBe(2);
      // Second row held 2 reserved → release 2.
      expect(secondUpdate.data.reservedQuantity.decrement).toBe(2);

      // CONSTRAINT 5: both StockExit records must use user.id, not anything from DTO
      const exitCalls = mockTx.stockExit.create.mock.calls;
      expect(exitCalls).toHaveLength(2);
      exitCalls.forEach((call: any[]) => {
        expect(call[0].data.loggedById).toBe(internalUserId);
      });

      // Shipment marked delivered
      const shipmentUpdateCall = mockTx.shipment.update.mock.calls[0][0];
      expect(shipmentUpdateCall.data.status).toBe('delivered');
    });

    // =========================================================================
    // Test 4: insufficient stock during drain → throws BadRequestException CONSTRAINT_VIOLATION
    // =========================================================================

    it('throws BadRequestException CONSTRAINT_VIOLATION when remaining > 0 after all stocks are drained', async () => {
      const shipmentId = 'shipment-uuid-confirm-2';
      const bagTypeId = 'bag-type-uuid-4';
      const userId = 'clerk-user-confirm-2';
      const orderId = 'order-uuid-confirm-2';

      // User lookup now happens outside the transaction
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-2', clerkId: userId });

      const mockTx = {
        shipment: { findUnique: fn(), update: fn(), findMany: fn() },
        packedStock: { findMany: fn(), update: fn() },
        stockExit: { create: fn() },
        clientOrder: { update: fn() },
        payment: { create: fn() },
      };

      // Bag needs qty=10 but only 3 available across all stocks
      mockTx.shipment.findUnique.mockResolvedValue({
        id: shipmentId,
        orderId,
        bags: [{ bagTypeId, quantity: 10 }],
        order: { clientId: 'client-uuid-2', currency: 'USD' },
      });

      mockTx.packedStock.findMany.mockResolvedValue([
        { id: 'stock-id-3', bagTypeId, quantity: 3, reservedQuantity: 0, createdAt: new Date('2024-01-01') },
      ]);

      mockTx.packedStock.update.mockResolvedValue({});
      mockTx.stockExit.create.mockResolvedValue({});

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await expect(
        service.confirmDelivery(shipmentId, {} as any, userId),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.confirmDelivery(shipmentId, {} as any, userId),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });
    });
  });

  // =========================================================================
  // logReturn()
  // =========================================================================

  describe('logReturn()', () => {

    // =========================================================================
    // Test 5: increments packedStock.quantity for each bag line
    // =========================================================================

    it('increments packedStock quantity for each ShipmentBag on return', async () => {
      const shipmentId = 'shipment-uuid-return-1';
      const bagTypeId1 = 'bag-type-uuid-5';
      const bagTypeId2 = 'bag-type-uuid-6';
      const stockId1 = 'stock-return-1';
      const stockId2 = 'stock-return-2';
      const orderId = 'order-uuid-return';

      const mockTx = {
        shipment: { findUnique: fn(), update: fn(), findMany: fn() },
        packedStock: { findFirst: fn(), update: fn() },
        clientOrder: { update: fn() },
      };

      mockTx.shipment.findUnique
        .mockResolvedValueOnce({
          id: shipmentId,
          orderId,
          bags: [
            { bagTypeId: bagTypeId1, quantity: 3 },
            { bagTypeId: bagTypeId2, quantity: 7 },
          ],
        })
        .mockResolvedValueOnce({ id: shipmentId, bags: [] });

      mockTx.packedStock.findFirst
        .mockResolvedValueOnce({ id: stockId1, bagTypeId: bagTypeId1, quantity: 10 })
        .mockResolvedValueOnce({ id: stockId2, bagTypeId: bagTypeId2, quantity: 5 });

      mockTx.packedStock.update.mockResolvedValue({});
      mockTx.shipment.update.mockResolvedValue({});

      // Siblings: no delivered shipments
      mockTx.shipment.findMany.mockResolvedValue([{ status: 'returned' }]);

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await service.logReturn(shipmentId, {} as any, 'clerk-user-return');

      const updateCalls = mockTx.packedStock.update.mock.calls;
      expect(updateCalls).toHaveLength(2);

      // First bag: increment by 3
      expect(updateCalls[0][0]).toMatchObject({
        where: { id: stockId1 },
        data: { quantity: { increment: 3 } },
      });

      // Second bag: increment by 7
      expect(updateCalls[1][0]).toMatchObject({
        where: { id: stockId2 },
        data: { quantity: { increment: 7 } },
      });
    });
  });
});
