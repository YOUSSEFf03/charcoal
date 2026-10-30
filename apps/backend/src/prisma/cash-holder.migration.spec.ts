import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Cash Management System, Phase 2 (PR 10) — migration smoke test.
 *
 * PR 10 is infrastructure-only: the `CashHolder` table/enum must exist and be
 * queryable, but nothing in production code references it yet. There is no
 * CashHolderService to unit-test against mocks (that's PR 11), so this test
 * talks to the real database directly to prove the migration applied cleanly.
 */
describe('CashHolder migration (PR 10 smoke test)', () => {
  const prisma = new PrismaClient();
  const createdIds: string[] = [];
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length > 0) {
      await prisma.cashHolder.deleteMany({ where: { id: { in: createdIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  const allTypes = ['person', 'drawer', 'safe', 'vehicle', 'bank_account', 'branch'] as const;

  it('creates one CashHolder row of each type', async () => {
    for (const type of allTypes) {
      const holder = await prisma.cashHolder.create({
        data: { type, label: `PR10 smoke test — ${type}` },
      });
      createdIds.push(holder.id);
      expect(holder.type).toBe(type);
      expect(holder.active).toBe(true);
      expect(holder.userId).toBeNull();
      expect(holder.branchId).toBeNull();
      expect(holder.createdAt).toBeInstanceOf(Date);
      expect(holder.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('looks up a created CashHolder by id', async () => {
    const created = await prisma.cashHolder.create({
      data: { type: 'drawer', label: 'PR10 smoke test — lookup' },
    });
    createdIds.push(created.id);

    const found = await prisma.cashHolder.findUnique({ where: { id: created.id } });
    expect(found).not.toBeNull();
    expect(found?.label).toBe('PR10 smoke test — lookup');
  });

  it('rejects an invalid type at the database level', async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO cash_holders (id, type, label, "updatedAt") VALUES (gen_random_uuid()::text, 'not_a_real_type', 'invalid', now())`,
    ).rejects.toThrow();
  });

  it('supports an optional 1:1 link to a real User for type=person', async () => {
    // Create a throwaway user rather than borrowing an existing one: CI runs
    // against an empty, freshly-migrated database with no users in it.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        clerkId: `pr10-smoke-${suffix}`,
        email: `pr10-smoke-${suffix}@test.local`,
        name: 'PR10 smoke test user',
        role: 'worker',
      },
    });
    createdUserIds.push(user.id);

    const holder = await prisma.cashHolder.create({
      data: { type: 'person', label: 'PR10 smoke test — person', userId: user!.id },
    });
    createdIds.push(holder.id);
    expect(holder.userId).toBe(user!.id);

    // Optional 1:1 — a second CashHolder cannot reuse the same userId.
    await expect(
      prisma.cashHolder.create({
        data: { type: 'person', label: 'PR10 smoke test — person duplicate', userId: user!.id },
      }),
    ).rejects.toThrow();
  });

  it('non-person holder types never require a userId', async () => {
    const holder = await prisma.cashHolder.create({
      data: { type: 'safe', label: 'PR10 smoke test — no user' },
    });
    createdIds.push(holder.id);
    expect(holder.userId).toBeNull();
  });

  it('supports an inactive state, explicitly set at creation', async () => {
    const holder = await prisma.cashHolder.create({
      data: { type: 'vehicle', label: 'PR10 smoke test — inactive', active: false },
    });
    createdIds.push(holder.id);
    expect(holder.active).toBe(false);
  });

  it('future holder types (bank_account, branch) are already supported by the enum with no schema change needed', async () => {
    const bank = await prisma.cashHolder.create({
      data: { type: 'bank_account', label: 'PR10 smoke test — bank' },
    });
    const branch = await prisma.cashHolder.create({
      data: { type: 'branch', label: 'PR10 smoke test — branch' },
    });
    createdIds.push(bank.id, branch.id);
    expect(bank.type).toBe('bank_account');
    expect(branch.type).toBe('branch');
  });
});
