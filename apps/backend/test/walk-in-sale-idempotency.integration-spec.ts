/**
 * Real-Postgres integration test — requires the dev DB running (docker compose up -d)
 * and DATABASE_URL configured (same as `npm run start:dev`). NOT part of `npm test`
 * (that suite is 100% mocked-Prisma, see walk-in-sales.service.spec.ts's own
 * "create() — idempotency" block) — run explicitly via `npm run test:integration`.
 *
 * Why this exists: the forensic audit reproduced live that two near-simultaneous
 * identical POST /walk-in-sales requests each independently succeeded — two full
 * invoices, two stock deductions, two payments, two receiver ledger credits, for
 * what a human intended as ONE sale. The fix (WalkInSalesService.create()'s
 * idempotency check + the invoices_idempotencyKey_unique_active PARTIAL unique
 * index — WHERE status <> 'cancelled') is only meaningful against a REAL
 * PostgreSQL transaction — a mocked-Prisma unit test can assert the P2002-catch
 * code path runs, but it cannot prove two ACTUAL concurrent transactions racing
 * on the ACTUAL index collapse into one result instead of one throwing an
 * unhandled 500. Only a test that opens two real overlapping transactions
 * against a live database can catch a regression in that guarantee.
 * Mirrors test/stock-concurrency.integration-spec.ts's structure exactly (real
 * WalkInSalesService wired to the real PrismaService, no HTTP layer, no auth
 * guards, two calls raced via Promise.allSettled).
 *
 * Follow-up (2026-08-27, second forensic audit): the partial (not plain) unique
 * index specifically exists to fix a confirmed bug — a plain unique index
 * permanently bound a key to its invoice even after that invoice was
 * cancelled, so retrying the key silently returned the dead cancelled invoice
 * instead of creating a new live sale. The "cancelled invoice" describe block
 * below is the real-Postgres proof of that fix (create → cancel → retry same
 * key → new live sale; the cancelled row is left completely untouched).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WalkInSalesModule } from '../src/walk-in-sales/walk-in-sales.module';
import { WalkInSalesService } from '../src/walk-in-sales/walk-in-sales.service';
import { InvoicesModule } from '../src/invoices/invoices.module';
import { InvoicesService } from '../src/invoices/invoices.service';
import { SettingsModule } from '../src/settings/settings.module';

const TAG = `IDEMPOTENCY_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner'; // matches the dev-auth-bypass seeded user (auth.guard.ts)

describe('Walk-in sale idempotency — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let walkInSales: WalkInSalesService;
  let invoicesService: InvoicesService;

  let clientId: string;
  let bagTypeId: string;
  let receiverId: string;

  const createdBagTypeIds: string[] = [];
  const createdPackingSessionIds: string[] = [];
  const createdPackedStockIds: string[] = [];

  // Dedicated bag type per scenario — same isolation reasoning as
  // stock-concurrency.integration-spec.ts's makeBagType(): a fresh, uniquely
  // named type with ample stock means each test's contention is caused ONLY by
  // the idempotency mechanism under test, never by leftover rows from another
  // test sharing a bagTypeId.
  async function makeBagType() {
    const bt = await prisma.bagType.create({
      data: { name: `${TAG}_${Date.now()}_${Math.random().toString(36).slice(2)}`, nominalKg: '13.131', costPerBag: '1.0000', workerRate: '0.1000' },
    });
    createdBagTypeIds.push(bt.id);
    return bt.id;
  }

  async function makePackedStock(quantity: number, forBagTypeId: string) {
    const lot = await prisma.stockLot.create({
      data: {
        charcoalType: TAG, grade: 'A', supplierId: (await prisma.supplier.findFirst())!.id,
        kgReceived: '100000.000', kgRemaining: '100000.000', costPerKg: '1.0000',
        source: 'container', dateReceived: new Date(),
      },
    });
    const session = await prisma.packingSession.create({
      data: {
        workerId: (await prisma.user.findUnique({ where: { clerkId: CLERK_ID } }))!.id,
        mode: 'stock', kgConsumed: '0', kgOutputTotal: '0', varianceKg: '0', sessionEarnings: '0',
        date: new Date(), completedAt: new Date(),
        sessionLots: { create: [{ lotId: lot.id, kgUsed: '0' }] },
      },
    });
    createdPackingSessionIds.push(session.id);
    const packedStock = await prisma.packedStock.create({
      data: { lotId: lot.id, bagTypeId: forBagTypeId, quantity, reservedQuantity: 0, sessionId: session.id },
    });
    createdPackedStockIds.push(packedStock.id);
    return packedStock.id;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, WalkInSalesModule, InvoicesModule, SettingsModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    walkInSales = moduleRef.get(WalkInSalesService);
    invoicesService = moduleRef.get(InvoicesService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    // Dedicated receiver fixture — self-contained (not relying on whatever
    // receiver-role users happen to be seeded in the dev DB), so the
    // exactly-once payment/ledger-credit assertions below have a clean
    // starting balance to compare against.
    const receiver = await prisma.user.create({
      data: {
        clerkId: `local_${TAG}_receiver`,
        email: `${TAG}_receiver@local.internal`,
        name: `Idempotency Test Receiver ${Date.now()}`,
        role: 'receiver',
      },
    });
    receiverId = receiver.id;

    const client = await prisma.client.create({
      data: { name: `Idempotency Test Client ${Date.now()}`, type: 'restaurant', currency: 'USD' },
    });
    clientId = client.id;

    bagTypeId = await makeBagType();
  });

  // The receiver fixture is SHARED across every test in this file (deliberately
  // — creating a fresh one per test would just be more setup for no benefit),
  // so its UserAccount balance would otherwise accumulate across tests and
  // break the absolute-balance assertions below (e.g. "credited exactly $10")
  // depending on execution order. Reset between tests; invoices/stock/payments
  // don't need the same treatment since every test uses its own uniquely-tagged
  // idempotencyKey and packedStock fixture.
  afterEach(async () => {
    const account = await prisma.userAccount.findUnique({ where: { userId: receiverId } });
    if (account) {
      await prisma.accountEntry.deleteMany({ where: { accountId: account.id } });
      await prisma.userAccount.update({ where: { userId: receiverId }, data: { balance: 0 } });
    }
  });

  afterAll(async () => {
    // FK-safe teardown — same order as stock-concurrency.integration-spec.ts.
    const invoices = await prisma.invoice.findMany({ where: { clientId } });
    for (const inv of invoices) {
      await prisma.paymentAllocation.deleteMany({ where: { invoiceId: inv.id } });
    }
    const accountEntries = await prisma.accountEntry.findMany({
      where: { account: { userId: receiverId } },
    });
    if (accountEntries.length > 0) {
      await prisma.accountEntry.deleteMany({ where: { id: { in: accountEntries.map((e) => e.id) } } });
    }
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } } });
    await prisma.stockExit.deleteMany({ where: { clientId } });
    await prisma.invoice.deleteMany({ where: { clientId } });
    await prisma.userAccount.deleteMany({ where: { userId: receiverId } });

    if (createdPackedStockIds.length > 0) {
      await prisma.packedStock.deleteMany({ where: { id: { in: createdPackedStockIds } } });
    }
    if (createdPackingSessionIds.length > 0) {
      await prisma.packingSessionLot.deleteMany({ where: { sessionId: { in: createdPackingSessionIds } } });
      await prisma.packingSession.deleteMany({ where: { id: { in: createdPackingSessionIds } } });
    }
    await prisma.stockLot.deleteMany({ where: { charcoalType: TAG } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: receiverId } });
    if (createdBagTypeIds.length > 0) {
      await prisma.bagType.deleteMany({ where: { id: { in: createdBagTypeIds } } });
    }

    await prisma.$disconnect();
  });

  it('SAME idempotencyKey, two concurrent requests: exactly ONE invoice is created (the real duplicate-sale bug, now fixed)', async () => {
    // Ample stock (100) so BOTH requests would succeed independently if nothing
    // deduplicated them — isolates this test to the idempotency mechanism only,
    // not stock-availability contention (already covered by
    // stock-concurrency.integration-spec.ts).
    const packedStockId = await makePackedStock(100, bagTypeId);
    const key = `${TAG}_same_key`;
    // Includes a real cash payment + receiver — exercises the FULL effect
    // matrix (invoice, stock exit, payment, payment allocation, receiver
    // ledger credit, account balance), not just the invoice/stock half.
    const dto = () => ({
      clientId, date: '2026-08-27', method: 'cash' as const,
      bags: [{ packedStockId, bagTypeId, bagTypeName: 'Test Bag', quantity: 5, pricePerBag: '2.00', currency: 'USD' as const }],
      receivedUsd: '10.00',
      receiverId,
      idempotencyKey: key,
    });

    const results = await Promise.allSettled([
      walkInSales.create(dto() as any, CLERK_ID),
      walkInSales.create(dto() as any, CLERK_ID),
    ]);

    // Both calls resolve successfully — the "loser" of the race gets the
    // winner's invoice back via the P2002-recovery path, not an error.
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);
    const ids = fulfilled.map((r) => r.value.id);
    expect(ids[0]).toBe(ids[1]); // both calls agree on the SAME invoice id

    // Ground truth: exactly one invoice with this key actually exists in Postgres.
    const invoices = await prisma.invoice.findMany({ where: { idempotencyKey: key } });
    expect(invoices).toHaveLength(1);

    // Stock deducted exactly once (5, not 10) — the real financial-duplication
    // symptom from the audit, now proven fixed at the database level.
    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(95);

    // Exactly one payment, one stock exit, one payment allocation — not two.
    const payments = await prisma.payment.findMany({ where: { invoiceId: ids[0] } });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount.toString()).toBe('10');
    const exits = await prisma.stockExit.findMany({ where: { invoiceId: ids[0] } });
    expect(exits).toHaveLength(1);
    const allocations = await prisma.paymentAllocation.findMany({ where: { invoiceId: ids[0] } });
    expect(allocations).toHaveLength(1);

    // Receiver ledger credited exactly once, for exactly $10 — not $20 from
    // both concurrent transactions independently crediting the account (the
    // second symptom from the forensic audit: money silently duplicated).
    const account = await prisma.userAccount.findUnique({ where: { userId: receiverId } });
    expect(account!.balance.toString()).toBe('10');
    const entries = await prisma.accountEntry.findMany({ where: { accountId: account!.id } });
    expect(entries).toHaveLength(1);
  });

  it('DIFFERENT idempotencyKeys, two concurrent requests: TWO genuinely separate sales are both created — never wrongly deduplicated', async () => {
    const packedStockId = await makePackedStock(100, bagTypeId);
    const dto = (key: string) => ({
      clientId, date: '2026-08-27', method: 'cash' as const,
      bags: [{ packedStockId, bagTypeId, bagTypeName: 'Test Bag', quantity: 5, pricePerBag: '2.00', currency: 'USD' as const }],
      idempotencyKey: key,
    });

    const results = await Promise.allSettled([
      walkInSales.create(dto(`${TAG}_key_a`) as any, CLERK_ID),
      walkInSales.create(dto(`${TAG}_key_b`) as any, CLERK_ID),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(fulfilled).toHaveLength(2);
    const ids = fulfilled.map((r) => r.value.id);
    expect(ids[0]).not.toBe(ids[1]); // two distinct invoices — real separate sales

    const invoices = await prisma.invoice.findMany({
      where: { idempotencyKey: { in: [`${TAG}_key_a`, `${TAG}_key_b`] } },
    });
    expect(invoices).toHaveLength(2);

    // Stock deducted twice (10 total) — both real sales actually happened.
    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(90);
  });

  it('NO idempotencyKey (backward compatible), two concurrent requests: both succeed as two separate sales, exactly as before this fix', async () => {
    const packedStockId = await makePackedStock(100, bagTypeId);
    const dto = () => ({
      clientId, date: '2026-08-27', method: 'cash' as const,
      bags: [{ packedStockId, bagTypeId, bagTypeName: 'Test Bag', quantity: 5, pricePerBag: '2.00', currency: 'USD' as const }],
      // no idempotencyKey — a caller that never opts in gets no dedup, same as
      // every walk-in sale before this fix (no regression for such a caller).
    });

    const results = await Promise.allSettled([
      walkInSales.create(dto() as any, CLERK_ID),
      walkInSales.create(dto() as any, CLERK_ID),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);

    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(90); // both went through, untouched by idempotency logic
  });

  it('SAME idempotencyKey reused with DIFFERENT sale data: sequentially, the second request is cleanly rejected — zero extra financial effects', async () => {
    // Sequential (not concurrent) — this scenario is about the APPLICATION-
    // LEVEL fingerprint check (a stale/reused key against an already-
    // COMMITTED sale), not the P2002 race; the mocked-Prisma unit tests cover
    // the P2002-recovery path's identical mismatch handling.
    const packedStockId = await makePackedStock(100, bagTypeId);
    const key = `${TAG}_reused_key`;

    const first = await walkInSales.create(
      {
        clientId, date: '2026-08-27', method: 'cash' as const,
        bags: [{ packedStockId, bagTypeId, bagTypeName: 'Test Bag', quantity: 5, pricePerBag: '2.00', currency: 'USD' as const }],
        receivedUsd: '10.00', receiverId, idempotencyKey: key,
      } as any,
      CLERK_ID,
    );

    // Same key, genuinely different data (5x the quantity, 5x the amount).
    await expect(
      walkInSales.create(
        {
          clientId, date: '2026-08-27', method: 'cash' as const,
          bags: [{ packedStockId, bagTypeId, bagTypeName: 'Test Bag', quantity: 25, pricePerBag: '2.00', currency: 'USD' as const }],
          receivedUsd: '50.00', receiverId, idempotencyKey: key,
        } as any,
        CLERK_ID,
      ),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });

    // Ground truth: still exactly the FIRST sale — nothing from the second,
    // rejected request landed anywhere.
    const invoices = await prisma.invoice.findMany({ where: { idempotencyKey: key } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].id).toBe(first.id);
    expect(invoices[0].total.toString()).toBe('10');

    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(95); // only the first sale's 5 bags — the rejected 25-bag request never touched stock

    const account = await prisma.userAccount.findUnique({ where: { userId: receiverId } });
    expect(account!.balance.toString()).toBe('10'); // only the first sale's credit — never $60
  });

  // ===========================================================================
  // Confirmed bug fix (second forensic audit, 2026-08-27): CREATE → CANCEL →
  // REUSE SAME KEY → NEW LIVE SALE. Before the partial-unique-index migration,
  // step 3 below silently returned the CANCELLED invoice from step 2 instead
  // of creating a new one — the exact bug this whole block proves fixed,
  // against a real Postgres transaction and the real partial unique index
  // (not a mock of either).
  // ===========================================================================
  describe('cancelled invoice + key reuse (confirmed bug fix)', () => {
    it('CREATE → CANCEL → REUSE SAME KEY → NEW LIVE SALE — the cancelled invoice is left completely untouched', async () => {
      const packedStockId = await makePackedStock(100, bagTypeId);
      const key = `${TAG}_cancel_reuse`;

      // 1) CREATE — a zero-payment ("on account") sale, the only kind
      // InvoicesService.cancel() will actually allow to be cancelled.
      const first = await walkInSales.create(
        {
          clientId, date: '2026-08-27', method: 'cash' as const,
          bags: [{ packedStockId, bagTypeId, bagTypeName: 'Test Bag', quantity: 5, pricePerBag: '2.00', currency: 'USD' as const }],
          idempotencyKey: key,
        } as any,
        CLERK_ID,
      );
      expect(first.status).toBe('issued');

      // 2) CANCEL
      const cancelled = await invoicesService.cancel(first.id);
      expect(cancelled.status).toBe('cancelled');

      // 3) REUSE SAME KEY — must create a genuinely NEW live invoice, not
      // return the cancelled one.
      const second = await walkInSales.create(
        {
          clientId, date: '2026-08-27', method: 'cash' as const,
          bags: [{ packedStockId, bagTypeId, bagTypeName: 'Test Bag', quantity: 5, pricePerBag: '2.00', currency: 'USD' as const }],
          receivedUsd: '10.00', receiverId, idempotencyKey: key,
        } as any,
        CLERK_ID,
      );

      // 4) Assert: two invoice rows exist historically under this key.
      const allWithKey = await prisma.invoice.findMany({
        where: { idempotencyKey: key },
        orderBy: { createdAt: 'asc' },
      });
      expect(allWithKey).toHaveLength(2);

      // First is cancelled, unchanged since step 2 — no status/amount/stock/
      // payment change from the retry.
      expect(allWithKey[0].id).toBe(first.id);
      expect(allWithKey[0].status).toBe('cancelled');
      expect(allWithKey[0].total.toString()).toBe('10');
      expect(allWithKey[0].paidAmount.toString()).toBe('0');
      const firstExits = await prisma.stockExit.findMany({ where: { invoiceId: first.id } });
      expect(firstExits).toHaveLength(1); // the ORIGINAL exit from step 1, untouched
      const firstPayments = await prisma.payment.findMany({ where: { invoiceId: first.id } });
      expect(firstPayments).toHaveLength(0); // never had one, still doesn't

      // Second is the NEW live sale — distinct id, real financial effects.
      expect(allWithKey[1].id).toBe(second.id);
      expect(allWithKey[1].id).not.toBe(first.id);
      expect(allWithKey[1].status).toBe('paid');
      expect(allWithKey[1].total.toString()).toBe('10');
      expect(allWithKey[1].paidAmount.toString()).toBe('10');

      // Stock reversal fix (2026-08-28, InvoicesService.cancel()): cancelling
      // step 1's zero-payment sale now restores its 5 bags (100 → 95 → 100),
      // so only step 3's live 5-bag sale leaves a net deduction — 95, not 90.
      const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
      expect(ps!.quantity).toBe(95);

      const secondPayments = await prisma.payment.findMany({ where: { invoiceId: second.id } });
      expect(secondPayments).toHaveLength(1);
      expect(secondPayments[0].amount.toString()).toBe('10');

      const account = await prisma.userAccount.findUnique({ where: { userId: receiverId } });
      expect(account!.balance.toString()).toBe('10'); // only from the second (live) sale
    });

    it('10 concurrent identical requests with the SAME key still produce exactly ONE live invoice (partial index preserves existing concurrency guarantee)', async () => {
      const packedStockId = await makePackedStock(200, bagTypeId);
      const key = `${TAG}_cancel_concurrency`;
      const dto = () => ({
        clientId, date: '2026-08-27', method: 'cash' as const,
        bags: [{ packedStockId, bagTypeId, bagTypeName: 'Test Bag', quantity: 2, pricePerBag: '2.00', currency: 'USD' as const }],
        idempotencyKey: key,
      });

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => walkInSales.create(dto() as any, CLERK_ID)),
      );
      const fulfilled = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(10);
      const ids = new Set(fulfilled.map((r) => r.value.id));
      expect(ids.size).toBe(1); // all 10 calls agree on the SAME single invoice

      const liveInvoices = await prisma.invoice.findMany({ where: { idempotencyKey: key, status: { not: 'cancelled' } } });
      expect(liveInvoices).toHaveLength(1);

      // Now cancel that winner and retry with the same key — proves the
      // partial index correctly allows exactly one NEW live row afterward,
      // never a second live duplicate.
      await invoicesService.cancel([...ids][0]);
      const retry = await walkInSales.create(dto() as any, CLERK_ID);
      expect(retry.id).not.toBe([...ids][0]);

      const allInvoices = await prisma.invoice.findMany({ where: { idempotencyKey: key } });
      expect(allInvoices).toHaveLength(2); // 1 cancelled + 1 new live
      const liveCount = allInvoices.filter((i) => i.status !== 'cancelled').length;
      expect(liveCount).toBe(1); // never two live rows under the same key
    });
  });
});
