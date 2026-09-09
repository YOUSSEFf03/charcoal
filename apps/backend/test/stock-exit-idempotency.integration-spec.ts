/**
 * Real-Postgres integration test — requires the dev DB running (docker compose up -d)
 * and DATABASE_URL configured (same as `npm run start:dev`). NOT part of `npm test`
 * (that suite is 100% mocked-Prisma, see stock-exits.service.spec.ts's own
 * "create() — idempotency" block) — run explicitly via `npm run test:integration`.
 *
 * Why this exists: the anonymous-walk-in idempotency gap (forensic audit, 2026-08-28).
 * WalkInSalesService.create()'s idempotencyKey/requestFingerprint protection
 * (walk-in-sale-idempotency.integration-spec.ts) only ever covers REGISTERED-client
 * sales — POST /walk-in-sales. Anonymous walk-in sales (no client selected in
 * WarehouseSales.tsx) go through a completely different endpoint, POST /stock-exits,
 * which had ZERO dedup: no key, no fingerprint, no unique constraint. A duplicate
 * request there double-deducted stock AND double-credited the collector's ledger
 * account — reproduced live below before the fix, same as the original audit did for
 * the registered-client path.
 *
 * Mirrors walk-in-sale-idempotency.integration-spec.ts's structure exactly (real
 * StockExitsService wired to the real PrismaService, no HTTP layer, no auth guards,
 * concurrent calls raced via Promise.allSettled).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StockExitsModule } from '../src/stock-exits/stock-exits.module';
import { StockExitsService } from '../src/stock-exits/stock-exits.service';

const TAG = `STOCKEXIT_IDEMPOTENCY_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner'; // matches the dev-auth-bypass seeded user (auth.guard.ts)

describe('Anonymous walk-in (stock-exit) idempotency — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let stockExits: StockExitsService;

  let collectorId: string;

  const createdBagTypeIds: string[] = [];
  const createdPackingSessionIds: string[] = [];
  const createdPackedStockIds: string[] = [];
  const createdLotIds: string[] = [];

  // Dedicated bag type per scenario — same isolation reasoning as
  // walk-in-sale-idempotency.integration-spec.ts's makeBagType(): a fresh,
  // uniquely named type with ample stock means each test's contention is
  // caused ONLY by the idempotency mechanism under test.
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
    createdLotIds.push(lot.id);
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
      imports: [PrismaModule, StockExitsModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    stockExits = moduleRef.get(StockExitsService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    // Dedicated collector fixture — self-contained, so the exactly-once
    // ledger-credit assertions below have a clean starting balance.
    const collector = await prisma.user.create({
      data: {
        clerkId: `local_${TAG}_collector`,
        email: `${TAG}_collector@local.internal`,
        name: `Idempotency Test Collector ${Date.now()}`,
        role: 'receiver',
      },
    });
    collectorId = collector.id;
  });

  // The collector fixture is SHARED across every test in this file, so its
  // UserAccount balance would otherwise accumulate across tests and break
  // the absolute-balance assertions below — reset between tests, same
  // pattern as walk-in-sale-idempotency.integration-spec.ts.
  afterEach(async () => {
    const account = await prisma.userAccount.findUnique({ where: { userId: collectorId } });
    if (account) {
      await prisma.accountEntry.deleteMany({ where: { accountId: account.id } });
      await prisma.userAccount.update({ where: { userId: collectorId }, data: { balance: 0 } });
    }
  });

  afterAll(async () => {
    const accountEntries = await prisma.accountEntry.findMany({ where: { account: { userId: collectorId } } });
    if (accountEntries.length > 0) {
      await prisma.accountEntry.deleteMany({ where: { id: { in: accountEntries.map((e) => e.id) } } });
    }
    await prisma.userAccount.deleteMany({ where: { userId: collectorId } });
    await prisma.stockExit.deleteMany({ where: { packedStockId: { in: createdPackedStockIds } } });
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
    await prisma.user.deleteMany({ where: { id: collectorId } });
    if (createdBagTypeIds.length > 0) {
      await prisma.bagType.deleteMany({ where: { id: { in: createdBagTypeIds } } });
    }

    await prisma.$disconnect();
  });

  it('anonymous normal sale succeeds: one StockExit, stock deducted once, collector credited once', async () => {
    const bagTypeId = await makeBagType();
    const packedStockId = await makePackedStock(100, bagTypeId);

    const exit = await stockExits.create(
      {
        packedStockId, bagTypeId, quantity: 5, exitType: 'walk_in' as any, date: '2026-08-28',
        recipient: 'Walk-in', amount: 10, currency: 'USD' as any, collectedById: collectorId,
        idempotencyKey: `${TAG}_normal`,
      } as any,
      CLERK_ID,
    );

    expect(exit.id).toBeDefined();
    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(95);
    const account = await prisma.userAccount.findUnique({ where: { userId: collectorId } });
    expect(account!.balance.toString()).toBe('10');
  });

  it('SAME idempotencyKey, two concurrent requests: exactly ONE StockExit is created (the anonymous-sale duplicate bug, now fixed)', async () => {
    const bagTypeId = await makeBagType();
    // Ample stock (100) so BOTH requests would succeed independently if
    // nothing deduplicated them — isolates this test to the idempotency
    // mechanism only, not stock-availability contention.
    const packedStockId = await makePackedStock(100, bagTypeId);
    const key = `${TAG}_same_key`;
    const dto = () => ({
      packedStockId, bagTypeId, quantity: 5, exitType: 'walk_in' as any, date: '2026-08-28',
      recipient: 'Walk-in', amount: 10, currency: 'USD' as any, collectedById: collectorId,
      idempotencyKey: key,
    });

    const results = await Promise.allSettled([
      stockExits.create(dto() as any, CLERK_ID),
      stockExits.create(dto() as any, CLERK_ID),
    ]);

    // Both calls resolve successfully — the "loser" of the race gets the
    // winner's exit back via the P2002-recovery path, not an error.
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);
    const ids = fulfilled.map((r) => r.value.id);
    expect(ids[0]).toBe(ids[1]); // both calls agree on the SAME exit id

    // Ground truth: exactly one stock exit with this key actually exists in Postgres.
    const exits = await prisma.stockExit.findMany({ where: { idempotencyKey: key } });
    expect(exits).toHaveLength(1);

    // Stock deducted exactly once (5, not 10) — the real financial-duplication
    // symptom from the audit, now proven fixed at the database level.
    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(95);

    // Collector ledger credited exactly once, for exactly $10 — not $20 from
    // both concurrent transactions independently crediting the account.
    const account = await prisma.userAccount.findUnique({ where: { userId: collectorId } });
    expect(account!.balance.toString()).toBe('10');
    const entries = await prisma.accountEntry.findMany({ where: { accountId: account!.id } });
    expect(entries).toHaveLength(1);
  });

  it('DIFFERENT idempotencyKeys, two concurrent requests: TWO genuinely separate legitimate sales are both created — never wrongly deduplicated', async () => {
    const bagTypeId = await makeBagType();
    const packedStockId = await makePackedStock(100, bagTypeId);
    const dto = (key: string) => ({
      packedStockId, bagTypeId, quantity: 5, exitType: 'walk_in' as any, date: '2026-08-28',
      recipient: 'Walk-in', amount: 10, currency: 'USD' as any, idempotencyKey: key,
    });

    const results = await Promise.allSettled([
      stockExits.create(dto(`${TAG}_key_a`) as any, CLERK_ID),
      stockExits.create(dto(`${TAG}_key_b`) as any, CLERK_ID),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(fulfilled).toHaveLength(2);
    const ids = fulfilled.map((r) => r.value.id);
    expect(ids[0]).not.toBe(ids[1]); // two distinct stock exits — real separate sales

    const exits = await prisma.stockExit.findMany({
      where: { idempotencyKey: { in: [`${TAG}_key_a`, `${TAG}_key_b`] } },
    });
    expect(exits).toHaveLength(2);

    // Stock deducted twice (10 total) — both real sales actually happened.
    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(90);
  });

  it('SAME idempotencyKey, same data, sequential retry: returns the ORIGINAL result — no new stock exit, no double deduction', async () => {
    const bagTypeId = await makeBagType();
    const packedStockId = await makePackedStock(100, bagTypeId);
    const key = `${TAG}_retry_same`;
    const dto = () => ({
      packedStockId, bagTypeId, quantity: 5, exitType: 'walk_in' as any, date: '2026-08-28',
      recipient: 'Walk-in', amount: 10, currency: 'USD' as any, collectedById: collectorId,
      idempotencyKey: key,
    });

    const first = await stockExits.create(dto() as any, CLERK_ID);
    const second = await stockExits.create(dto() as any, CLERK_ID);

    expect(second.id).toBe(first.id);
    const exits = await prisma.stockExit.findMany({ where: { idempotencyKey: key } });
    expect(exits).toHaveLength(1);
    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(95); // only the first attempt's 5 bags
    const account = await prisma.userAccount.findUnique({ where: { userId: collectorId } });
    expect(account!.balance.toString()).toBe('10'); // only one credit
  });

  it('SAME idempotencyKey reused with DIFFERENT data: sequentially, the second request is cleanly rejected — zero extra financial effects', async () => {
    const bagTypeId = await makeBagType();
    const packedStockId = await makePackedStock(100, bagTypeId);
    const key = `${TAG}_reused_key`;

    const first = await stockExits.create(
      {
        packedStockId, bagTypeId, quantity: 5, exitType: 'walk_in' as any, date: '2026-08-28',
        recipient: 'Walk-in', amount: 10, currency: 'USD' as any, collectedById: collectorId,
        idempotencyKey: key,
      } as any,
      CLERK_ID,
    );

    // Same key, genuinely different data (5x the quantity, 5x the amount).
    await expect(
      stockExits.create(
        {
          packedStockId, bagTypeId, quantity: 25, exitType: 'walk_in' as any, date: '2026-08-28',
          recipient: 'Walk-in', amount: 50, currency: 'USD' as any, collectedById: collectorId,
          idempotencyKey: key,
        } as any,
        CLERK_ID,
      ),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });

    // Ground truth: still exactly the FIRST exit — nothing from the second,
    // rejected request landed anywhere.
    const exits = await prisma.stockExit.findMany({ where: { idempotencyKey: key } });
    expect(exits).toHaveLength(1);
    expect(exits[0].id).toBe(first.id);
    expect(exits[0].quantity).toBe(5);

    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(95); // only the first sale's 5 bags — the rejected 25-bag request never touched stock

    const account = await prisma.userAccount.findUnique({ where: { userId: collectorId } });
    expect(account!.balance.toString()).toBe('10'); // only the first sale's credit — never $60
  });

  it('10 concurrent identical requests with the SAME key still produce exactly ONE stock exit', async () => {
    const bagTypeId = await makeBagType();
    const packedStockId = await makePackedStock(200, bagTypeId);
    const key = `${TAG}_ten_concurrent`;
    const dto = () => ({
      packedStockId, bagTypeId, quantity: 2, exitType: 'walk_in' as any, date: '2026-08-28',
      recipient: 'Walk-in', amount: 4, currency: 'USD' as any, idempotencyKey: key,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => stockExits.create(dto() as any, CLERK_ID)),
    );
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(10);
    const ids = new Set(fulfilled.map((r) => r.value.id));
    expect(ids.size).toBe(1); // all 10 calls agree on the SAME single exit

    const exits = await prisma.stockExit.findMany({ where: { idempotencyKey: key } });
    expect(exits).toHaveLength(1);
    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(198); // only ONE 2-bag deduction, not ten
  });

  // ===========================================================================
  // Baseline (documents the pre-fix behavior for a caller that opts out):
  // omitting idempotencyKey is still backward compatible — a caller that
  // never opts in gets no dedup, same as every stock exit before this fix
  // (sample/internal/gift exits, fill-job pickups, and any pre-existing
  // direct API caller). This is NOT a regression — it is the documented,
  // deliberate scope of an OPTIONAL field.
  // ===========================================================================
  it('NO idempotencyKey (backward compatible): two concurrent requests both succeed as two separate exits, exactly as before this fix', async () => {
    const bagTypeId = await makeBagType();
    const packedStockId = await makePackedStock(100, bagTypeId);
    const dto = () => ({
      packedStockId, bagTypeId, quantity: 5, exitType: 'walk_in' as any, date: '2026-08-28',
      recipient: 'Walk-in', amount: 10, currency: 'USD' as any,
      // no idempotencyKey
    });

    const results = await Promise.allSettled([
      stockExits.create(dto() as any, CLERK_ID),
      stockExits.create(dto() as any, CLERK_ID),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);

    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(90); // both went through, untouched by idempotency logic
  });
});
