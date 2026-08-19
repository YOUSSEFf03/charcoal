/**
 * Real-Postgres integration test — requires the dev DB running (docker compose up -d)
 * and DATABASE_URL configured (same as `npm run start:dev`). NOT part of `npm test`
 * (that suite is 100% mocked-Prisma, see jest.config.js) — run explicitly via
 * `npm run test:integration`.
 *
 * Why this exists: InvoicesService.cancel()'s new PAYMENT_EXISTS/DELIVERED_ORDER
 * guards depend on genuine Prisma relations — Invoice.orderId → Shipment.orderId,
 * and PaymentAllocation.invoiceId → Invoice.id — that a mocked-tx unit test can only
 * assert were *queried*, not that they resolve correctly against real foreign keys
 * and real Shipment.status transitions written by ShipmentsService.confirmDelivery().
 * Only a test against the actual database proves the guard fires on real data.
 *
 * Uses real NestJS services (InvoicesService, ShipmentsService) wired to the real
 * PrismaService — no HTTP layer, no auth guards. Creates its own isolated fixtures
 * (dedicated client + stock lot/bag type with a unique charcoalType tag) and deletes
 * everything it created in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { InvoicesModule } from '../src/invoices/invoices.module';
import { InvoicesService } from '../src/invoices/invoices.service';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { SettingsModule } from '../src/settings/settings.module';

const TAG = `CANCEL_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner'; // matches the dev-auth-bypass seeded user (auth.guard.ts)

describe('Invoice cancellation guards — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let invoices: InvoicesService;
  let shipments: ShipmentsService;

  let clientId: string;
  let supplierId: string;
  let bagTypeId: string;
  let userId: string;

  const createdLotIds: string[] = [];
  const createdPackingSessionIds: string[] = [];
  const createdPackedStockIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdShipmentIds: string[] = [];
  const createdInvoiceIds: string[] = [];
  const createdPaymentIds: string[] = [];

  async function makeOrderWithPackedStock(quantity: number) {
    const lot = await prisma.stockLot.create({
      data: {
        charcoalType: TAG,
        grade: 'A',
        supplierId,
        kgReceived: '1000.000',
        kgRemaining: '1000.000',
        costPerKg: '1.0000',
        source: 'container',
        dateReceived: new Date(),
      },
    });
    createdLotIds.push(lot.id);

    const session = await prisma.packingSession.create({
      data: {
        workerId: userId,
        mode: 'stock',
        kgConsumed: '0',
        kgOutputTotal: '0',
        varianceKg: '0',
        sessionEarnings: '0',
        date: new Date(),
        completedAt: new Date(),
        sessionLots: { create: [{ lotId: lot.id, kgUsed: '0' }] },
      },
    });
    createdPackingSessionIds.push(session.id);

    const packedStock = await prisma.packedStock.create({
      data: { lotId: lot.id, bagTypeId, quantity, sessionId: session.id },
    });
    createdPackedStockIds.push(packedStock.id);

    const order = await prisma.clientOrder.create({
      data: {
        clientId,
        charcoalType: TAG,
        grade: 'A',
        totalKgRequested: '1.000',
        bagTypeId,
        pricePerBag: '10.00',
        currency: 'USD',
        createdById: userId,
      },
    });
    createdOrderIds.push(order.id);

    return { orderId: order.id, bagTypeId };
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, InvoicesModule, ShipmentsModule, SettingsModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    invoices = moduleRef.get(InvoicesService);
    shipments = moduleRef.get(ShipmentsService);

    const user = await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });
    userId = user.id;

    const supplier = await prisma.supplier.findFirst();
    supplierId = supplier!.id;

    const bagType = await prisma.bagType.findFirst();
    bagTypeId = bagType!.id;

    const client = await prisma.client.create({
      data: { name: `Cancel Test Client ${Date.now()}`, type: 'restaurant', currency: 'USD' },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    for (const inv of createdInvoiceIds) {
      await prisma.paymentAllocation.deleteMany({ where: { invoiceId: inv } });
    }
    if (createdPaymentIds.length > 0) {
      await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: createdPaymentIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
    }
    await prisma.stockExit.deleteMany({ where: { clientId } });
    await prisma.invoice.deleteMany({ where: { clientId } });
    if (createdShipmentIds.length > 0) {
      await prisma.shipmentReservation.deleteMany({ where: { shipmentId: { in: createdShipmentIds } } });
      await prisma.shipmentBag.deleteMany({ where: { shipmentId: { in: createdShipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: createdShipmentIds } } });
    }
    if (createdOrderIds.length > 0) {
      await prisma.clientOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdPackedStockIds.length > 0) {
      await prisma.packedStock.deleteMany({ where: { id: { in: createdPackedStockIds } } });
    }
    if (createdPackingSessionIds.length > 0) {
      await prisma.packingSessionLot.deleteMany({ where: { sessionId: { in: createdPackingSessionIds } } });
      await prisma.packingSession.deleteMany({ where: { id: { in: createdPackingSessionIds } } });
    }
    if (createdLotIds.length > 0) {
      await prisma.stockLot.deleteMany({ where: { id: { in: createdLotIds } } });
    }
    await prisma.client.deleteMany({ where: { id: clientId } });

    await prisma.$disconnect();
  });

  it('DELIVERED_ORDER: rejects cancelling an ORDER invoice whose order has a real delivered shipment', async () => {
    const { orderId, bagTypeId: bt } = await makeOrderWithPackedStock(5);

    const shipment = await shipments.createShipment(
      { orderId, address: 'Integration test address', nominalKg: '10', bags: [{ bagTypeId: bt, quantity: 2 }] } as any,
      CLERK_ID,
    );
    createdShipmentIds.push(shipment.id);

    await shipments.confirmDelivery(shipment.id, {} as any, CLERK_ID);

    const invoice = await prisma.invoice.findFirst({ where: { orderId } });
    expect(invoice).not.toBeNull();
    createdInvoiceIds.push(invoice!.id);
    expect(invoice!.status).toBe('issued'); // auto-issued by confirmDelivery, unpaid

    await expect(invoices.cancel(invoice!.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DELIVERED_ORDER' }),
    });

    // Confirm nothing changed: status still 'issued', not 'cancelled'.
    const after = await prisma.invoice.findUnique({ where: { id: invoice!.id } });
    expect(after!.status).toBe('issued');
  });

  it('PAYMENT_EXISTS: rejects cancelling a WAREHOUSE_SALE invoice that has a real PaymentAllocation', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        clientId,
        lines: [],
        subtotal: '100.00',
        total: '100.00',
        currency: 'USD',
        source: 'WAREHOUSE_SALE',
        status: 'issued',
        issuedAt: new Date(),
        paidAmount: '0',
      },
    });
    createdInvoiceIds.push(invoice.id);

    const payment = await prisma.payment.create({
      data: { clientId, invoiceId: invoice.id, amount: '40.00', currency: 'USD', method: 'cash', date: new Date(), loggedById: userId },
    });
    createdPaymentIds.push(payment.id);
    await prisma.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: invoice.id, amount: '40.00' } });

    await expect(invoices.cancel(invoice.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_EXISTS' }),
    });

    // Confirm nothing changed: invoice, payment, and allocation all untouched.
    const afterInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(afterInvoice!.status).toBe('issued');
    const afterPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(afterPayment).not.toBeNull();
    const afterAllocations = await prisma.paymentAllocation.findMany({ where: { invoiceId: invoice.id } });
    expect(afterAllocations).toHaveLength(1);
    expect(afterAllocations[0].amount.toString()).toBe('40');
  });

  it('unpaid, non-delivered invoice: cancellation still succeeds and only Invoice.status changes', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        clientId,
        lines: [],
        subtotal: '50.00',
        total: '50.00',
        currency: 'USD',
        source: 'WAREHOUSE_SALE',
        status: 'issued',
        issuedAt: new Date(),
        paidAmount: '0',
      },
    });
    createdInvoiceIds.push(invoice.id);

    const result = await invoices.cancel(invoice.id);
    expect(result.status).toBe('cancelled');

    const after = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(after!.status).toBe('cancelled');
    expect(after!.total.toString()).toBe('50'); // nothing else about the invoice mutated
  });

  it('ORDER invoice not yet delivered (order created, no shipment): cancellation still succeeds', async () => {
    const { orderId } = await makeOrderWithPackedStock(5);

    const invoice = await prisma.invoice.create({
      data: {
        clientId,
        orderId,
        lines: [],
        subtotal: '30.00',
        total: '30.00',
        currency: 'USD',
        source: 'ORDER',
        status: 'issued',
        issuedAt: new Date(),
        paidAmount: '0',
      },
    });
    createdInvoiceIds.push(invoice.id);

    const result = await invoices.cancel(invoice.id);
    expect(result.status).toBe('cancelled');
  });
});
