import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.create(
      { ...baseDto, expectedAmt: '5.00', expenses: [{ description: 'Gas', amount: '20' }] },
      'clerk-logger',
    );

    const call = tx.cashHandover.create.mock.calls[0][0];
    expect(call.data.expenses).toEqual({ create: [{ description: 'Gas', amount: '20.00' }] });
  });

  it('creates a handover with MULTIPLE itemized expenses — all persisted, amounts normalized to 2dp', async () => {
    const tx = makeTx();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'logger-1', clerkId: 'clerk-logger' })
      .mockResolvedValueOnce({ id: 'receiver-1', name: 'Dev owner' });
    tx.cashHandover.create.mockResolvedValue({ id: 'handover-6' });
    tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.create(
      {
        ...baseDto,
        expectedAmt: '0.00',
        expenses: [
          { description: 'Gas', amount: '20' },
          { description: 'Parking', amount: '5' },
        ],
      },
      'clerk-logger',
    );

    const call = tx.cashHandover.create.mock.calls[0][0];
    expect(call.data.expenses).toEqual({
      create: [
        { description: 'Gas', amount: '20.00' },
        { description: 'Parking', amount: '5.00' },
      ],
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
