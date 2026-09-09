/**
 * Real-Postgres integration test — requires the dev DB running and
 * DATABASE_URL configured. NOT part of `npm test` — run via
 * `npm run test:integration`.
 *
 * Forensic audit (2026-08-31), "Client Multiple Locations with ONE shared
 * client balance". Proves, against real Postgres, that:
 *   - a client can have Location A and Location B (CASE 3)
 *   - orders for each location both affect the SAME client balance (CASE 6)
 *   - the Statement's description gains the location name, never a second
 *     column (CASE 7/8/9)
 *   - a payment against a located order credits the receiver's ledger
 *     EXACTLY ONCE — no per-location duplication (CASE 13/17)
 *   - the client's total balance formula is untouched by locations (CASE 16)
 *     — proven by using the REAL ClientBalanceService (never mocked) and
 *     the REAL PaymentsService (real PaymentAllocationService/
 *     LedgerWriteService write paths), not a hand-rolled arithmetic check.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import Decimal from 'decimal.js';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReportsModule } from '../src/reports/reports.module';
import { ReportsService } from '../src/reports/reports.service';
import { ClientsModule } from '../src/clients/clients.module';
import { ClientsService } from '../src/clients/clients.service';
import { ClientBalanceService } from '../src/clients/client-balance.service';
import { PaymentsModule } from '../src/payments/payments.module';
import { PaymentsService } from '../src/payments/payments.service';

const TAG = `CLIENT_LOC_TEST_${Date.now()}`;
const CLERK_ID = `local_${TAG}_owner`;

describe('Client Multiple Locations — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reports: ReportsService;
  let clientsService: ClientsService;
  let balanceService: ClientBalanceService;
  let paymentsService: PaymentsService;

  let clientId: string;
  let userId: string;
  let locAId: string;
  let locBId: string;
  let orderAId: string;
  let orderBId: string;
  let invoiceAId: string;
  let invoiceBId: string;
  let paymentIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ReportsModule, ClientsModule, PaymentsModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    reports = moduleRef.get(ReportsService);
    clientsService = moduleRef.get(ClientsService);
    balanceService = moduleRef.get(ClientBalanceService);
    paymentsService = moduleRef.get(PaymentsService);

    const user = await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: `${TAG}@local.internal`, name: 'Test Owner', role: 'owner' },
    });
    userId = user.id;

    const client = await prisma.client.create({
      data: { name: `Client Locations Test ${Date.now()}`, type: 'restaurant', currency: 'USD' },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    if (paymentIds.length) {
      await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
      const account = await prisma.userAccount.findUnique({ where: { userId } });
      if (account) await prisma.accountEntry.deleteMany({ where: { accountId: account.id, referenceId: { in: paymentIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    await prisma.invoice.deleteMany({ where: { clientId } });
    await prisma.clientOrder.deleteMany({ where: { clientId } });
    await prisma.clientLocation.deleteMany({ where: { clientId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    // Test-created fixture user (unique clerkId per run) — must be deleted by
    // exact ID, or every run leaves behind a new "Test Owner" row. Cascades
    // to any leftover UserAccount (its AccountEntry rows are already removed
    // above).
    await prisma.user.deleteMany({ where: { id: userId } });
    await moduleRef.close();
  });

  it('CASE 2/3 — enabling multi-location and creating Location A + Location B', async () => {
    const updated = await clientsService.update(clientId, { multiLocationEnabled: true } as any);
    expect(updated.multiLocationEnabled).toBe(true);

    const locA = await clientsService.createLocation(clientId, { name: 'Hamra Branch' });
    const locB = await clientsService.createLocation(clientId, { name: 'Jounieh Branch' });
    locAId = locA.id;
    locBId = locB.id;

    const list = await clientsService.listLocations(clientId);
    expect(list.map((l) => l.name).sort()).toEqual(['Hamra Branch', 'Jounieh Branch']);
  });

  it('CASE 4/5/6/7/8/9/16 — orders for Location A and Location B both affect the SAME client balance, and the Statement shows each location in its own description', async () => {
    const balanceBeforeOrders = await balanceService.computeBalance(clientId);
    expect(balanceBeforeOrders.toFixed(2)).toBe('0.00'); // sanity: fresh client, nothing owed yet

    const orderA = await prisma.clientOrder.create({
      data: {
        clientId, charcoalType: TAG, grade: 'A', totalKgRequested: '100.000',
        pricePerBag: '10.00', currency: 'USD', createdById: userId, locationId: locAId,
      },
    });
    orderAId = orderA.id;
    const orderB = await prisma.clientOrder.create({
      data: {
        clientId, charcoalType: TAG, grade: 'B', totalKgRequested: '80.000',
        pricePerBag: '10.00', currency: 'USD', createdById: userId, locationId: locBId,
      },
    });
    orderBId = orderB.id;

    const invoiceA = await prisma.invoice.create({
      data: {
        clientId, orderId: orderAId, currency: 'USD', source: 'ORDER', status: 'issued',
        issuedAt: new Date('2026-08-20'), subtotal: '1000.00', total: '1000.00',
        lines: [{ saleUnit: 'BAG', qty: 100, bagTypeName: 'Standard', pricePerBag: '10.00', lineTotal: '1000.00' }],
      },
    });
    invoiceAId = invoiceA.id;
    const invoiceB = await prisma.invoice.create({
      data: {
        clientId, orderId: orderBId, currency: 'USD', source: 'ORDER', status: 'issued',
        issuedAt: new Date('2026-08-21'), subtotal: '800.00', total: '800.00',
        lines: [{ saleUnit: 'BAG', qty: 80, bagTypeName: 'Standard', pricePerBag: '10.00', lineTotal: '800.00' }],
      },
    });
    invoiceBId = invoiceB.id;

    // CASE 6/16 — balance = Σ invoice.total, mathematically identical to a
    // client with NO locations at all (ClientBalanceService never reads
    // ClientOrder or ClientLocation — see its own doc comment).
    const balanceAfterOrders = await balanceService.computeBalance(clientId);
    expect(balanceAfterOrders.toFixed(2)).toBe('1800.00'); // 1000 + 800, exactly the example in the task spec

    // CASE 7/8/9 — Statement descriptions carry each location, never a
    // separate column/field.
    const ledger = await reports.getClientLedger(clientId, {});
    const entryA = ledger.entries.find((e: any) => e.reference === invoiceAId);
    const entryB = ledger.entries.find((e: any) => e.reference === invoiceBId);
    expect(entryA!.description).toBe('Order Sale · 100 × Standard - Hamra Branch');
    expect(entryB!.description).toBe('Order Sale · 80 × Standard - Jounieh Branch');
    expect(entryA).not.toHaveProperty('location');
    expect(entryB).not.toHaveProperty('location');
    expect(parseFloat(ledger.balance)).toBeCloseTo(1800, 2);
  });

  it('CASE 13/17 — a payment against the Location A order credits the receiver\'s ledger EXACTLY ONCE, and the client balance drops by exactly the payment amount (task example: $1800 → pay $1000 → $800)', async () => {
    const account = await prisma.userAccount.findUnique({ where: { userId } });
    const entriesBefore = account
      ? await prisma.accountEntry.count({ where: { accountId: account.id } })
      : 0;

    const payment = await paymentsService.create(
      {
        clientId, invoiceId: invoiceAId, amount: '1000.00', currency: 'USD',
        method: 'cash' as any, date: '2026-08-22', receiverId: userId,
      } as any,
      CLERK_ID,
    );
    paymentIds.push(payment.id);

    // Exactly ONE new AccountEntry — not one per location, not one per
    // invoice line, not two for "Location A's share".
    const accountAfter = await prisma.userAccount.findUnique({ where: { userId } });
    const entriesAfter = await prisma.accountEntry.count({ where: { accountId: accountAfter!.id } });
    expect(entriesAfter).toBe(entriesBefore + 1);

    const ledgerEntry = await prisma.accountEntry.findFirst({ where: { referenceId: payment.id } });
    expect(new Decimal(ledgerEntry!.amount.toString()).toFixed(2)).toBe('1000.00');

    // CASE 6/16 — task's own worked example: $1800 balance, pay $1000 → $800,
    // and this NEVER creates a separate Hamra/Jounieh account — there is only
    // ever the one client balance, computed the same way regardless of location.
    const balanceAfterPayment = await balanceService.computeBalance(clientId);
    expect(balanceAfterPayment.toFixed(2)).toBe('800.00');
  });

  it('CASE 10/11/12 — a Warehouse/Walk-in Sale style invoice (no orderId, no location) still affects the same client balance and needs no location at all', async () => {
    const wsInvoice = await prisma.invoice.create({
      data: {
        clientId, currency: 'USD', source: 'WAREHOUSE_SALE', status: 'issued',
        issuedAt: new Date('2026-08-23'), subtotal: '50.00', total: '50.00', lines: [],
      },
    });
    try {
      const balance = await balanceService.computeBalance(clientId);
      // 800 (post-payment from the previous test) + 50 (this warehouse sale).
      expect(balance.toFixed(2)).toBe('850.00');

      const ledger = await reports.getClientLedger(clientId, {});
      const wsEntry = ledger.entries.find((e: any) => e.reference === wsInvoice.id);
      expect(wsEntry!.description).toBe('Warehouse Sale');
      expect(wsEntry!.orderId).toBeNull();
    } finally {
      await prisma.invoice.deleteMany({ where: { id: wsInvoice.id } });
    }
  });

  it('CASE 15 — deactivating Location A does not destroy order-a\'s historical location in the Statement', async () => {
    await clientsService.updateLocation(clientId, locAId, { isActive: false });

    const ledger = await reports.getClientLedger(clientId, {});
    const entryA = ledger.entries.find((e: any) => e.reference === invoiceAId);
    expect(entryA!.description).toBe('Order Sale · 100 × Standard - Hamra Branch');

    const loc = await prisma.clientLocation.findUnique({ where: { id: locAId } });
    expect(loc!.isActive).toBe(false);
    expect(loc).not.toBeNull(); // never deleted
  });
});
