import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { CashHandoversService } from './cash-handovers.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerWriteService } from '../ledger/ledger-write.service';
import { BalanceQueryService } from '../ledger/balance-query.service';
import { UsersService } from '../users/users.service';

// ---------------------------------------------------------------------------
// PR 1 regression test — CashHandoversService.create() now delegates its debit
// to LedgerWriteService instead of an inline module-level function. This suite
// uses the REAL LedgerWriteService (not a mock) so the assertions exercise the
// full delegation chain and prove the resulting UserAccount/AccountEntry writes
// are byte-identical to what the original inline implementation produced.
// BalanceQueryService is mocked since create() never calls it.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

describe('CashHandoversService.create() — PR 1 regression', () => {
  let service: CashHandoversService;

  const mockPrisma = {
    user: { findUnique: fn() },
    expenseCategory: { findMany: fn() },
    $transaction: fn(),
  };

  const mockBalanceQueryService = {
    getAllBalances: fn(),
    getReceiverBalance: fn(),
  };

  // PR 6: the real LedgerWriteService now requires UsersService (holder
  // validation on creditAccount()). create()'s debit path never calls
  // creditAccount, so this mock's return value is never exercised here —
  // it only needs to exist to satisfy LedgerWriteService's constructor.
  const mockUsersService = { validateCashCapable: fn() };

  function makeTx() {
    return {
      cashHandover: { create: fn() },
      userAccount: { upsert: fn() },
      accountEntry: { create: fn() },
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUsersService.validateCashCapable.mockResolvedValue(undefined);
    // Default: no expense categories needed (every pre-existing test below
    // that doesn't send `expenses` is unaffected). Tests that DO send
    // expenses override with their own category rows.
    mockPrisma.expenseCategory.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashHandoversService,
        { provide: PrismaService, useValue: mockPrisma },
        LedgerWriteService, // real implementation — not mocked, see file header
        { provide: BalanceQueryService, useValue: mockBalanceQueryService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    service = module.get<CashHandoversService>(CashHandoversService);
  });

  const baseDto = {
    date: '2026-07-31',
    receiverId: 'receiver-1',
    expectedAmt: '25.00',
    handedAmt: '25.00',
    notes: 'End of day handover',
  };

  it('creates the CashHandover record and delegates the debit to LedgerWriteService, producing the identical ledger effect as the original inline implementation', async () => {
    const tx = makeTx();

    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' }) // logger lookup
      .mockResolvedValueOnce({ id: 'receiver-1', name: 'Dev owner' });    // receiver lookup

    tx.cashHandover.create.mockResolvedValue({
      id: 'handover-1',
      date: new Date('2026-07-31'),
      receiverName: 'Dev owner',
      receiverId: 'receiver-1',
      expectedAmt: '25.00',
      handedAmt: '25.00',
      difference: '0.00',
      notes: baseDto.notes,
      loggedById: 'logger-1',
    });
    tx.userAccount.upsert.mockResolvedValue({ id: 'account-1', userId: 'receiver-1', balance: 0 });

    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const result = await service.create(baseDto, 'clerk-logger');

    // 1) The handover document is created with expected/handed/difference computed identically.
    expect(tx.cashHandover.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          receiverId: 'receiver-1',
          receiverName: 'Dev owner',
          expectedAmt: '25.00',
          handedAmt: '25.00',
          difference: '0.00',
          loggedById: 'logger-1',
        }),
      }),
    );

    // 2) Ledger effect: UserAccount decremented by exactly the handed amount —
    //    identical to what the original inline debitAccount() did before PR 1.
    expect(tx.userAccount.upsert).toHaveBeenCalledWith({
      where: { userId: 'receiver-1' },
      update: { balance: { decrement: 25 } },
      create: { userId: 'receiver-1', balance: -25 },
    });

    // 3) Ledger entry: negated amount, type=handover, referencing the handover id —
    //    identical shape to the original inline implementation.
    expect(tx.accountEntry.create).toHaveBeenCalledWith({
      data: {
        accountId: 'account-1',
        amount: '-25.00',
        type: 'handover',
        referenceId: 'handover-1',
        description: 'Cash handover',
        date: new Date('2026-07-31'),
      },
    });

    // 4) The handover row created is exactly what's returned to the caller.
    expect(result).toMatchObject({ id: 'handover-1', handedAmt: '25.00' });
  });

  it('debits by the actual handed amount, not the expected amount, when they differ', async () => {
    const tx = makeTx();

    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
      .mockResolvedValueOnce({ id: 'receiver-1', name: 'Dev owner' });

    tx.cashHandover.create.mockResolvedValue({ id: 'handover-2' });
    tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });

    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.create({ ...baseDto, expectedAmt: '30.00', handedAmt: '25.00' }, 'clerk-logger');

    expect(tx.cashHandover.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ expectedAmt: '30.00', handedAmt: '25.00', difference: '-5.00' }),
      }),
    );
    // Debited by the ACTUAL handed amount (25), not the expected amount (30) —
    // matching the original behavior exactly.
    expect(tx.userAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { balance: { decrement: 25 } } }),
    );
  });

  it('throws NotFoundException when the logging user does not exist', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'receiver-1', name: 'Dev owner' });

    await expect(service.create(baseDto, 'clerk-logger')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the receiver does not exist', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
      .mockResolvedValueOnce(null);

    await expect(service.create(baseDto, 'clerk-logger')).rejects.toThrow(NotFoundException);
  });

  it('never calls BalanceQueryService — create() only delegates to LedgerWriteService', async () => {
    const tx = makeTx();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
      .mockResolvedValueOnce({ id: 'receiver-1', name: 'Dev owner' });
    tx.cashHandover.create.mockResolvedValue({ id: 'handover-3' });
    tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.create(baseDto, 'clerk-logger');

    expect(mockBalanceQueryService.getAllBalances).not.toHaveBeenCalled();
    expect(mockBalanceQueryService.getReceiverBalance).not.toHaveBeenCalled();
  });

  it('creates a handover with NO itemized expenses — data has no expenses key at all (backward compatible)', async () => {
    const tx = makeTx();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
      .mockResolvedValueOnce({ id: 'receiver-1', name: 'Dev owner' });
    tx.cashHandover.create.mockResolvedValue({ id: 'handover-4', expenses: [] });
    tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.create(baseDto, 'clerk-logger');

    const call = tx.cashHandover.create.mock.calls[0][0];
    expect(call.data.expenses).toBeUndefined();
    expect(call.include.expenses).toBe(true);
  });

  it('creates a handover with ONE itemized expense — persisted as a nested CashHandoverExpense create', async () => {
    const tx = makeTx();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
      .mockResolvedValueOnce({ id: 'receiver-1', name: 'Dev owner' });
    tx.cashHandover.create.mockResolvedValue({ id: 'handover-5' });
    tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });
    mockPrisma.expenseCategory.findMany.mockResolvedValue([{ id: 'cat-gas', name: 'Gas' }]);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.create(
      { ...baseDto, expectedAmt: '5.00', expenses: [{ categoryId: 'cat-gas', amount: '20' }] },
      'clerk-logger',
    );

    const call = tx.cashHandover.create.mock.calls[0][0];
    expect(call.data.expenses).toEqual({ create: [{ description: 'Gas', amount: '20.00', categoryId: 'cat-gas' }] });
  });

  it('creates a handover with MULTIPLE itemized expenses — all persisted, amounts normalized to 2dp', async () => {
    const tx = makeTx();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
      .mockResolvedValueOnce({ id: 'receiver-1', name: 'Dev owner' });
    tx.cashHandover.create.mockResolvedValue({ id: 'handover-6' });
    tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });
    mockPrisma.expenseCategory.findMany.mockResolvedValue([
      { id: 'cat-gas', name: 'Gas' },
      { id: 'cat-parking', name: 'Parking' },
    ]);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.create(
      {
        ...baseDto,
        expectedAmt: '0.00',
        expenses: [
          { categoryId: 'cat-gas', amount: '20' },
          { categoryId: 'cat-parking', amount: '5' },
        ],
      },
      'clerk-logger',
    );

    const call = tx.cashHandover.create.mock.calls[0][0];
    expect(call.data.expenses).toEqual({
      create: [
        { description: 'Gas', amount: '20.00', categoryId: 'cat-gas' },
        { description: 'Parking', amount: '5.00', categoryId: 'cat-parking' },
      ],
    });
  });

  // ---------------------------------------------------------------------------
  // Forensic audit (2026-08-30): itemized expenses were persisted for display
  // (CashHandoverExpense rows, expectedAmt math) but never debited from the
  // receiver's ledger — leaving a permanent residual balance equal to the
  // expense total after every expense-bearing handover. Fixed: the ledger
  // debit is now handedAmt + Σexpenses, settling the FULL custody
  // (500 held − 40 expense − 460 handed = 0), never just the physical handover.
  // ---------------------------------------------------------------------------
  describe('ledger settlement includes expenses kept from collection (forensic audit, 2026-08-30)', () => {
    it('CASE 1 — $500 held, $40 expense, $460 handed: ledger debits $500 (handed + expense), not just $460', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
        .mockResolvedValueOnce({ id: 'receiver-1', name: 'youssef' });
      tx.cashHandover.create.mockResolvedValue({ id: 'handover-7' });
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });
      mockPrisma.expenseCategory.findMany.mockResolvedValue([{ id: 'cat-fuel', name: 'Fuel' }]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(
        {
          date: '2026-08-29', receiverId: 'receiver-1',
          expectedAmt: '460.00', handedAmt: '460.00',
          expenses: [{ categoryId: 'cat-fuel', amount: '40.00' }],
        },
        'clerk-logger',
      );

      expect(tx.userAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { balance: { decrement: 500 } } }),
      );
      expect(tx.accountEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: '-500.00' }) }),
      );
    });

    it('CASE 2 — $500 held, $0 expense, $500 handed: ledger debits exactly $500 (unchanged, no expenses)', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
        .mockResolvedValueOnce({ id: 'receiver-1', name: 'youssef' });
      tx.cashHandover.create.mockResolvedValue({ id: 'handover-8' });
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(
        { date: '2026-08-29', receiverId: 'receiver-1', expectedAmt: '500.00', handedAmt: '500.00' },
        'clerk-logger',
      );

      expect(tx.userAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { balance: { decrement: 500 } } }),
      );
    });

    it('CASE 3 — $500 held, $40 expense, $450 handed (short by $10 of expected): ledger debits $490, leaving $10 on custody', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
        .mockResolvedValueOnce({ id: 'receiver-1', name: 'youssef' });
      tx.cashHandover.create.mockResolvedValue({ id: 'handover-9' });
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });
      mockPrisma.expenseCategory.findMany.mockResolvedValue([{ id: 'cat-fuel', name: 'Fuel' }]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(
        {
          date: '2026-08-29', receiverId: 'receiver-1',
          expectedAmt: '460.00', handedAmt: '450.00',
          expenses: [{ categoryId: 'cat-fuel', amount: '40.00' }],
        },
        'clerk-logger',
      );

      // 450 handed + 40 expense = 490 settled — a $500 starting custody leaves $10.
      expect(tx.userAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { balance: { decrement: 490 } } }),
      );
    });

    it('CASE 4 — over-handover ($500 handed against a $460 expected) is NOT rejected — existing accept-and-record-difference rule is unchanged; settles the full $540', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
        .mockResolvedValueOnce({ id: 'receiver-1', name: 'youssef' });
      tx.cashHandover.create.mockResolvedValue({ id: 'handover-10' });
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });
      mockPrisma.expenseCategory.findMany.mockResolvedValue([{ id: 'cat-fuel', name: 'Fuel' }]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(
        {
          date: '2026-08-29', receiverId: 'receiver-1',
          expectedAmt: '460.00', handedAmt: '500.00',
          expenses: [{ categoryId: 'cat-fuel', amount: '40.00' }],
        },
        'clerk-logger',
      );

      // No rejection path exists in create() for handed > expected — this test
      // proves that pre-existing behavior is unchanged by this fix (not
      // inventing a new validation rule), while confirming the settlement math:
      // 500 handed + 40 expense = 540 debited (over by 40 relative to the 500
      // starting custody, recorded as CashHandover.difference = +40).
      expect(tx.cashHandover.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ difference: '40.00' }) }),
      );
      expect(tx.userAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { balance: { decrement: 540 } } }),
      );
    });

    it('CASE 5 — multiple expenses ($20 + $20) sum correctly into the settlement debit', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
        .mockResolvedValueOnce({ id: 'receiver-1', name: 'youssef' });
      tx.cashHandover.create.mockResolvedValue({ id: 'handover-11' });
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });
      mockPrisma.expenseCategory.findMany.mockResolvedValue([
        { id: 'cat-fuel', name: 'Fuel' },
        { id: 'cat-parking', name: 'Parking' },
      ]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(
        {
          date: '2026-08-29', receiverId: 'receiver-1',
          expectedAmt: '460.00', handedAmt: '460.00',
          expenses: [
            { categoryId: 'cat-fuel', amount: '20.00' },
            { categoryId: 'cat-parking', amount: '20.00' },
          ],
        },
        'clerk-logger',
      );

      expect(tx.userAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { balance: { decrement: 500 } } }),
      );
    });

    it('CASE 7 — the expense is debited exactly once per handover, not once per expense item beyond its own amount', async () => {
      const tx = makeTx();
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
        .mockResolvedValueOnce({ id: 'receiver-1', name: 'youssef' });
      tx.cashHandover.create.mockResolvedValue({ id: 'handover-12' });
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });
      mockPrisma.expenseCategory.findMany.mockResolvedValue([{ id: 'cat-fuel', name: 'Fuel' }]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.create(
        {
          date: '2026-08-29', receiverId: 'receiver-1',
          expectedAmt: '460.00', handedAmt: '460.00',
          expenses: [{ categoryId: 'cat-fuel', amount: '40.00' }],
        },
        'clerk-logger',
      );

      // Exactly ONE userAccount.upsert / accountEntry.create call for the whole
      // handover — the $40 is folded into the single settlement debit, never
      // applied a second time via a separate expense-specific ledger write.
      expect(tx.userAccount.upsert).toHaveBeenCalledTimes(1);
      expect(tx.accountEntry.create).toHaveBeenCalledTimes(1);
      expect(tx.userAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { balance: { decrement: 500 } } }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// PR 1 regression test — CashHandoversService.getAllBalances()/getReceiverBalance()
// now delegate to BalanceQueryService instead of querying Prisma inline.
// ---------------------------------------------------------------------------

describe('CashHandoversService — read-path delegation to BalanceQueryService', () => {
  let service: CashHandoversService;

  const mockPrisma = { user: { findUnique: fn() }, $transaction: fn() };
  const mockLedgerWriteService = { creditAccount: fn(), debitAccount: fn() };
  const mockBalanceQueryService = { getAllBalances: fn(), getReceiverBalance: fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashHandoversService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerWriteService, useValue: mockLedgerWriteService },
        { provide: BalanceQueryService, useValue: mockBalanceQueryService },
      ],
    }).compile();

    service = module.get<CashHandoversService>(CashHandoversService);
  });

  it('getAllBalances() returns exactly what BalanceQueryService.getAllBalances() returns', async () => {
    const expected = [{ userId: 'u1', name: 'Dev owner', role: 'owner', balance: '25.00', totalCollected: null, totalHandedOver: null }];
    mockBalanceQueryService.getAllBalances.mockResolvedValue(expected);

    const result = await service.getAllBalances();

    expect(mockBalanceQueryService.getAllBalances).toHaveBeenCalledTimes(1);
    expect(result).toBe(expected);
  });

  it('getReceiverBalance() returns exactly what BalanceQueryService.getReceiverBalance() returns, for the same id', async () => {
    const expected = { receiverId: 'u1', receiverName: 'Dev owner', balance: '25.00' };
    mockBalanceQueryService.getReceiverBalance.mockResolvedValue(expected);

    const result = await service.getReceiverBalance('u1');

    expect(mockBalanceQueryService.getReceiverBalance).toHaveBeenCalledWith('u1');
    expect(result).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Money Handover History redesign — findAll() previously had no search
// param at all, and sorted by createdAt while filtering by the business
// `date` column (a real, if usually harmless, divergence for a backdated/
// late-entered handover). This covers the fixed pagination/search/date-
// filter/ordering contract the redone frontend history table now relies on.
// ---------------------------------------------------------------------------

describe('CashHandoversService.findAll()', () => {
  let service: CashHandoversService;

  const mockPrisma = {
    $transaction: fn(),
    cashHandover: { findMany: fn(), count: fn() },
  };
  const mockLedgerWriteService = { creditAccount: fn(), debitAccount: fn() };
  const mockBalanceQueryService = { getAllBalances: fn(), getReceiverBalance: fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockResolvedValue([[], 0]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashHandoversService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerWriteService, useValue: mockLedgerWriteService },
        { provide: BalanceQueryService, useValue: mockBalanceQueryService },
      ],
    }).compile();

    service = module.get<CashHandoversService>(CashHandoversService);
  });

  it('returns the paginated shape the frontend history table relies on', async () => {
    mockPrisma.$transaction.mockResolvedValue([[{ id: 'h1' }], 37]);

    const result = await service.findAll(2, 10);

    expect(result).toEqual({ data: [{ id: 'h1' }], total: 37, page: 2, limit: 10 });
    const findManyCall = mockPrisma.cashHandover.findMany.mock.calls[0][0];
    expect(findManyCall).toMatchObject({ skip: 10, take: 10 });
  });

  it('orders by business date descending, with createdAt descending as a same-day tiebreaker', async () => {
    await service.findAll(1, 20);

    const findManyCall = mockPrisma.cashHandover.findMany.mock.calls[0][0];
    expect(findManyCall.orderBy).toEqual([{ date: 'desc' }, { createdAt: 'desc' }]);
  });

  it('filters by the business date column (not createdAt) for dateFrom/dateTo', async () => {
    await service.findAll(1, 20, '2026-08-01', '2026-08-31');

    const findManyCall = mockPrisma.cashHandover.findMany.mock.calls[0][0];
    expect(findManyCall.where.date).toEqual({ gte: new Date('2026-08-01'), lte: new Date('2026-08-31') });
  });

  it('search matches receiverName OR notes, case-insensitively — not a speculative field', async () => {
    await service.findAll(1, 20, undefined, undefined, 'walid');

    const findManyCall = mockPrisma.cashHandover.findMany.mock.calls[0][0];
    expect(findManyCall.where.OR).toEqual([
      { receiverName: { contains: 'walid', mode: 'insensitive' } },
      { notes: { contains: 'walid', mode: 'insensitive' } },
    ]);
  });

  it('omits the OR search clause entirely when no search term is given', async () => {
    await service.findAll(1, 20);

    const findManyCall = mockPrisma.cashHandover.findMany.mock.calls[0][0];
    expect(findManyCall.where.OR).toBeUndefined();
  });

  it('always includes receiver and loggedBy names, and itemized expenses', async () => {
    await service.findAll(1, 20);

    const findManyCall = mockPrisma.cashHandover.findMany.mock.calls[0][0];
    expect(findManyCall.include).toEqual({
      loggedBy: { select: { id: true, name: true } },
      receiver: { select: { id: true, name: true } },
      expenses: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Forensic audit (2026-08-31): "Expenses + Cash Handover expense selection
// redesign" — Employee → Category → Occurrence aggregation. Test matrix per
// the task spec (CASE 1-14, excluding CASE 8/9/10 which live in
// cash-handovers.service.spec.ts's ledger-settlement suite and
// expense-categories.service.spec.ts respectively).
// ---------------------------------------------------------------------------
describe('CashHandoversService — Expenses page aggregation (forensic audit, 2026-08-31)', () => {
  let service: CashHandoversService;

  const mockPrisma = {
    cashHandoverExpense: { findMany: fn(), create: fn(), update: fn(), delete: fn() },
    user: { findUnique: fn() },
    expenseCategory: { findUnique: fn() },
  };
  const mockLedgerWriteService = { creditAccount: fn(), debitAccount: fn() };
  const mockBalanceQueryService = { getAllBalances: fn(), getReceiverBalance: fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashHandoversService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerWriteService, useValue: mockLedgerWriteService },
        { provide: BalanceQueryService, useValue: mockBalanceQueryService },
      ],
    }).compile();
    service = module.get<CashHandoversService>(CashHandoversService);
  });

  // Builds one CashHandoverExpense row exactly as `expenseRows()` would
  // receive it from Prisma (nested cashHandover/category include).
  function makeRow(overrides: {
    id: string; amount: string; date: string;
    receiverId: string | null; receiverName: string;
    categoryId: string | null; categoryName?: string; description?: string;
    cashHandoverId?: string; expectedAmt?: string; handedAmt?: string;
  }) {
    return {
      id: overrides.id,
      cashHandoverId: overrides.cashHandoverId ?? `handover-${overrides.id}`,
      amount: { toString: () => overrides.amount },
      description: overrides.description ?? overrides.categoryName ?? 'Fuel',
      categoryId: overrides.categoryId,
      category: overrides.categoryId ? { id: overrides.categoryId, name: overrides.categoryName ?? 'Fuel' } : null,
      cashHandover: {
        id: overrides.cashHandoverId ?? `handover-${overrides.id}`,
        date: new Date(overrides.date),
        receiverId: overrides.receiverId,
        receiverName: overrides.receiverName,
        expectedAmt: { toString: () => overrides.expectedAmt ?? '90.00' },
        handedAmt: { toString: () => overrides.handedAmt ?? '90.00' },
        receiver: overrides.receiverId ? { id: overrides.receiverId, name: overrides.receiverName } : null,
      },
    };
  }

  describe('getEmployeeExpenses() — CASE 1/2/3/4/12', () => {
    it('CASE 1 — employee with no expenses: totalExpenses is 0.00, categories is empty, never crashes', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'youssef', name: 'Youssef' });
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([]);

      const result = await service.getEmployeeExpenses('youssef');

      expect(result).toEqual({ employeeId: 'youssef', employeeName: 'Youssef', totalExpenses: '0.00', categories: [] });
    });

    it('CASE 2 — employee with exactly one expense', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'youssef', name: 'Youssef' });
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '40.00', date: '2026-08-30', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-fuel', categoryName: 'Fuel' }),
      ]);

      const result = await service.getEmployeeExpenses('youssef');

      expect(result.totalExpenses).toBe('40.00');
      expect(result.categories).toEqual([{ categoryId: 'cat-fuel', categoryName: 'Fuel', total: '40.00' }]);
    });

    it('CASE 3 — employee with multiple expenses in the SAME category sums correctly', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'youssef', name: 'Youssef' });
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '40.00', date: '2026-08-30', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-fuel', categoryName: 'Fuel' }),
        makeRow({ id: 'e2', amount: '20.00', date: '2026-08-29', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-fuel', categoryName: 'Fuel' }),
      ]);

      const result = await service.getEmployeeExpenses('youssef');

      expect(result.totalExpenses).toBe('60.00');
      expect(result.categories).toEqual([{ categoryId: 'cat-fuel', categoryName: 'Fuel', total: '60.00' }]);
    });

    it('CASE 4 — employee with multiple categories: total sums across categories, each category reported separately', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'youssef', name: 'Youssef' });
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '140.00', date: '2026-08-30', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-fuel', categoryName: 'Fuel' }),
        makeRow({ id: 'e2', amount: '30.00', date: '2026-08-28', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-other', categoryName: 'Other' }),
      ]);

      const result = await service.getEmployeeExpenses('youssef');

      expect(result.totalExpenses).toBe('170.00');
      expect(result.categories.sort((a, b) => a.categoryName.localeCompare(b.categoryName))).toEqual([
        { categoryId: 'cat-fuel', categoryName: 'Fuel', total: '140.00' },
        { categoryId: 'cat-other', categoryName: 'Other', total: '30.00' },
      ]);
    });

    it('CASE 12 — employee filtering: another employee\'s expenses are never included', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'youssef', name: 'Youssef' });
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '40.00', date: '2026-08-30', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-fuel', categoryName: 'Fuel' }),
        makeRow({ id: 'e2', amount: '999.00', date: '2026-08-30', receiverId: 'abu-baker', receiverName: 'Abu Baker', categoryId: 'cat-fuel', categoryName: 'Fuel' }),
      ]);

      const result = await service.getEmployeeExpenses('youssef');

      expect(result.totalExpenses).toBe('40.00'); // Abu Baker's $999 never leaks in
    });

    it('throws NotFoundException for an unknown employeeId', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getEmployeeExpenses('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('CASE 14 — a legacy row with no categoryId still appears, grouped by its own description', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'youssef', name: 'Youssef' });
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '20.00', date: '2026-08-09', receiverId: 'youssef', receiverName: 'Youssef', categoryId: null, description: 'gaz' }),
      ]);

      const result = await service.getEmployeeExpenses('youssef');

      expect(result.totalExpenses).toBe('20.00');
      expect(result.categories).toEqual([{ categoryId: null, categoryName: 'gaz', total: '20.00' }]);
    });
  });

  describe('getExpensesSummary() — CASE 5/11', () => {
    it('CASE 5 — two employees using the SAME category remain separate, never merged', async () => {
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '100.00', date: '2026-08-30', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-fuel', categoryName: 'Fuel' }),
        makeRow({ id: 'e2', amount: '50.00', date: '2026-08-30', receiverId: 'abu-baker', receiverName: 'Abu Baker', categoryId: 'cat-fuel', categoryName: 'Fuel' }),
      ]);

      const result = await service.getExpensesSummary();

      expect(result).toEqual(
        expect.arrayContaining([
          { employeeId: 'youssef', employeeName: 'Youssef', totalExpenses: '100.00' },
          { employeeId: 'abu-baker', employeeName: 'Abu Baker', totalExpenses: '50.00' },
        ]),
      );
      expect(result).toHaveLength(2);
    });

    it('CASE 11 — date filtering is passed through to the underlying query', async () => {
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([]);

      await service.getExpensesSummary('2026-08-01', '2026-08-31');

      const call = mockPrisma.cashHandoverExpense.findMany.mock.calls[0][0];
      expect(call.where).toEqual({
        cashHandover: { date: { gte: new Date('2026-08-01'), lte: new Date('2026-08-31') } },
      });
    });

    it('CASE 11 — summary totals only reflect the selected date range, not all-time', async () => {
      // August-only rows returned by the (mocked) date-filtered query — the
      // service must never re-widen this by ignoring the filter.
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '170.00', date: '2026-08-30', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-fuel', categoryName: 'Fuel' }),
      ]);

      const result = await service.getExpensesSummary('2026-08-01', '2026-08-31');

      expect(result).toEqual([{ employeeId: 'youssef', employeeName: 'Youssef', totalExpenses: '170.00' }]);
    });

    it('no expenses in range → empty summary, never fabricated rows', async () => {
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([]);
      const result = await service.getExpensesSummary();
      expect(result).toEqual([]);
    });
  });

  describe('getEmployeeCategoryExpenses() — CASE 6/7', () => {
    it('CASE 6 — same employee, same category, multiple occurrences: total is the sum, every occurrence listed', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'youssef', name: 'Youssef' });
      mockPrisma.expenseCategory.findUnique.mockResolvedValue({ id: 'cat-fuel', name: 'Fuel' });
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '40.00', date: '2026-08-30', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-fuel', categoryName: 'Fuel', cashHandoverId: 'h1' }),
        makeRow({ id: 'e2', amount: '20.00', date: '2026-08-29', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-fuel', categoryName: 'Fuel', cashHandoverId: 'h2' }),
        makeRow({ id: 'e3', amount: '80.00', date: '2026-08-27', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-fuel', categoryName: 'Fuel', cashHandoverId: 'h3' }),
      ]);

      const result = await service.getEmployeeCategoryExpenses('youssef', 'cat-fuel');

      expect(result.total).toBe('140.00');
      expect(result.occurrences).toHaveLength(3);
      expect(result.occurrences.map((o) => o.amount).sort()).toEqual(['20.00', '40.00', '80.00']);
      expect(result.occurrences.every((o) => o.cashHandoverId)).toBe(true);
    });

    it('CASE 7 — a category detail never includes another category\'s occurrences from the same handover', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'youssef', name: 'Youssef' });
      mockPrisma.expenseCategory.findUnique.mockResolvedValue({ id: 'cat-fuel', name: 'Fuel' });
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '40.00', date: '2026-08-30', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-fuel', categoryName: 'Fuel', cashHandoverId: 'h1' }),
        makeRow({ id: 'e2', amount: '20.00', date: '2026-08-30', receiverId: 'youssef', receiverName: 'Youssef', categoryId: 'cat-food', categoryName: 'Food', cashHandoverId: 'h1' }),
      ]);

      const result = await service.getEmployeeCategoryExpenses('youssef', 'cat-fuel');

      expect(result.total).toBe('40.00'); // Food's $20 excluded
      expect(result.occurrences).toHaveLength(1);
    });

    it('throws NotFoundException for an unknown category', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'youssef', name: 'Youssef' });
      mockPrisma.expenseCategory.findUnique.mockResolvedValue(null);
      await expect(service.getEmployeeCategoryExpenses('youssef', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // getBusinessExpenses() — Business Expenses page (business-model audit,
  // 2026-09-04): a Cash Handover expense is a BUSINESS expense, never an
  // "employee expense" — the employee/receiver is only the cash holder.
  // =========================================================================

  describe('getBusinessExpenses()', () => {
    it('CASE 1/2 — a $10 benzin expense on a $100-collected, $90-handed handover: flat row carries the reconciliation context, never labeled as belonging to the employee', async () => {
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({
          id: 'e1', amount: '10.00', date: '2026-09-03',
          receiverId: 'gaz', receiverName: 'Gaz',
          categoryId: 'cat-benzin', categoryName: 'Benzin',
          cashHandoverId: 'h1', expectedAmt: '90.00', handedAmt: '90.00',
        }),
      ]);

      const [row] = await service.getBusinessExpenses();

      // The expense itself — amount and category, not an "employee expense" label.
      expect(row.amount).toBe('10.00');
      expect(row.categoryName).toBe('Benzin');
      // The employee is represented ONLY as the cash holder, never as an owner field.
      expect(row.cashHolderId).toBe('gaz');
      expect(row.cashHolderName).toBe('Gaz');
      expect(row).not.toHaveProperty('employeeId');
      expect(row).not.toHaveProperty('employeeName');
      // Reconciliation context: collected = expectedAmt + handoverExpensesTotal = 90 + 10 = 100.
      expect(row.handoverExpectedAmt).toBe('90.00');
      expect(row.handoverHandedAmt).toBe('90.00');
      expect(row.handoverExpensesTotal).toBe('10.00');
      expect(new Decimal(row.handoverExpectedAmt).plus(row.handoverExpensesTotal).toFixed(2)).toBe('100.00');
    });

    it('CASE 3 — expense date is the CASH HANDOVER date, not any other date', async () => {
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '10.00', date: '2026-09-03', receiverId: 'gaz', receiverName: 'Gaz', categoryId: 'cat-benzin', categoryName: 'Benzin' }),
      ]);
      const [row] = await service.getBusinessExpenses();
      expect(row.date.toISOString().slice(0, 10)).toBe('2026-09-03');
    });

    it('handoverExpensesTotal sums ALL expenses on the same handover, not just this row', async () => {
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '10.00', date: '2026-09-03', receiverId: 'gaz', receiverName: 'Gaz', categoryId: 'cat-benzin', categoryName: 'Benzin', cashHandoverId: 'h1' }),
        makeRow({ id: 'e2', amount: '5.00', date: '2026-09-03', receiverId: 'gaz', receiverName: 'Gaz', categoryId: 'cat-food', categoryName: 'Food', cashHandoverId: 'h1' }),
      ]);
      const rows = await service.getBusinessExpenses();
      expect(rows.find((r) => r.id === 'e1')!.handoverExpensesTotal).toBe('15.00');
      expect(rows.find((r) => r.id === 'e2')!.handoverExpensesTotal).toBe('15.00');
      // Each row still keeps its OWN amount — never merged into one line.
      expect(rows).toHaveLength(2);
    });

    it('handoverExpensesTotal never leaks another handover\'s expenses into this one\'s total', async () => {
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '10.00', date: '2026-09-03', receiverId: 'gaz', receiverName: 'Gaz', categoryId: 'cat-benzin', categoryName: 'Benzin', cashHandoverId: 'h1' }),
        makeRow({ id: 'e2', amount: '999.00', date: '2026-09-02', receiverId: 'abu-baker', receiverName: 'Abu Baker', categoryId: 'cat-benzin', categoryName: 'Benzin', cashHandoverId: 'h2' }),
      ]);
      const rows = await service.getBusinessExpenses();
      expect(rows.find((r) => r.id === 'e1')!.handoverExpensesTotal).toBe('10.00');
    });

    it('a legacy row with no categoryId still appears, using its own description as the category label', async () => {
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([
        makeRow({ id: 'e1', amount: '20.00', date: '2026-08-09', receiverId: 'youssef', receiverName: 'Youssef', categoryId: null, description: 'gaz' }),
      ]);
      const [row] = await service.getBusinessExpenses();
      expect(row.categoryId).toBeNull();
      expect(row.categoryName).toBe('gaz');
    });

    it('no cash-handover expenses in range → empty list, never fabricated rows', async () => {
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([]);
      expect(await service.getBusinessExpenses('2026-08-01', '2026-08-31')).toEqual([]);
    });

    it('date filtering is passed through to the underlying query (same helper as the other three methods)', async () => {
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([]);
      await service.getBusinessExpenses('2026-08-01', '2026-08-31');
      const args = mockPrisma.cashHandoverExpense.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ cashHandover: { date: { gte: new Date('2026-08-01'), lte: new Date('2026-08-31') } } });
    });

    it('read-only: never calls a create/update/delete on any model', async () => {
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([]);
      await service.getBusinessExpenses();
      expect(mockPrisma.cashHandoverExpense.create).not.toHaveBeenCalled();
      expect(mockPrisma.cashHandoverExpense.update).not.toHaveBeenCalled();
      expect(mockPrisma.cashHandoverExpense.delete).not.toHaveBeenCalled();
      expect(mockLedgerWriteService.debitAccount).not.toHaveBeenCalled();
    });
  });

  describe('CASE 13 — read-only: viewing summary/detail performs zero writes', () => {
    it('none of the three aggregation methods ever call a create/update/delete on any model', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'youssef', name: 'Youssef' });
      mockPrisma.expenseCategory.findUnique.mockResolvedValue({ id: 'cat-fuel', name: 'Fuel' });
      mockPrisma.cashHandoverExpense.findMany.mockResolvedValue([]);

      await service.getExpensesSummary('2026-08-01', '2026-08-31');
      await service.getEmployeeExpenses('youssef');
      await service.getEmployeeCategoryExpenses('youssef', 'cat-fuel');

      expect(mockPrisma.cashHandoverExpense.create).not.toHaveBeenCalled();
      expect(mockPrisma.cashHandoverExpense.update).not.toHaveBeenCalled();
      expect(mockPrisma.cashHandoverExpense.delete).not.toHaveBeenCalled();
      expect(mockLedgerWriteService.creditAccount).not.toHaveBeenCalled();
      expect(mockLedgerWriteService.debitAccount).not.toHaveBeenCalled();
    });
  });
});
