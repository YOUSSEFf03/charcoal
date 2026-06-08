import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

/** Upsert a UserAccount and append one AccountEntry inside an existing transaction. */
async function creditAccount(
  tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  userId: string,
  amount: Decimal,
  type: 'payment_received' | 'sale_collected',
  referenceId: string,
  description: string,
  date: Date,
) {
  const account = await tx.userAccount.upsert({
    where:  { userId },
    update: { balance: { increment: amount.toNumber() } },
    create: { userId, balance: amount.toNumber() },
  });
  await tx.accountEntry.create({
    data: { accountId: account.id, amount: amount.toFixed(2), type, referenceId, description, date },
  });
}

async function debitAccount(
  tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  userId: string,
  amount: Decimal,
  referenceId: string,
  date: Date,
) {
  const account = await tx.userAccount.upsert({
    where:  { userId },
    update: { balance: { decrement: amount.toNumber() } },
    create: { userId, balance: amount.negated().toNumber() },
  });
  await tx.accountEntry.create({
    data: { accountId: account.id, amount: amount.negated().toFixed(2), type: 'handover', referenceId, description: 'Cash handover', date },
  });
}

@Injectable()
export class CashHandoversService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page = 1, limit = 20, dateFrom?: string, dateTo?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (dateFrom || dateTo) {
      where.date = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.cashHandover.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { loggedBy: { select: { id: true, name: true } }, receiver: { select: { id: true, name: true } } },
      }),
      this.prisma.cashHandover.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * All users with balance > 0 — reads directly from user_accounts (instant, no aggregation).
   */
  async getAllBalances() {
    const accounts = await this.prisma.userAccount.findMany({
      where: { balance: { gt: 0 } },
      orderBy: { balance: 'desc' },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    return accounts.map(a => ({
      userId:          a.user.id,
      name:            a.user.name,
      role:            a.user.role as string,
      balance:         a.balance.toFixed(2),
      totalCollected:  null, // not stored separately; available via entries if needed
      totalHandedOver: null,
    }));
  }

  /**
   * Full balance detail for one user — reads from account_entries ledger.
   * Falls back to name-match for legacy records that have no receiverId.
   */
  async getReceiverBalance(receiverId: string) {
    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
      include: { account: true },
    });
    if (!receiver) throw new NotFoundException({ error: 'Receiver not found', code: 'NOT_FOUND' });

    const account = receiver.account;
    const balance = account ? new Decimal(account.balance.toString()) : new Decimal(0);

    // Full ledger entries for this user
    const entries = account
      ? await this.prisma.accountEntry.findMany({
          where: { accountId: account.id },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    // For the detail table, also pull the original payment / exit records for richer display
    const nameFilter = receiver.name;
    const [payments, exits, handovers] = await Promise.all([
      this.prisma.payment.findMany({
        where: { OR: [{ receiverId }, { receiverId: null, receiverName: nameFilter }] },
        orderBy: { createdAt: 'desc' },
        include: { client: { select: { id: true, name: true } } },
      }),
      this.prisma.stockExit.findMany({
        where: { amount: { not: null }, OR: [{ collectedById: receiverId }, { collectedById: null, collectedBy: nameFilter }] },
        orderBy: { createdAt: 'desc' },
        include: { bagType: { select: { name: true } }, lot: { select: { charcoalType: true, grade: true } } },
      }),
      this.prisma.cashHandover.findMany({
        where: { OR: [{ receiverId }, { receiverId: null, receiverName: nameFilter }] },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalCollected = entries
      .filter(e => new Decimal(e.amount.toString()).gt(0))
      .reduce((s, e) => s.plus(e.amount.toString()), new Decimal(0));
    const totalHandedOver = entries.filter(e => parseFloat(e.amount.toString()) < 0)
      .reduce((s, e) => s.plus(new Decimal(e.amount.toString()).abs()), new Decimal(0));

    return {
      receiverId,
      receiverName: receiver.name,
      balance:         balance.toFixed(2),
      total:           balance.toFixed(2),
      totalCollected:  totalCollected.toFixed(2),
      totalHandedOver: totalHandedOver.toFixed(2),
      lastHandover:    handovers[0]?.createdAt ?? null,
      payments: payments.map(p => ({
        id: p.id, date: p.date, amount: p.amount.toString(),
        method: p.method, clientName: (p.client as any)?.name ?? p.clientId, notes: p.notes,
      })),
      exits: exits.map(e => ({
        id: e.id, date: e.date, amount: e.amount!.toString(), recipient: e.recipient,
        description: e.lotId
          ? `By kg — ${e.lot?.charcoalType ?? '?'} ${e.lot?.grade ?? '?'}`
          : e.bagType?.name ?? 'Packed bags',
      })),
      handovers: handovers.map(h => ({
        id: h.id, date: h.date, handedAmt: h.handedAmt.toString(),
        expectedAmt: h.expectedAmt.toString(), difference: h.difference.toString(), notes: h.notes,
      })),
    };
  }

  async create(dto: {
    date: string;
    receiverId: string;
    receiverName?: string;
    expectedAmt: string;
    handedAmt: string;
    notes?: string | null;
  }, userId: string) {
    const [logger, receiver] = await Promise.all([
      this.prisma.user.findUnique({ where: { clerkId: userId } }),
      this.prisma.user.findUnique({ where: { id: dto.receiverId } }),
    ]);
    if (!logger)   throw new NotFoundException({ error: 'User not found',     code: 'NOT_FOUND' });
    if (!receiver) throw new NotFoundException({ error: 'Receiver not found', code: 'NOT_FOUND' });

    const expected  = parseFloat(dto.expectedAmt);
    const handed    = parseFloat(dto.handedAmt);
    const diff      = handed - expected;
    const handedDec = new Decimal(dto.handedAmt);

    return this.prisma.$transaction(async (tx) => {
      const handover = await tx.cashHandover.create({
        data: {
          date:         new Date(dto.date),
          receiverName: receiver.name,
          receiverId:   receiver.id,
          expectedAmt:  expected.toFixed(2),
          handedAmt:    handed.toFixed(2),
          difference:   diff.toFixed(2),
          notes:        dto.notes ?? null,
          loggedById:   logger.id,
        },
        include: {
          loggedBy: { select: { id: true, name: true } },
          receiver: { select: { id: true, name: true } },
        },
      });

      // Debit the receiver's account
      await debitAccount(tx, receiver.id, handedDec, handover.id, new Date(dto.date));

      return handover;
    });
  }
}

export { creditAccount, debitAccount };
