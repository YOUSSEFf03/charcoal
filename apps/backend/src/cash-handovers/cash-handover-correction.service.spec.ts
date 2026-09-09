import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import Decimal from 'decimal.js';
import { CashHandoverCorrectionService } from './cash-handover-correction.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerWriteService } from '../ledger/ledger-write.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

// ---------------------------------------------------------------------------
// Forensic audit (2026-08-30) — historical Cash Handover expense-settlement
// correction. Pure replay logic first (no DB), then the service's
// idempotency/abort behavior under mocked Prisma.
// ---------------------------------------------------------------------------

describe('CashHandoverCorrectionService.replay() — pure ledger replay', () => {
  it('CASE: a single under-debited handover with nothing after it — fully outstanding (the real youssef case)', () => {
    const entries = [
      { amount: '500.00', type: 'payment_received', referenceId: 'pay-1' },
      { amount: '-460.00', type: 'handover', referenceId: 'h1' },
    ];
    const result = CashHandoverCorrectionService.replay(entries, new Map([['h1', new Decimal('40.00')]]));
    expect(result.get('h1')).toEqual({ alreadySettled: new Decimal(0), remaining: new Decimal('40.00') });
  });

  it('CASE: an under-debited handover whose leftover balance is later fully drained by an unrelated handover — already settled, no correction', () => {
    const entries = [
      { amount: '3300.00', type: 'payment_received', referenceId: 'pay-1' },
      { amount: '-3200.00', type: 'handover', referenceId: 'h1' }, // leaves $100 (the $100 expense never debited)
      { amount: '-100.00', type: 'handover', referenceId: 'h2' },  // drains that exact $100 back to zero — h2 has NO expense of its own
    ];
    const expenseByHandoverId = new Map([['h1', new Decimal('100.00')]]); // h2 not in the map — it had no expense
    const result = CashHandoverCorrectionService.replay(entries, expenseByHandoverId);
    expect(result.get('h1')).toEqual({ alreadySettled: new Decimal('100.00'), remaining: new Decimal(0) });
  });

  it('CASE: same-day organic offset — expense debited by a later handover the same day still counts as settled', () => {
    const entries = [
      { amount: '367.00', type: 'payment_received', referenceId: 'pay-1' },
      { amount: '-367.00', type: 'handover', referenceId: 'h1' }, // leaves $20
      { amount: '-20.00', type: 'handover', referenceId: 'h2' },  // same-day drain to zero
      { amount: '500.00', type: 'payment_received', referenceId: 'pay-2' },
      { amount: '-460.00', type: 'handover', referenceId: 'h3' }, // leaves $40, nothing after
    ];
    const expenseByHandoverId = new Map([
      ['h1', new Decimal('20.00')],
      ['h3', new Decimal('40.00')],
    ]);
    const result = CashHandoverCorrectionService.replay(entries, expenseByHandoverId);
    expect(result.get('h1')).toEqual({ alreadySettled: new Decimal('20.00'), remaining: new Decimal(0) });
    expect(result.get('h3')).toEqual({ alreadySettled: new Decimal(0), remaining: new Decimal('40.00') });
  });

  it('CASE: a handover whose handedAmt already equals the full custody (no real shortfall) — balance hits zero immediately, treated as settled', () => {
    const entries = [
      { amount: '3982.03', type: 'payment_received', referenceId: 'pay-1' },
      { amount: '-3982.03', type: 'handover', referenceId: 'h1' }, // handed = full collected, not expected-reduced — balance hits exactly 0
    ];
    const result = CashHandoverCorrectionService.replay(entries, new Map([['h1', new Decimal('20.00')]]));
    expect(result.get('h1')).toEqual({ alreadySettled: new Decimal('20.00'), remaining: new Decimal(0) });
  });

  it('a handover with no matching ledger entry at all is simply absent from the result (nothing to correct against)', () => {
    const entries = [{ amount: '10.00', type: 'payment_received', referenceId: 'pay-1' }];
    const result = CashHandoverCorrectionService.replay(entries, new Map([['h-missing', new Decimal('5.00')]]));
    expect(result.has('h-missing')).toBe(false);
  });
});

describe('CashHandoverCorrectionService.apply() — idempotency and state verification (mocked Prisma)', () => {
  let service: CashHandoverCorrectionService;
  const mockPrisma = { $transaction: fn() };
  const mockLedgerWriteService = { debitAccount: fn() };

  function makeTx(overrides: Record<string, unknown> = {}) {
    return {
      $executeRaw: fn(),
      accountEntry: { findFirst: fn(), findMany: fn() },
      userAccount: { findUnique: fn() },
      cashHandover: { findUnique: fn() },
      ...overrides,
    };
  }

  const candidate = {
    handoverId: 'h1', receiverId: 'receiver-1', receiverName: 'youssef',
    date: new Date('2026-08-30'), expenseTotal: '40.00', alreadySettled: '0.00', remainingCorrection: '40.00',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashHandoverCorrectionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerWriteService, useValue: mockLedgerWriteService },
      ],
    }).compile();
    service = module.get(CashHandoverCorrectionService);
  });

  it('applies the correction exactly once — creates one debitAccount() call for exactly $40', async () => {
    const tx = makeTx();
    tx.accountEntry.findFirst.mockResolvedValue(null); // not previously applied
    tx.userAccount.findUnique.mockResolvedValue({ id: 'account-1' });
    tx.cashHandover.findUnique.mockResolvedValue({
      id: 'h1', date: new Date('2026-08-30'),
      expenses: [{ amount: '40.00' }],
    });
    tx.accountEntry.findMany.mockResolvedValue([
      { amount: '500.00', type: 'payment_received', referenceId: 'pay-1' },
      { amount: '-460.00', type: 'handover', referenceId: 'h1' },
    ]);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const results = await service.apply([candidate]);

    expect(results).toEqual([{ handoverId: 'h1', receiverId: 'receiver-1', amount: '40.00', status: 'applied' }]);
    expect(mockLedgerWriteService.debitAccount).toHaveBeenCalledTimes(1);
    const call = (mockLedgerWriteService.debitAccount as any).mock.calls[0];
    expect(call[0]).toBe(tx);
    expect(call[1]).toBe('receiver-1');
    expect(new Decimal(call[2]).toFixed(2)).toBe('40.00');
    expect(call[3]).toBe('cash-handover-correction:h1');
    expect(call[4]).toEqual(new Date('2026-08-30'));
    expect(call[5]).toEqual(expect.stringContaining('HISTORICAL CORRECTION'));
  });

  it('running apply() twice does NOT create a second debit — the second run sees the existing correction entry and no-ops', async () => {
    const tx1 = makeTx();
    tx1.accountEntry.findFirst.mockResolvedValue(null);
    tx1.userAccount.findUnique.mockResolvedValue({ id: 'account-1' });
    tx1.cashHandover.findUnique.mockResolvedValue({ id: 'h1', date: new Date('2026-08-30'), expenses: [{ amount: '40.00' }] });
    tx1.accountEntry.findMany.mockResolvedValue([
      { amount: '500.00', type: 'payment_received', referenceId: 'pay-1' },
      { amount: '-460.00', type: 'handover', referenceId: 'h1' },
    ]);

    const tx2 = makeTx();
    // Second run: the correction entry now exists (simulating the first run's write).
    tx2.accountEntry.findFirst.mockResolvedValue({ id: 'correction-entry-1', referenceId: 'cash-handover-correction:h1' });

    mockPrisma.$transaction
      .mockImplementationOnce(async (cb: any) => cb(tx1))
      .mockImplementationOnce(async (cb: any) => cb(tx2));

    const first = await service.apply([candidate]);
    const second = await service.apply([candidate]);

    expect(first[0].status).toBe('applied');
    expect(second[0].status).toBe('already_applied');
    // Only ONE debitAccount() call across both runs — the second never reaches it.
    expect(mockLedgerWriteService.debitAccount).toHaveBeenCalledTimes(1);
  });

  it('aborts without writing when the recomputed remaining no longer matches the dry-run assumption (state changed since dry run)', async () => {
    const tx = makeTx();
    tx.accountEntry.findFirst.mockResolvedValue(null);
    tx.userAccount.findUnique.mockResolvedValue({ id: 'account-1' });
    tx.cashHandover.findUnique.mockResolvedValue({ id: 'h1', date: new Date('2026-08-30'), expenses: [{ amount: '40.00' }] });
    // Simulates a NEW handover having been logged for this receiver since the
    // dry run — the fresh replay would now show this under-debit as already
    // settled (some other transaction cleared it), so applying the stale
    // $40 correction here would be wrong.
    tx.accountEntry.findMany.mockResolvedValue([
      { amount: '500.00', type: 'payment_received', referenceId: 'pay-1' },
      { amount: '-460.00', type: 'handover', referenceId: 'h1' },
      { amount: '-40.00', type: 'handover', referenceId: 'h-later' }, // organically drains it to 0
    ]);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const results = await service.apply([candidate]);

    expect(results[0].status).toBe('aborted_state_mismatch');
    expect(mockLedgerWriteService.debitAccount).not.toHaveBeenCalled();
  });

  it('aborts without writing when the receiver has no UserAccount at all', async () => {
    const tx = makeTx();
    tx.accountEntry.findFirst.mockResolvedValue(null);
    tx.userAccount.findUnique.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const results = await service.apply([candidate]);

    expect(results[0].status).toBe('aborted_state_mismatch');
    expect(mockLedgerWriteService.debitAccount).not.toHaveBeenCalled();
  });

  it('acquires a Postgres advisory lock scoped to this exact handover before checking/writing anything', async () => {
    const tx = makeTx();
    tx.accountEntry.findFirst.mockResolvedValue(null);
    tx.userAccount.findUnique.mockResolvedValue({ id: 'account-1' });
    tx.cashHandover.findUnique.mockResolvedValue({ id: 'h1', date: new Date('2026-08-30'), expenses: [{ amount: '40.00' }] });
    tx.accountEntry.findMany.mockResolvedValue([
      { amount: '500.00', type: 'payment_received', referenceId: 'pay-1' },
      { amount: '-460.00', type: 'handover', referenceId: 'h1' },
    ]);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.apply([candidate]);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('skips a candidate whose remainingCorrection is already $0.00 — never even opens a transaction for it', async () => {
    const results = await service.apply([{ ...candidate, remainingCorrection: '0.00' }]);
    expect(results).toEqual([]);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('CashHandoverCorrectionService.dryRun() — read-only, zero writes', () => {
  it('never touches userAccount.upsert / accountEntry.create — computeCandidates() only reads', async () => {
    const mockPrisma = {
      cashHandover: { findMany: fn() },
      userAccount: { findUnique: fn(), upsert: fn() },
      accountEntry: { findMany: fn(), create: fn() },
    };
    mockPrisma.cashHandover.findMany.mockResolvedValue([
      {
        id: 'h1', receiverId: 'receiver-1', date: new Date('2026-08-30'),
        receiver: { id: 'receiver-1', name: 'youssef' }, receiverName: 'youssef',
        expenses: [{ amount: '40.00' }],
      },
    ]);
    mockPrisma.userAccount.findUnique.mockResolvedValue({ id: 'account-1' });
    mockPrisma.accountEntry.findMany.mockResolvedValue([
      { amount: '500.00', type: 'payment_received', referenceId: 'pay-1' },
      { amount: '-460.00', type: 'handover', referenceId: 'h1' },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashHandoverCorrectionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerWriteService, useValue: { debitAccount: fn() } },
      ],
    }).compile();
    const service = module.get(CashHandoverCorrectionService);

    const { candidates, actionable } = await service.dryRun();

    expect(candidates).toEqual([{
      handoverId: 'h1', receiverId: 'receiver-1', receiverName: 'youssef',
      date: new Date('2026-08-30'), expenseTotal: '40.00', alreadySettled: '0.00', remainingCorrection: '40.00',
    }]);
    expect(actionable).toHaveLength(1);
    expect(mockPrisma.userAccount.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.accountEntry.create).not.toHaveBeenCalled();
  });

  it('a receiver whose organic-offset already cleared everything (abu-baker-style) produces zero actionable candidates', async () => {
    const mockPrisma = {
      cashHandover: { findMany: fn() },
      userAccount: { findUnique: fn() },
      accountEntry: { findMany: fn() },
    };
    mockPrisma.cashHandover.findMany.mockResolvedValue([
      {
        id: 'h1', receiverId: 'receiver-2', date: new Date('2026-08-20'),
        receiver: { id: 'receiver-2', name: 'abu baker' }, receiverName: 'abu baker',
        expenses: [{ amount: '20.00' }],
      },
    ]);
    mockPrisma.userAccount.findUnique.mockResolvedValue({ id: 'account-2' });
    mockPrisma.accountEntry.findMany.mockResolvedValue([
      { amount: '40.00', type: 'payment_received', referenceId: 'pay-1' },
      { amount: '-20.00', type: 'handover', referenceId: 'h1' },
      { amount: '-20.00', type: 'handover', referenceId: 'h2' }, // same-day organic offset
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashHandoverCorrectionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerWriteService, useValue: { debitAccount: fn() } },
      ],
    }).compile();
    const service = module.get(CashHandoverCorrectionService);

    const { candidates, actionable } = await service.dryRun();

    expect(candidates[0].remainingCorrection).toBe('0.00');
    expect(candidates[0].alreadySettled).toBe('20.00');
    expect(actionable).toHaveLength(0);
  });
});
