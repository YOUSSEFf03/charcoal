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
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CashHandoversModule } from '../src/cash-handovers/cash-handovers.module';
import { CashHandoversService } from '../src/cash-handovers/cash-handovers.service';

const TAG = `CASH_HANDOVER_EXP_${Date.now()}`;
const CLERK_ID = 'user_test_owner'; // matches the dev-auth-bypass seeded user (auth.guard.ts)

describe('CashHandoverExpense persistence — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: CashHandoversService;

  let receiverId: string;
  const handoverIds: string[] = [];

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
  });

  afterAll(async () => {
    for (const id of handoverIds) {
      await prisma.accountEntry.deleteMany({ where: { referenceId: id } });
      await prisma.cashHandoverExpense.deleteMany({ where: { cashHandoverId: id } });
      await prisma.cashHandover.delete({ where: { id } }).catch(() => {});
    }
    await prisma.userAccount.deleteMany({ where: { userId: receiverId } });
    if (receiverId) await prisma.user.delete({ where: { id: receiverId } }).catch(() => {});

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
          { description: 'Gas', amount: '20.00' },
          { description: 'Parking', amount: '5.00' },
        ],
      },
      CLERK_ID,
    );
    handoverIds.push(created.id);

    // 4. expectedAmt = collected - sum(expenses)
    expect(parseFloat(created.expectedAmt.toString())).toBeCloseTo(475.0, 2);
    expect(parseFloat(created.handedAmt.toString())).toBeCloseTo(475.0, 2);
    expect(parseFloat(created.difference.toString())).toBeCloseTo(0, 2);

    // 5. both CashHandoverExpense rows exist, correct amounts
    const rows = await prisma.cashHandoverExpense.findMany({
      where: { cashHandoverId: created.id },
      orderBy: { description: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ description: 'Gas', });
    expect(parseFloat(rows[0].amount.toString())).toBeCloseTo(20.0, 2);
    expect(rows[1]).toMatchObject({ description: 'Parking' });
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
        expenses: [{ description: 'Toll', amount: '20.00' }],
      },
      CLERK_ID,
    );
    handoverIds.push(created.id);

    const rows = await prisma.cashHandoverExpense.findMany({ where: { cashHandoverId: created.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('Toll');
  });

  it('7. a failed transaction (invalid receiverId) leaves no orphan expense rows', async () => {
    await expect(
      svc.create(
        {
          date: '2026-01-04',
          receiverId: '00000000-0000-4000-8000-000000000000', // does not exist
          expectedAmt: '50.00',
          handedAmt: '50.00',
          expenses: [{ description: 'Should not persist', amount: '999.00' }],
        },
        CLERK_ID,
      ),
    ).rejects.toThrow();

    const orphans = await prisma.cashHandoverExpense.findMany({ where: { description: 'Should not persist' } });
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
