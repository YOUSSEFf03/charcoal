import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { BalanceQueryService } from './balance-query.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

const RECEIVER_ID = 'user-1';
const ACCOUNT_ID = 'acct-1';

function payment(id: string, createdAt: Date, amount = '10.00') {
  return { id, createdAt, date: createdAt, amount, method: 'cash', clientId: 'c1', client: { id: 'c1', name: 'Client 1' }, notes: null };
}

function exit(id: string, createdAt: Date, amount = '5.00') {
  return {
    id, createdAt, date: createdAt, amount, recipient: 'Someone', lotId: null,
    bagType: { name: '10kg Bag' }, lot: null,
  };
}

function handover(id: string, createdAt: Date) {
  return { id, createdAt, date: createdAt, handedAmt: '0.00', expectedAmt: '0.00', difference: '0.00', notes: null };
}

describe('BalanceQueryService.getReceiverBalance() — uncollected-only detail list', () => {
  let service: BalanceQueryService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      user: { findUnique: fn() },
      accountEntry: { findMany: fn() },
      payment: { findMany: fn() },
      stockExit: { findMany: fn() },
      cashHandover: { findMany: fn() },
    };
    service = new BalanceQueryService(prisma as unknown as PrismaService);

    prisma.user.findUnique.mockResolvedValue({
      id: RECEIVER_ID,
      name: 'Ahmad',
      account: { id: ACCOUNT_ID, balance: { toString: () => '15.00' } },
    });
    prisma.accountEntry.findMany.mockResolvedValue([]);
  });

  it('throws NotFoundException when the receiver does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getReceiverBalance('missing')).rejects.toThrow(NotFoundException);
  });

  it('with no handover ever recorded, returns every payment/exit (all still uncollected)', async () => {
    prisma.cashHandover.findMany.mockResolvedValue([]);
    prisma.payment.findMany.mockResolvedValue([
      payment('p1', new Date('2026-01-01')),
      payment('p2', new Date('2026-06-01')),
    ]);
    prisma.stockExit.findMany.mockResolvedValue([exit('e1', new Date('2026-01-01'))]);

    const result = await service.getReceiverBalance(RECEIVER_ID);

    expect(result.payments.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(result.exits.map((e) => e.id)).toEqual(['e1']);
  });

  it('excludes payments/exits at or before the most recent handover, keeps only those strictly after', async () => {
    const lastHandoverAt = new Date('2026-06-15T00:00:00.000Z');
    prisma.cashHandover.findMany.mockResolvedValue([
      handover('h2', lastHandoverAt), // most recent (orderBy desc — first element)
      handover('h1', new Date('2026-01-01')),
    ]);
    prisma.payment.findMany.mockResolvedValue([
      payment('p-new', new Date('2026-07-01')), // after — uncollected
      payment('p-same-instant', lastHandoverAt), // exactly at — already reconciled, excluded
      payment('p-old', new Date('2026-05-01')), // before — already reconciled, excluded
    ]);
    prisma.stockExit.findMany.mockResolvedValue([
      exit('e-new', new Date('2026-07-02')),
      exit('e-old', new Date('2026-02-01')),
    ]);

    const result = await service.getReceiverBalance(RECEIVER_ID);

    expect(result.payments.map((p) => p.id)).toEqual(['p-new']);
    expect(result.exits.map((e) => e.id)).toEqual(['e-new']);
    expect(result.lastHandover).toEqual(lastHandoverAt);
  });

  it('the returned balance is still the full ledger balance, unaffected by the display-list filter', async () => {
    prisma.cashHandover.findMany.mockResolvedValue([handover('h1', new Date('2026-06-15'))]);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.stockExit.findMany.mockResolvedValue([]);

    const result = await service.getReceiverBalance(RECEIVER_ID);

    expect(result.balance).toBe('15.00');
    expect(result.total).toBe('15.00');
  });
});
