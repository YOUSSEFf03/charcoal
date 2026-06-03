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

/**
 * BUG-I (P1): a single stateful in-memory store modelling packed_stocks AND the keyed
 * shipment_reservations table together, so a reservation made by one shipment is visible
 * to another and a release can be proven to touch ONLY the owning shipment's rows.
 *
 * Supports createShipment, confirmDelivery, and cancelShipment against the same store so
 * a full reserve → deliver/cancel lifecycle can be exercised across multiple shipments.
 */
function makeStore(rows: PsRow[]) {
  const packed: PsRow[] = rows.map((r) => ({ ...r }));
  const reservations: ResRow[] = [];
  const createdShipments = new Map<string, any>();
  let resSeq = 0;
  let shipSeq = 0;

  const tx: any = {
    _packed: packed,
    _reservations: reservations,
    packedStock: {
      findMany: fn().mockImplementation(async (args: any) => {
        let res = packed.filter((r) => r.bagTypeId === args.where.bagTypeId);
        if (args?.where?.quantity?.gt !== undefined) res = res.filter((r) => r.quantity > args.where.quantity.gt);
        return res.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
      findFirst: fn().mockImplementation(async (args: any) => {
        const res = packed
          .filter((r) => r.bagTypeId === args.where.bagTypeId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return res[0] ?? null;
      }),
      update: fn().mockImplementation(async (args: any) => {
        const row = packed.find((r) => r.id === args.where.id)!;
        if (args.data.reservedQuantity?.increment) row.reservedQuantity += args.data.reservedQuantity.increment;
        if (args.data.reservedQuantity?.decrement) row.reservedQuantity -= args.data.reservedQuantity.decrement;
        if (args.data.quantity?.increment) row.quantity += args.data.quantity.increment;
        if (args.data.quantity?.decrement) row.quantity -= args.data.quantity.decrement;
        return row;
      }),
    },
    shipmentReservation: {
      upsert: fn().mockImplementation(async (args: any) => {
        const { shipmentId, packedStockId } = args.where.shipmentId_packedStockId;
        const existing = reservations.find((r) => r.shipmentId === shipmentId && r.packedStockId === packedStockId);
        if (existing) {
          if (args.update.quantity?.increment) existing.quantity += args.update.quantity.increment;
          return existing;
        }
        const row: ResRow = { id: `res-${++resSeq}`, shipmentId, packedStockId, quantity: args.create.quantity };
        reservations.push(row);
        return row;
      }),
      delete: fn().mockImplementation(async (args: any) => {
        const idx = reservations.findIndex((r) => r.id === args.where.id);
        if (idx >= 0) reservations.splice(idx, 1);
        return {};
      }),
      deleteMany: fn().mockImplementation(async (args: any) => {
        for (let i = reservations.length - 1; i >= 0; i--) {
          if (reservations[i].shipmentId === args.where.shipmentId) reservations.splice(i, 1);
        }
        return {};
      }),
    },
    shipment: {
      create: fn().mockImplementation(async (args: any) => {
        const id = `ship-${++shipSeq}`;
        const row = { id, ...args.data, bags: (args.data.bags?.create ?? []) };
        createdShipments.set(id, row);
        return row;
      }),
      // Default: resolve a created shipment by id (used by createShipment's final read).
      // confirm/cancel tests queue tailored views via mockResolvedValueOnce, which take
      // priority over this default implementation.
      findUnique: fn().mockImplementation(async (args: any) => createdShipments.get(args.where.id) ?? null),
      update: fn().mockResolvedValue({}),
      findMany: fn().mockResolvedValue([{ status: 'delivered' }]),
    },
    stockExit: { create: fn().mockResolvedValue({}) },
    clientOrder: { update: fn().mockResolvedValue({}) },
    payment: { create: fn().mockResolvedValue({}) },
  };

  // Helper to fetch a shipment view with its reservations + bags for confirm/cancel.
  tx._shipmentView = (id: string, status: string, bags: Array<{ bagTypeId: string; quantity: number }>, orderId = 'order-x') => {
    const myRes = reservations
      .filter((r) => r.shipmentId === id)
      .map((r) => ({ ...r, packedStock: packed.find((p) => p.id === r.packedStockId)! }));
    return {
      id,
      orderId,
      status,
      bags,
      reservations: myRes,
      order: { clientId: 'client-x', currency: 'USD' },
    };
  };

  return tx;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ShipmentsService', () => {
  let service: ShipmentsService;

  const mockPrisma = {
    packedStock: { aggregate: fn(), findMany: fn(), update: fn(), findFirst: fn() },
    shipment: { create: fn(), findUnique: fn(), update: fn(), findMany: fn() },
    shipmentReservation: { upsert: fn(), delete: fn(), deleteMany: fn() },
    stockExit: { create: fn() },
    user: { findUnique: fn() },
    clientOrder: { update: fn() },
    payment: { create: fn() },
    $transaction: fn(),
  };

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
    it('CONSTRAINT 4: throws CONSTRAINT_VIOLATION when free stock < required quantity', async () => {
      const bagTypeId = 'bag-type-uuid-1';
      const tx = makeStore([{ id: 'ps-1', bagTypeId, quantity: 5, reservedQuantity: 0, createdAt: new Date('2024-01-01') }]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const dto = { orderId: 'order-uuid-1', address: '123 Main St', nominalKg: '50.000', bags: [{ bagTypeId, quantity: 10 }] };

      await expect(service.createShipment(dto as any, 'clerk-user-1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
      });
    });

    it('reserves stock, writes a keyed reservation row, and leaves physical quantity unchanged', async () => {
      const bagTypeId = 'bag-type-uuid-2';
      const tx = makeStore([{ id: 'ps-2', bagTypeId, quantity: 20, reservedQuantity: 0, createdAt: new Date('2024-01-01') }]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const dto = { orderId: 'order-uuid-2', address: '456 Delivery Ave', nominalKg: '30.000', bags: [{ bagTypeId, quantity: 5 }] };
      await service.createShipment(dto as any, 'clerk-user-1');

      // Keyed reservation created for this shipment on ps-2 with quantity 5.
      expect(tx._reservations).toHaveLength(1);
      expect(tx._reservations[0]).toMatchObject({ packedStockId: 'ps-2', quantity: 5 });
      // Denormalized cache moved in lockstep; physical quantity unchanged.
      expect(tx._packed[0].reservedQuantity).toBe(5);
      expect(tx._packed[0].quantity).toBe(20);
    });

    it('BUG-2: two shipments for the same bag type cannot jointly exceed packed stock', async () => {
      const bagTypeId = 'bag-type-joint';
      const tx = makeStore([{ id: 'ps-j', bagTypeId, quantity: 100, reservedQuantity: 0, createdAt: new Date('2024-01-01') }]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.createShipment({ orderId: 'o1', address: 'a', nominalKg: '1', bags: [{ bagTypeId, quantity: 70 }] } as any, 'clerk-1');
      expect(tx._packed[0].reservedQuantity).toBe(70);

      await expect(
        service.createShipment({ orderId: 'o2', address: 'a', nominalKg: '1', bags: [{ bagTypeId, quantity: 50 }] } as any, 'clerk-1'),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }) });

      expect(tx._packed[0].reservedQuantity).toBeLessThanOrEqual(tx._packed[0].quantity);
    });
  });

  // =========================================================================
  // BUG-I (P1): per-shipment reservation keying — the core fix
  // =========================================================================

  describe('BUG-I: shipment-keyed reservations', () => {
    // Two shipments share ONE bag-type row. Shipment A reserves 40, B reserves 30.
    // Build the store and run both creates so we have keyed reservation rows.
    function twoShipmentsSharingARow() {
      const bagTypeId = 'bag-shared';
      const tx = makeStore([{ id: 'ps-shared', bagTypeId, quantity: 100, reservedQuantity: 0, createdAt: new Date('2024-01-01') }]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      return { tx, bagTypeId };
    }

    it('delivering shipment B releases only B’s reservation; A’s reserved bags remain protected', async () => {
      const { tx, bagTypeId } = twoShipmentsSharingARow();
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user', clerkId: 'clerk' });

      const a = await service.createShipment({ orderId: 'oA', address: 'a', nominalKg: '1', bags: [{ bagTypeId, quantity: 40 }] } as any, 'clerk');
      const b = await service.createShipment({ orderId: 'oB', address: 'a', nominalKg: '1', bags: [{ bagTypeId, quantity: 30 }] } as any, 'clerk');

      // Row now holds 70 reserved (40 A + 30 B) of 100 physical.
      expect(tx._packed[0].reservedQuantity).toBe(70);
      expect(tx._reservations).toHaveLength(2);

      // Deliver B. confirmDelivery loads B's shipment view (its own reservations only).
      tx.shipment.findUnique
        .mockResolvedValueOnce(tx._shipmentView(b.id, 'loaded', [{ bagTypeId, quantity: 30 }], 'oB'))
        .mockResolvedValueOnce({ id: b.id, bags: [] });

      await service.confirmDelivery(b.id, {} as any, 'clerk');

      // Physical quantity dropped by B's 30 → 70. Reserved dropped by ONLY B's 30 → 40.
      expect(tx._packed[0].quantity).toBe(70);
      expect(tx._packed[0].reservedQuantity).toBe(40);

      // A's reservation row survives intact; B's is gone.
      const remaining = tx._reservations;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].shipmentId).toBe(a.id);
      expect(remaining[0].quantity).toBe(40);

      // FREE quantity = 70 − 40 = 30. A's 40 reserved bags are still protected: a walk-in
      // consumer drawing against (quantity − reservedQuantity) sees only 30 free, never A's 40.
      expect(tx._packed[0].quantity - tx._packed[0].reservedQuantity).toBe(30);
    });

    it('cancelling shipment A releases only A’s reservation; B’s remains', async () => {
      const { tx, bagTypeId } = twoShipmentsSharingARow();

      const a = await service.createShipment({ orderId: 'oA', address: 'a', nominalKg: '1', bags: [{ bagTypeId, quantity: 40 }] } as any, 'clerk');
      const b = await service.createShipment({ orderId: 'oB', address: 'a', nominalKg: '1', bags: [{ bagTypeId, quantity: 30 }] } as any, 'clerk');
      expect(tx._packed[0].reservedQuantity).toBe(70);

      // Cancel A.
      tx.shipment.findUnique.mockResolvedValueOnce(tx._shipmentView(a.id, 'pending', [{ bagTypeId, quantity: 40 }], 'oA'));
      await service.cancelShipment(a.id);

      // Reserved dropped by ONLY A's 40 → 30; physical untouched at 100.
      expect(tx._packed[0].reservedQuantity).toBe(30);
      expect(tx._packed[0].quantity).toBe(100);

      // Only B's reservation remains.
      expect(tx._reservations).toHaveLength(1);
      expect(tx._reservations[0].shipmentId).toBe(b.id);
      expect(tx._reservations[0].quantity).toBe(30);
    });

    it('delivering A drains exactly A’s reserved row, never bags B reserved (no cross-shipment drain)', async () => {
      // A reserves the OLDER row fully; B reserves the NEWER row. Delivering A must not
      // touch B's row at all — proving drain follows the keyed reservation, not blind FIFO.
      const bagTypeId = 'bag-two-rows';
      const tx = makeStore([
        { id: 'ps-old', bagTypeId, quantity: 40, reservedQuantity: 0, createdAt: new Date('2024-01-01') },
        { id: 'ps-new', bagTypeId, quantity: 40, reservedQuantity: 0, createdAt: new Date('2024-01-02') },
      ]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user', clerkId: 'clerk' });

      const a = await service.createShipment({ orderId: 'oA', address: 'a', nominalKg: '1', bags: [{ bagTypeId, quantity: 40 }] } as any, 'clerk');
      const b = await service.createShipment({ orderId: 'oB', address: 'a', nominalKg: '1', bags: [{ bagTypeId, quantity: 40 }] } as any, 'clerk');

      // A took the old row (FIFO), B took the new row.
      expect(tx._reservations.find((r: any) => r.shipmentId === a.id)!.packedStockId).toBe('ps-old');
      expect(tx._reservations.find((r: any) => r.shipmentId === b.id)!.packedStockId).toBe('ps-new');

      tx.shipment.findUnique
        .mockResolvedValueOnce(tx._shipmentView(a.id, 'loaded', [{ bagTypeId, quantity: 40 }], 'oA'))
        .mockResolvedValueOnce({ id: a.id, bags: [] });

      await service.confirmDelivery(a.id, {} as any, 'clerk');

      // Old row drained to 0/0; new row (B's) completely untouched.
      const oldRow = tx._packed.find((p: any) => p.id === 'ps-old')!;
      const newRow = tx._packed.find((p: any) => p.id === 'ps-new')!;
      expect(oldRow.quantity).toBe(0);
      expect(oldRow.reservedQuantity).toBe(0);
      expect(newRow.quantity).toBe(40);
      expect(newRow.reservedQuantity).toBe(40);

      // The stock-exit was logged against A's own packed-stock row.
      expect(tx.stockExit.create).toHaveBeenCalledTimes(1);
      expect(tx.stockExit.create.mock.calls[0][0].data.packedStockId).toBe('ps-old');
    });
  });

  // =========================================================================
  // cancelShipment() — reservation release
  // =========================================================================

  describe('cancelShipment()', () => {
    it('releases the reservation only (quantity untouched) and marks cancelled', async () => {
      const bagTypeId = 'bag-cancel';
      const tx = makeStore([{ id: 'ps-c', bagTypeId, quantity: 100, reservedQuantity: 0, createdAt: new Date('2024-01-01') }]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const s = await service.createShipment({ orderId: 'oc', address: 'a', nominalKg: '1', bags: [{ bagTypeId, quantity: 40 }] } as any, 'clerk');
      expect(tx._packed[0].reservedQuantity).toBe(40);

      tx.shipment.findUnique.mockResolvedValueOnce(tx._shipmentView(s.id, 'pending', [{ bagTypeId, quantity: 40 }], 'oc'));
      await service.cancelShipment(s.id);

      expect(tx._packed[0].reservedQuantity).toBe(0);
      expect(tx._packed[0].quantity).toBe(100);
      expect(tx._reservations).toHaveLength(0);
      expect(tx.shipment.update.mock.calls[0][0].data.status).toBe('cancelled');
    });

    it('is rejected for a delivered shipment', async () => {
      const tx = makeStore([]);
      tx.shipment.findUnique.mockResolvedValueOnce({ id: 'ship-d', status: 'delivered', reservations: [] });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(service.cancelShipment('ship-d')).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // confirmDelivery()
  // =========================================================================

  describe('confirmDelivery()', () => {
    it('drains this shipment’s reserved rows and StockExit uses user.id (CONSTRAINT 5)', async () => {
      const bagTypeId = 'bag-type-uuid-3';
      const userId = 'clerk-user-confirm';
      const internalUserId = 'db-user-confirm-id';

      // Two rows; shipment reserves 5 from the first and 2 from the second (FIFO).
      const tx = makeStore([
        { id: 'stock-id-1', bagTypeId, quantity: 5, reservedQuantity: 0, createdAt: new Date('2024-01-01') },
        { id: 'stock-id-2', bagTypeId, quantity: 10, reservedQuantity: 0, createdAt: new Date('2024-01-02') },
      ]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      mockPrisma.user.findUnique.mockResolvedValue({ id: internalUserId, clerkId: userId });

      const s = await service.createShipment({ orderId: 'order-uuid-confirm', address: 'a', nominalKg: '1', bags: [{ bagTypeId, quantity: 7 }] } as any, userId);
      expect(tx._reservations).toHaveLength(2);

      tx.shipment.findUnique
        .mockResolvedValueOnce(tx._shipmentView(s.id, 'loaded', [{ bagTypeId, quantity: 7 }], 'order-uuid-confirm'))
        .mockResolvedValueOnce({ id: s.id, bags: [] });

      await service.confirmDelivery(s.id, {} as any, userId);

      // First row fully drained (5/5 → 0/0), second drained by 2 (10/2 → 8/0).
      const r1 = tx._packed.find((p: any) => p.id === 'stock-id-1')!;
      const r2 = tx._packed.find((p: any) => p.id === 'stock-id-2')!;
      expect(r1.quantity).toBe(0);
      expect(r1.reservedQuantity).toBe(0);
      expect(r2.quantity).toBe(8);
      expect(r2.reservedQuantity).toBe(0);

      // All this shipment's reservation rows consumed.
      expect(tx._reservations).toHaveLength(0);

      // CONSTRAINT 5: every StockExit uses the resolved internal user id.
      const exitCalls = tx.stockExit.create.mock.calls;
      expect(exitCalls).toHaveLength(2);
      exitCalls.forEach((call: any[]) => expect(call[0].data.loggedById).toBe(internalUserId));

      expect(tx.shipment.update.mock.calls[0][0].data.status).toBe('delivered');
    });
  });

  // =========================================================================
  // logReturn()
  // =========================================================================

  describe('logReturn()', () => {
    function makeReturnTx(shipmentStatus: string, includeDeliveredBags = false) {
      const shipmentBags = includeDeliveredBags ? [{ bagTypeId: 'bag-d5-1', quantity: 4 }] : [];
      return {
        shipment: {
          findUnique: fn().mockResolvedValue({ id: 'ship-return-guard', orderId: 'order-guard', status: shipmentStatus, bags: shipmentBags }),
          update: fn().mockResolvedValue({ id: 'ship-return-guard', status: 'returned' }),
          findMany: fn().mockResolvedValue([{ status: 'returned' }]),
        },
        packedStock: {
          findFirst: fn().mockResolvedValue({ id: 'ps-guard-1', bagTypeId: 'bag-d5-1', quantity: 10 }),
          update: fn().mockResolvedValue({}),
        },
        clientOrder: { update: fn().mockResolvedValue({}) },
      };
    }

    it('D1: rejects a pending shipment with INVALID_TRANSITION and mutates no stock', async () => {
      const tx = makeReturnTx('pending');
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(service.logReturn('ship-return-guard', {} as any, 'clerk-1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_TRANSITION' }),
      });
      expect(tx.packedStock.update).not.toHaveBeenCalled();
      expect(tx.shipment.update).not.toHaveBeenCalled();
    });

    it('D4: rejects a cancelled shipment with INVALID_TRANSITION', async () => {
      const tx = makeReturnTx('cancelled');
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(service.logReturn('ship-return-guard', {} as any, 'clerk-1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_TRANSITION' }),
      });
    });

    it('D5: succeeds for a delivered shipment and restores stock + sets status returned', async () => {
      const tx = makeReturnTx('delivered', true);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(service.logReturn('ship-return-guard', {} as any, 'clerk-1')).resolves.not.toThrow();
      expect(tx.packedStock.update).toHaveBeenCalledTimes(1);
      expect(tx.packedStock.update.mock.calls[0][0]).toMatchObject({ where: { id: 'ps-guard-1' }, data: { quantity: { increment: 4 } } });
      expect(tx.shipment.update.mock.calls[0][0]).toMatchObject({ data: expect.objectContaining({ status: 'returned' }) });
    });
  });
});
