/**
 * Real-Postgres integration test — requires the dev DB running and DATABASE_URL configured.
 * NOT part of `npm test` (mocked-Prisma only) — run via `npm run test:integration`.
 *
 * Why this exists: proves CashHandoverExpense rows are actually persisted, atomic with
 * their parent CashHandover, survive a fresh read, and are consistent with the amount
 * used to compute expectedAmt — the exact bug (itemized expenses silently discarded on
 * submit) that this task fixes. A mocked-Prisma unit test proves the code path but not
 * the real Decimal/FK/cascade behavior through Postgres.
 *
 * Creates its own isolated fixtures (uniquely-tagged User receiver/logger) and deletes
 * everything it created in afterAll, with cleanup verified — safe to run repeatedly.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import Decimal from 'decimal.js';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CashHandoversModule } from '../src/cash-handovers/cash-handovers.module';
import { CashHandoversService } from '../src/cash-handovers/cash-handovers.service';
import { LedgerWriteService } from '../src/ledger/ledger-write.service';
import { BalanceQueryService } from '../src/ledger/balance-query.service';

const TAG = `CASH_HANDOVER_EXP_${Date.now()}`;
const CLERK_ID = 'user_test_owner'; // matches the dev-auth-bypass seeded user (auth.guard.ts)

describe('CashHandoverExpense persistence — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: CashHandoversService;

  let receiverId: string;
  const handoverIds: string[] = [];
  let catGasId: string, catParkingId: string, catTollId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CashHandoversModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    svc = moduleRef.get(CashHandoversService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const receiver = await prisma.user.create({
      data: { clerkId: `${TAG}_receiver`, email: `${TAG}@example.com`, name: TAG, role: 'sales_rep' },
    });
    receiverId = receiver.id;

    const [catGas, catParking, catToll] = await Promise.all([
      prisma.expenseCategory.create({ data: { name: `${TAG}_Gas` } }),
      prisma.expenseCategory.create({ data: { name: `${TAG}_Parking` } }),
      prisma.expenseCategory.create({ data: { name: `${TAG}_Toll` } }),
    ]);
    catGasId = catGas.id; catParkingId = catParking.id; catTollId = catToll.id;
  });

  afterAll(async () => {
    for (const id of handoverIds) {
      await prisma.accountEntry.deleteMany({ where: { referenceId: id } });
      await prisma.cashHandoverExpense.deleteMany({ where: { cashHandoverId: id } });
      await prisma.cashHandover.delete({ where: { id } }).catch(() => {});
    }
    await prisma.userAccount.deleteMany({ where: { userId: receiverId } });
    if (receiverId) await prisma.user.delete({ where: { id: receiverId } }).catch(() => {});
    await prisma.expenseCategory.deleteMany({ where: { id: { in: [catGasId, catParkingId, catTollId] } } });

    const leftoverExpenses = await prisma.cashHandoverExpense.findMany({ where: { cashHandoverId: { in: handoverIds } } });
    const leftoverHandovers = await prisma.cashHandover.findMany({ where: { id: { in: handoverIds } } });
    const leftoverUser = await prisma.user.findUnique({ where: { id: receiverId } });
    // eslint-disable-next-line no-console
    console.log('CLEANUP VERIFICATION — all should be empty/null:', { leftoverExpenses, leftoverHandovers, leftoverUser });
    expect(leftoverExpenses).toHaveLength(0);
    expect(leftoverHandovers).toHaveLength(0);
    expect(leftoverUser).toBeNull();

    await moduleRef.close();
  });

  it('1. creates a handover with NO expenses — succeeds, zero CashHandoverExpense rows', async () => {
    const created = await svc.create(
      { date: '2026-01-01', receiverId, expectedAmt: '100.00', handedAmt: '100.00', notes: 'no expenses' },
      CLERK_ID,
    );
    handoverIds.push(created.id);
    expect((created as any).expenses).toEqual([]);

    const rows = await prisma.cashHandoverExpense.findMany({ where: { cashHandoverId: created.id } });
    expect(rows).toHaveLength(0);
  });

  it('2-6. Collected $500, Gas $20 + Parking $5 → expected $475, handed $475, both rows persist and survive a fresh read', async () => {
    const created = await svc.create(
      {
        date: '2026-01-02',
        receiverId,
        expectedAmt: '475.00', // 500 collected - (20 + 5), computed the same way the frontend does
        handedAmt: '475.00',
        notes: 'gas + parking deducted',
        expenses: [
          { categoryId: catGasId, amount: '20.00' },
          { categoryId: catParkingId, amount: '5.00' },
        ],
      },
      CLERK_ID,
    );
    handoverIds.push(created.id);

    // 4. expectedAmt = collected - sum(expenses)
    expect(parseFloat(created.expectedAmt.toString())).toBeCloseTo(475.0, 2);
    expect(parseFloat(created.handedAmt.toString())).toBeCloseTo(475.0, 2);
    expect(parseFloat(created.difference.toString())).toBeCloseTo(0, 2);

    // 5. both CashHandoverExpense rows exist, correct amounts — `description`
    // is derived server-side from the category's own name (see
    // CashHandoversService.create()).
    const rows = await prisma.cashHandoverExpense.findMany({
      where: { cashHandoverId: created.id },
      orderBy: { description: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ description: `${TAG}_Gas`, categoryId: catGasId });
    expect(parseFloat(rows[0].amount.toString())).toBeCloseTo(20.0, 2);
    expect(rows[1]).toMatchObject({ description: `${TAG}_Parking`, categoryId: catParkingId });
    expect(parseFloat(rows[1].amount.toString())).toBeCloseTo(5.0, 2);

    // 6. survives a completely fresh read (not the create() response)
    const refetched = await prisma.cashHandover.findUnique({
      where: { id: created.id },
      include: { expenses: true },
    });
    expect(refetched!.expenses).toHaveLength(2);
    const total = refetched!.expenses.reduce((s, e) => s + parseFloat(e.amount.toString()), 0);
    expect(total).toBeCloseTo(25.0, 2);
  });

  it('3. creates a handover with a single expense', async () => {
    const created = await svc.create(
      {
        date: '2026-01-03',
        receiverId,
        expectedAmt: '80.00',
        handedAmt: '80.00',
        expenses: [{ categoryId: catTollId, amount: '20.00' }],
      },
      CLERK_ID,
    );
    handoverIds.push(created.id);

    const rows = await prisma.cashHandoverExpense.findMany({ where: { cashHandoverId: created.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe(`${TAG}_Toll`);
    expect(rows[0].categoryId).toBe(catTollId);
  });

  it('7. a failed transaction (invalid receiverId) leaves no orphan expense rows', async () => {
    await expect(
      svc.create(
        {
          date: '2026-01-04',
          receiverId: '00000000-0000-4000-8000-000000000000', // does not exist
          expectedAmt: '50.00',
          handedAmt: '50.00',
          expenses: [{ categoryId: catTollId, amount: '999.00' }],
        },
        CLERK_ID,
      ),
    ).rejects.toThrow();

    const orphans = await prisma.cashHandoverExpense.findMany({ where: { categoryId: catTollId, amount: '999.00' } });
    expect(orphans).toHaveLength(0);
  });

  it('9. an existing handover created without expenses still reads fine with an empty expenses array', async () => {
    const created = await svc.create(
      { date: '2026-01-05', receiverId, expectedAmt: '10.00', handedAmt: '10.00' },
      CLERK_ID,
    );
    handoverIds.push(created.id);

    const list = await svc.findAll(1, 20, '2026-01-05', '2026-01-05');
    const found = list.data.find(h => h.id === created.id);
    expect(found).toBeDefined();
    expect((found as any).expenses).toEqual([]);
  });
});

/**
 * Forensic audit (2026-08-30): reproduces the exact reported bug — $500 held,
 * $40 expense kept from collection, $460 physically handed over. The UI
 * correctly computed "$460 expected" and logged the handover, but the
 * receiver's persisted ledger balance (UserAccount.balance, read the next day
 * via BalanceQueryService — the same source CashHandover.tsx's "pending
 * balances" card and per-receiver detail card both read) was left at $40
 * instead of $0, because create() only ever debited the physical handedAmt,
 * never the itemized expenses. Fixed: the debit now settles handedAmt +
 * Σexpenses. This file proves the fix through the REAL persisted flow —
 * credit (simulating cash collected) → create() handover → read balance via
 * the same BalanceQueryService the UI calls — not just the mocked-Prisma
 * unit test in cash-handovers.service.spec.ts.
 */
describe('Cash handover ledger settlement (real Postgres) — forensic audit 2026-08-30', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: CashHandoversService;
  let ledger: LedgerWriteService;
  let balances: BalanceQueryService;

  let receiverId: string;
  const handoverIds: string[] = [];
  let catFuelId: string, catParkingId: string, catTollId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CashHandoversModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    svc = moduleRef.get(CashHandoversService);
    ledger = moduleRef.get(LedgerWriteService);
    balances = moduleRef.get(BalanceQueryService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const receiver = await prisma.user.create({
      data: { clerkId: `${TAG}_settle_receiver`, email: `${TAG}_settle@example.com`, name: `youssef_${TAG}`, role: 'sales_rep' },
    });
    receiverId = receiver.id;

    const [catFuel, catParking, catToll] = await Promise.all([
      prisma.expenseCategory.create({ data: { name: `${TAG}_settle_Fuel` } }),
      prisma.expenseCategory.create({ data: { name: `${TAG}_settle_Parking` } }),
      prisma.expenseCategory.create({ data: { name: `${TAG}_settle_Toll` } }),
    ]);
    catFuelId = catFuel.id; catParkingId = catParking.id; catTollId = catToll.id;
  });

  afterAll(async () => {
    for (const id of handoverIds) {
      await prisma.accountEntry.deleteMany({ where: { referenceId: id } });
      await prisma.cashHandoverExpense.deleteMany({ where: { cashHandoverId: id } });
      await prisma.cashHandover.delete({ where: { id } }).catch(() => {});
    }
    const account = await prisma.userAccount.findUnique({ where: { userId: receiverId } });
    if (account) await prisma.accountEntry.deleteMany({ where: { accountId: account.id } });
    await prisma.userAccount.deleteMany({ where: { userId: receiverId } });
    if (receiverId) await prisma.user.delete({ where: { id: receiverId } }).catch(() => {});
    await prisma.expenseCategory.deleteMany({ where: { id: { in: [catFuelId, catParkingId, catTollId] } } });
    await moduleRef.close();
  });

  /** Simulates cash actually collected that day (payment/sale credits) — the
   * real preconditions for the receiver to be "holding" custody at all. */
  async function creditReceiver(amount: string, date: string, refId: string) {
    await prisma.$transaction(async (tx) => {
      await ledger.creditAccount(tx, receiverId, new Decimal(amount), 'sale_collected', refId, 'Test collection', new Date(date));
    });
  }

  it('CASE 1 + CASE 8 — $500 held, $40 expense, $460 handed → receiver balance is $0 the next day, and they no longer appear in getAllBalances()', async () => {
    await creditReceiver('500.00', '2026-08-29', `${TAG}-case1-credit`);

    const created = await svc.create(
      {
        date: '2026-08-29', receiverId,
        expectedAmt: '460.00', handedAmt: '460.00',
        expenses: [{ categoryId: catFuelId, amount: '40.00' }],
      },
      CLERK_ID,
    );
    handoverIds.push(created.id);

    // Same read path CashHandover.tsx uses for the receiver detail card.
    const detail = await balances.getReceiverBalance(receiverId);
    expect(parseFloat(detail.balance)).toBeCloseTo(0, 2);

    // Same read path for the "pending balances" card — a $0 balance must not
    // appear as an outstanding pending balance.
    const all = await balances.getAllBalances();
    expect(all.find(b => b.userId === receiverId)).toBeUndefined();
  });

  it('CASE 3 — $500 held, $40 expense, $450 handed (short) → $10 remains on custody', async () => {
    await creditReceiver('500.00', '2026-08-29', `${TAG}-case3-credit`);

    const created = await svc.create(
      {
        date: '2026-08-29', receiverId,
        expectedAmt: '460.00', handedAmt: '450.00',
        expenses: [{ categoryId: catFuelId, amount: '40.00' }],
      },
      CLERK_ID,
    );
    handoverIds.push(created.id);

    const detail = await balances.getReceiverBalance(receiverId);
    expect(parseFloat(detail.balance)).toBeCloseTo(10, 2);

    // Clean the ledger back to 0 so the next test in this file starts fresh.
    await prisma.$transaction(async (tx) => {
      await ledger.debitAccount(tx, receiverId, new Decimal('10.00'), `${TAG}-case3-cleanup`, new Date('2026-08-29'));
    });
  });

  it('CASE 5 — multiple expenses ($20 + $20), $460 handed → $0 balance', async () => {
    await creditReceiver('500.00', '2026-08-29', `${TAG}-case5-credit`);

    const created = await svc.create(
      {
        date: '2026-08-29', receiverId,
        expectedAmt: '460.00', handedAmt: '460.00',
        expenses: [
          { categoryId: catFuelId, amount: '20.00' },
          { categoryId: catParkingId, amount: '20.00' },
        ],
      },
      CLERK_ID,
    );
    handoverIds.push(created.id);

    const detail = await balances.getReceiverBalance(receiverId);
    expect(parseFloat(detail.balance)).toBeCloseTo(0, 2);
  });

  it('CASE 7 — a second handover on a later day settles only ITS OWN expense, never re-deducting the first handover\'s already-settled $40', async () => {
    // First day: fully settled to $0 (mirrors CASE 1).
    await creditReceiver('500.00', '2026-08-29', `${TAG}-case7-credit1`);
    const h1 = await svc.create(
      {
        date: '2026-08-29', receiverId,
        expectedAmt: '460.00', handedAmt: '460.00',
        expenses: [{ categoryId: catFuelId, amount: '40.00' }],
      },
      CLERK_ID,
    );
    handoverIds.push(h1.id);
    expect(parseFloat((await balances.getReceiverBalance(receiverId)).balance)).toBeCloseTo(0, 2);

    // Second, independent day: $300 held, $10 expense, $290 handed → $0 again.
    // If the first handover's expense were ever re-applied, this would NOT be $0.
    await creditReceiver('300.00', '2026-08-30', `${TAG}-case7-credit2`);
    const h2 = await svc.create(
      {
        date: '2026-08-30', receiverId,
        expectedAmt: '290.00', handedAmt: '290.00',
        expenses: [{ categoryId: catTollId, amount: '10.00' }],
      },
      CLERK_ID,
    );
    handoverIds.push(h2.id);

    const detail = await balances.getReceiverBalance(receiverId);
    expect(parseFloat(detail.balance)).toBeCloseTo(0, 2);
  });
});
