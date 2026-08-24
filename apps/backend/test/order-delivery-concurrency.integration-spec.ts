/**
 * Real-Postgres integration test — requires the dev DB running (docker compose up -d)
 * and DATABASE_URL configured (same as `npm run start:dev`). NOT part of `npm test`
 * (that suite is 100% mocked-Prisma, see jest.config.js) — run explicitly via
 * `npm run test:integration`.
 *
 * Why this exists: a production bug reported "Internal Server Error" when a user
 * pressed "Mark Delivered" / "Deliver" multiple times quickly. The root cause is a
 * genuine concurrency gap — two near-simultaneous requests can both read the same
 * pre-commit "not yet delivered" state before either commits, so the idempotency
 * check each of these two endpoints already had (a plain `if (status === ...)`
 * outside any lock) does not, by itself, stop a race. This is only provable against
 * a REAL PostgreSQL transaction (see stock-concurrency.integration-spec.ts's own doc
 * comment for why a mocked-Prisma unit test cannot catch this class of bug) — two
 * real overlapping transactions racing on the same row(s), run concurrently via
 * Promise.allSettled.
 *
 * Covers the two independent delivery-confirmation endpoints that share this bug
 * shape:
 *   1) OrdersService.markDelivered() — "Mark as delivered" (OrderDetail / Orders
 *      pages), the exact flow named in the bug report. Fixed by locking the
 *      ClientOrder row (SELECT ... FOR UPDATE) before reading anything, then
 *      re-checking status against that fresh read before draining stock.
 *   2) ShipmentsService.confirmDelivery() — "Deliver" (DriverMobile), the flow that
 *      actually creates a Payment/PaymentAllocation/ledger credit on delivery.
 *      Fixed by locking the Shipment row the same way.
 *   3) InvoicesService.createFromOrder() — shared by both flows above. Its
 *      application-level idempotency check plus a DB partial unique index
 *      (invoices_orderId_unique_active) already prevented a duplicate invoice row,
 *      but the P2002 the index raises on a genuine race was never caught — it
 *      propagated as an unhandled 500 instead of returning the winning invoice.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrdersModule } from '../src/orders/orders.module';
import { OrdersService } from '../src/orders/orders.service';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { InvoicesModule } from '../src/invoices/invoices.module';
import { InvoicesService } from '../src/invoices/invoices.service';

const TAG = `DELIVERY_CONCURRENCY_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner'; // matches the dev-auth-bypass seeded user (auth.guard.ts)

describe('Concurrent delivery confirmation — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orders: OrdersService;
  let shipments: ShipmentsService;
  let invoices: InvoicesService;

  let clientId: string;
  let internalUserId: string;

  const createdOrderIds: string[] = [];
  const createdShipmentIds: string[] = [];
  const createdPackedStockIds: string[] = [];
  const createdPackingSessionIds: string[] = [];
  const createdLotIds: string[] = [];
  const createdBagTypeIds: string[] = [];

  async function makeBagType(nominalKg: string) {
    const bt = await prisma.bagType.create({
      data: { name: `${TAG}_${Date.now()}_${Math.random().toString(36).slice(2)}`, nominalKg, costPerBag: '1.0000', workerRate: '0.1000' },
    });
    createdBagTypeIds.push(bt.id);
    return bt.id;
  }

  async function makeLot(kgRemaining: string) {
    const supplier = await prisma.supplier.findFirst();
    const lot = await prisma.stockLot.create({
      data: {
        charcoalType: TAG,
        grade: 'A',
        supplierId: supplier!.id,
        kgReceived: kgRemaining,
        kgRemaining,
        costPerKg: '1.0000',
        source: 'container',
        dateReceived: new Date(),
      },
    });
    createdLotIds.push(lot.id);
    return lot.id;
  }

  // Inserts a PackedStock row directly, same pattern as stock-concurrency.integration-spec.ts.
  async function makePackedStock(bagTypeId: string, quantity: number, reservedQuantity = 0) {
    const lotId = await makeLot('100000.000');
    const session = await prisma.packingSession.create({
      data: {
        workerId: internalUserId,
        mode: 'stock',
        kgConsumed: '0',
        kgOutputTotal: '0',
        varianceKg: '0',
        sessionEarnings: '0',
        date: new Date(),
        completedAt: new Date(),
        sessionLots: { create: [{ lotId, kgUsed: '0' }] },
      },
    });
    createdPackingSessionIds.push(session.id);
    const packedStock = await prisma.packedStock.create({
      data: { lotId, bagTypeId, quantity, reservedQuantity, sessionId: session.id },
    });
    createdPackedStockIds.push(packedStock.id);
    return packedStock.id;
  }

  async function makeOrder(bagTypeId: string, totalKgRequested: string, forClientId: string = clientId) {
    const order = await prisma.clientOrder.create({
      data: {
        clientId: forClientId,
        charcoalType: TAG,
        grade: 'A',
        totalKgRequested,
        bagTypeId,
        pricePerBag: '10.00',
        currency: 'USD',
        createdById: internalUserId,
      },
    });
    createdOrderIds.push(order.id);
    return order.id;
  }

  const createdClientIds: string[] = [];
  // A dedicated client, isolated from the shared `clientId` — needed for any
  // test that FIFO-allocates a payment: allocateFifo() sweeps ALL of a
  // client's open invoices oldest-first, so reusing the shared client would
  // let another test's still-open (unpaid) invoice silently soak up part of
  // this payment and corrupt the "exactly one allocation" assertion.
  async function makeClient() {
    const client = await prisma.client.create({
      data: { name: `${TAG}_client_${Date.now()}_${Math.random().toString(36).slice(2)}`, type: 'restaurant', currency: 'USD' },
    });
    createdClientIds.push(client.id);
    return client.id;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, OrdersModule, ShipmentsModule, InvoicesModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    orders = moduleRef.get(OrdersService);
    shipments = moduleRef.get(ShipmentsService);
    invoices = moduleRef.get(InvoicesService);

    const user = await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });
    internalUserId = user.id;

    const client = await prisma.client.create({
      data: { name: `Delivery Concurrency Test Client ${Date.now()}`, type: 'restaurant', currency: 'USD' },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    // Delete in FK-safe order. Anything not created by a given scenario is a no-op.
    const allClientIds = [clientId, ...createdClientIds];
    const invoiceRows = await prisma.invoice.findMany({ where: { clientId: { in: allClientIds } } });
    for (const inv of invoiceRows) {
      await prisma.paymentAllocation.deleteMany({ where: { invoiceId: inv.id } });
    }
    await prisma.payment.deleteMany({ where: { clientId: { in: allClientIds } } });
    // markDelivered()/drainShipment()/drainPackedStockDirect() stamp orderId
    // on each StockExit, not clientId — delete by orderId so none are left
    // referencing a ClientOrder row the delete below is about to remove.
    if (createdOrderIds.length > 0) {
      await prisma.stockExit.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    }
    await prisma.invoice.deleteMany({ where: { clientId: { in: allClientIds } } });
    // No driverId is ever set on these test orders, so confirmDelivery()'s
    // ledger-credit sub-block (gated on receiverFields.receiverId) never runs —
    // no AccountEntry rows to clean up.

    if (createdShipmentIds.length > 0) {
      await prisma.shipmentReservation.deleteMany({ where: { shipmentId: { in: createdShipmentIds } } });
      await prisma.shipmentBag.deleteMany({ where: { shipmentId: { in: createdShipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: createdShipmentIds } } });
    }
    if (createdOrderIds.length > 0) {
      await prisma.clientOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdPackedStockIds.length > 0) {
      await prisma.stockAdjustment.deleteMany({ where: { packedStockId: { in: createdPackedStockIds } } });
      await prisma.packedStock.deleteMany({ where: { id: { in: createdPackedStockIds } } });
    }
    if (createdPackingSessionIds.length > 0) {
      await prisma.packedStock.deleteMany({ where: { sessionId: { in: createdPackingSessionIds } } });
      await prisma.packingSessionLot.deleteMany({ where: { sessionId: { in: createdPackingSessionIds } } });
      await prisma.packingSession.deleteMany({ where: { id: { in: createdPackingSessionIds } } });
    }
    if (createdLotIds.length > 0) {
      await prisma.stockAdjustment.deleteMany({ where: { lotId: { in: createdLotIds } } });
      await prisma.stockLot.deleteMany({ where: { id: { in: createdLotIds } } });
    }
    await prisma.client.deleteMany({ where: { id: { in: allClientIds } } });
    if (createdBagTypeIds.length > 0) {
      await prisma.bagType.deleteMany({ where: { id: { in: createdBagTypeIds } } });
    }

    await prisma.$disconnect();
  });

  // =========================================================================
  // 1) "Mark Delivered" button — OrdersService.markDelivered(), no-shipment
  //    direct-deduction path (the normal case today; see that method's doc
  //    comment). Reproduces the exact reported bug: two rapid clicks racing.
  // =========================================================================
  it('MARK-DELIVERED RACE: two concurrent markDelivered() calls on the same order drain packed stock exactly once, issue exactly one invoice, and neither call throws an uncontrolled error', async () => {
    const bagTypeId = await makeBagType('10.000');
    // 100kg / 10kg-per-bag = 10 bags. Ample stock (30) — if the race isn't closed,
    // a double-drain silently succeeds (20 decremented instead of 10) rather than
    // failing on insufficient stock, which is the more dangerous failure mode to catch.
    const packedStockId = await makePackedStock(bagTypeId, 30);
    const orderId = await makeOrder(bagTypeId, '100.000');

    const results = await Promise.allSettled([
      orders.markDelivered(orderId, CLERK_ID),
      orders.markDelivered(orderId, CLERK_ID),
    ]);

    // Neither call may throw a raw/uncontrolled error (the reported "Internal
    // Server Error"). Both settling as fulfilled — one having done the real
    // delivery, the other observing it already done — is the required outcome;
    // a rejection here would have to be a proper HttpException, never a raw
    // Prisma error, to be acceptable, and this scenario has ample stock so
    // there is no legitimate reason for either call to reject at all.
    for (const r of results) {
      if (r.status === 'rejected') {
        // eslint-disable-next-line no-console
        console.error('Unexpected rejection in markDelivered race:', r.reason);
      }
      expect(r.status).toBe('fulfilled');
    }

    const order = await prisma.clientOrder.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe('delivered');

    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(20); // 30 − 10, never 30 − 20 from a double drain

    const exits = await prisma.stockExit.findMany({ where: { orderId } });
    expect(exits).toHaveLength(1); // exactly one StockExit, not two

    const invoiceRows = await prisma.invoice.findMany({ where: { orderId } });
    expect(invoiceRows).toHaveLength(1); // exactly one invoice, never a P2002-race duplicate attempt left half-visible
    expect(invoiceRows[0].status).toBe('issued');
  });

  // =========================================================================
  // 2) createFromOrder() race in isolation — proves the DB unique-index
  //    backstop (invoices_orderId_unique_active) is now caught and converted
  //    to "return the winner's invoice" instead of propagating a raw P2002.
  // =========================================================================
  it('INVOICE RACE: two concurrent createFromOrder() calls for the same already-delivered order create exactly one invoice and neither rejects with a raw Prisma error', async () => {
    const bagTypeId = await makeBagType('5.000');
    const orderId = await makeOrder(bagTypeId, '50.000');
    // Deliver it directly (bypassing markDelivered's own stock requirement —
    // this test isolates the invoice race, not the stock drain) so
    // createFromOrder()'s `order.status !== 'delivered'` guard passes.
    await prisma.clientOrder.update({ where: { id: orderId }, data: { status: 'delivered' } });

    const results = await Promise.allSettled([
      invoices.createFromOrder(orderId, undefined, true),
      invoices.createFromOrder(orderId, undefined, true),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') {
        // A rejection here is only acceptable if it's a real HttpException
        // (e.g. a genuine validation failure) — never a raw
        // PrismaClientKnownRequestError leaking past the P2002 catch.
        // eslint-disable-next-line no-console
        console.error('Unexpected rejection in createFromOrder race:', r.reason);
      }
      expect(r.status).toBe('fulfilled');
    }

    const invoiceRows = await prisma.invoice.findMany({ where: { orderId } });
    expect(invoiceRows).toHaveLength(1);

    // Both calls must have returned the SAME invoice id (the winner), not two
    // different invoice objects.
    const fulfilledIds = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id);
    expect(new Set(fulfilledIds).size).toBe(1);
  });

  // =========================================================================
  // 3) "Deliver" button (driver flow) — ShipmentsService.confirmDelivery(),
  //    the endpoint that actually creates a Payment/PaymentAllocation/ledger
  //    credit on delivery. Proves repeated/concurrent confirmation creates
  //    exactly ONE of each financial record, per the task's Payment Safety
  //    requirement (order total $117.40, must never duplicate).
  // =========================================================================
  it('CONFIRM-DELIVERY RACE: two concurrent confirmDelivery() calls for the same shipment with a payment create exactly one payment, one allocation, and neither call throws an uncontrolled error', async () => {
    const testClientId = await makeClient();
    const bagTypeId = await makeBagType('9.000');
    const packedStockId = await makePackedStock(bagTypeId, 20);
    const orderId = await makeOrder(bagTypeId, '90.000', testClientId); // 10 bags @ $11.74 = $117.40
    await prisma.clientOrder.update({ where: { id: orderId }, data: { pricePerBag: '11.74' } });

    const shipment = await shipments.createShipment(
      { orderId, address: 'Concurrency test address', nominalKg: '90', bags: [{ bagTypeId, quantity: 10 }] } as any,
      CLERK_ID,
    );
    createdShipmentIds.push(shipment.id);

    const confirmDto = () => ({ paymentAmount: '117.40', paymentMethod: 'cash' } as any);
    const results = await Promise.allSettled([
      shipments.confirmDelivery(shipment.id, confirmDto(), { userId: CLERK_ID, role: 'owner' } as any),
      shipments.confirmDelivery(shipment.id, confirmDto(), { userId: CLERK_ID, role: 'owner' } as any),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') {
        // eslint-disable-next-line no-console
        console.error('Unexpected rejection in confirmDelivery race:', r.reason);
      }
      expect(r.status).toBe('fulfilled');
    }

    const shipRow = await prisma.shipment.findUnique({ where: { id: shipment.id } });
    expect(shipRow!.status).toBe('delivered');

    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(10); // 20 − 10, never 20 − 20 from a double drain

    const paymentRows = await prisma.payment.findMany({ where: { clientId: testClientId, amount: '117.40' } });
    expect(paymentRows).toHaveLength(1); // exactly ONE payment — the task's central "5 clicks → 1 payment" requirement

    const allocationRows = await prisma.paymentAllocation.findMany({
      where: { paymentId: { in: paymentRows.map((p) => p.id) } },
    });
    expect(allocationRows).toHaveLength(1); // exactly ONE allocation
  });
});
