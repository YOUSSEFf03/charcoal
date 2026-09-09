/**
 * Real-Postgres integration test — requires the dev DB running and
 * DATABASE_URL configured. NOT part of `npm test` — run via
 * `npm run test:integration`.
 *
 * Forensic audit (2026-08-31): "Statement of Account shows the wrong ID for
 * orders". getClientLedger() previously exposed ONLY Invoice.displayId
 * ("SI-xxxx") for an invoice entry — even one raised FROM an order, where the
 * client/business user actually knows the sale by its Order reference
 * ("SO-xxxx", the same field Orders.tsx/OrderDetail.tsx show). This file
 * proves, against a REAL order/invoice pair read independently from
 * Postgres, that getClientLedger()'s entry now carries the exact same Order
 * reference the Order page itself would show — not a re-derived or
 * fabricated value.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReportsModule } from '../src/reports/reports.module';
import { ReportsService } from '../src/reports/reports.service';
import { WalkInSalesModule } from '../src/walk-in-sales/walk-in-sales.module';
import { WalkInSalesService } from '../src/walk-in-sales/walk-in-sales.service';

const TAG = `LEDGER_ORDER_REF_TEST_${Date.now()}`;
const CLERK_ID = `local_${TAG}_owner`;

describe('Client ledger Order reference — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reports: ReportsService;
  let walkInSales: WalkInSalesService;

  let clientId: string;
  let orderId: string;
  let invoiceId: string;
  let userId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ReportsModule, WalkInSalesModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    reports = moduleRef.get(ReportsService);
    walkInSales = moduleRef.get(WalkInSalesService);

    const user = await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: `${TAG}@local.internal`, name: 'Test Owner', role: 'owner' },
    });
    userId = user.id;

    const client = await prisma.client.create({
      data: { name: `Ledger Order Ref Test Client ${Date.now()}`, type: 'restaurant', currency: 'USD' },
    });
    clientId = client.id;

    // A real ClientOrder — Orders.tsx/OrderDetail.tsx render `order.displayId`
    // as the canonical, user-facing reference for this exact row.
    const order = await prisma.clientOrder.create({
      data: {
        clientId, charcoalType: TAG, grade: 'A', totalKgRequested: '100.000',
        pricePerBag: '5.00', currency: 'USD', status: 'draft', createdById: userId,
      },
    });
    orderId = order.id;
    expect(order.displayId).toBeTruthy(); // sanity: the app really does assign one

    // An Invoice raised FROM that order (source: 'ORDER', orderId set) — the
    // exact shape WalkInSalesService/InvoicesService.createFromOrder() produce.
    const invoice = await prisma.invoice.create({
      data: {
        clientId, orderId, lines: [], subtotal: '500.00', total: '500.00',
        currency: 'USD', source: 'ORDER', status: 'issued', issuedAt: new Date('2026-08-20'),
      },
    });
    invoiceId = invoice.id;
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    await prisma.clientOrder.deleteMany({ where: { id: orderId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    // Test-created fixture user (unique clerkId per run) — must be deleted by
    // exact ID, or every run leaves behind a new "Test Owner" row.
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('CASE 7 — getClientLedger()\'s invoice entry carries the exact Order.displayId the Order page independently reads from Postgres', async () => {
    // Ground truth, read completely independently of getClientLedger().
    const realOrder = await prisma.clientOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: { displayId: true },
    });
    const realInvoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { displayId: true },
    });
    // Sanity: these really are two different reference sequences, not a
    // formatting difference of the same value.
    expect(realOrder.displayId).not.toBe(realInvoice.displayId);

    const ledger = await reports.getClientLedger(clientId, {});
    const entry = ledger.entries.find((e: any) => e.reference === invoiceId);
    expect(entry).toBeDefined();

    expect((entry as any).orderId).toBe(orderId);
    expect((entry as any).orderDisplayId).toBe(realOrder.displayId);
    // The invoice's own reference is untouched — additive fix only.
    expect(entry!.displayId).toBe(realInvoice.displayId);
    // Accounting fields untouched by this fix.
    expect(entry!.debit).toBe('500.00');
    expect(entry!.runningBalance).toBe('500.00');
  });

  it('a non-order invoice on the same client never carries an order reference', async () => {
    const wsInvoice = await prisma.invoice.create({
      data: {
        clientId, lines: [], subtotal: '80.00', total: '80.00',
        currency: 'USD', source: 'WAREHOUSE_SALE', status: 'issued', issuedAt: new Date('2026-08-21'),
      },
    });
    try {
      const ledger = await reports.getClientLedger(clientId, {});
      const entry = ledger.entries.find((e: any) => e.reference === wsInvoice.id);
      expect(entry).toBeDefined();
      expect((entry as any).orderId).toBeNull();
      expect((entry as any).orderDisplayId).toBeNull();
    } finally {
      await prisma.invoice.deleteMany({ where: { id: wsInvoice.id } });
    }
  });

  /**
   * Follow-up audit (2026-08-31): "Normal Orders vs Warehouse/Walk-in Sales".
   * Proves — against the REAL production write path, not a hand-built
   * fixture — that WalkInSalesService.create() (the actual service behind
   * POST /walk-in-sales, i.e. a genuine warehouse/walk-in sale) never
   * populates Invoice.orderId, so its Statement entry can never inherit or
   * fabricate an SO-xxxx Order reference.
   */
  it("a REAL warehouse/walk-in sale (WalkInSalesService.create()) never sets Invoice.orderId — Statement falls back to the invoice's own reference", async () => {
    const lot = await prisma.stockLot.create({
      data: {
        charcoalType: TAG, grade: 'A', supplierId: (await prisma.supplier.findFirst())!.id,
        kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '1.0000',
        source: 'container', dateReceived: new Date(),
      },
    });
    const session = await prisma.packingSession.create({
      data: {
        workerId: userId, mode: 'stock', kgConsumed: '0', kgOutputTotal: '0',
        varianceKg: '0', sessionEarnings: '0', date: new Date(), completedAt: new Date(),
        sessionLots: { create: [{ lotId: lot.id, kgUsed: '0' }] },
      },
    });
    const bagType = await prisma.bagType.create({
      data: { name: TAG, nominalKg: '10.000', costPerBag: '1.0000', workerRate: '0.1000' },
    });
    const packedStock = await prisma.packedStock.create({
      data: { lotId: lot.id, bagTypeId: bagType.id, quantity: 10, reservedQuantity: 0, sessionId: session.id },
    });

    const sale = await walkInSales.create(
      {
        clientId, date: '2026-08-22', method: 'cash' as const,
        bags: [{ packedStockId: packedStock.id, bagTypeId: bagType.id, bagTypeName: bagType.name, quantity: 5, pricePerBag: '4.00', currency: 'USD' as const }],
      } as any,
      CLERK_ID,
    );

    try {
      // Ground truth, independent of getClientLedger().
      const realInvoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: sale.id },
        select: { orderId: true, source: true, displayId: true },
      });
      expect(realInvoice.source).toBe('WAREHOUSE_SALE');
      expect(realInvoice.orderId).toBeNull(); // the actual production write path — proven, not assumed

      const ledger = await reports.getClientLedger(clientId, {});
      const entry = ledger.entries.find((e: any) => e.reference === sale.id);
      expect(entry).toBeDefined();
      expect((entry as any).orderId).toBeNull();
      expect((entry as any).orderDisplayId).toBeNull();
      expect(entry!.displayId).toBe(realInvoice.displayId); // falls back correctly — never fabricated
    } finally {
      await prisma.stockExit.deleteMany({ where: { invoiceId: sale.id } });
      await prisma.invoice.deleteMany({ where: { id: sale.id } });
      await prisma.packedStock.deleteMany({ where: { id: packedStock.id } });
      await prisma.packingSessionLot.deleteMany({ where: { sessionId: session.id } });
      await prisma.packingSession.deleteMany({ where: { id: session.id } });
      await prisma.stockLot.deleteMany({ where: { id: lot.id } });
      await prisma.bagType.deleteMany({ where: { id: bagType.id } });
    }
  });
});
