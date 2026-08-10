import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

/**
 * PR 1 (Cash Management System — Phase 0): balance-read logic moved verbatim out of
 * CashHandoversService. Behavior is unchanged; only the location moved.
 */
@Injectable()
export class BalanceQueryService {
  constructor(private readonly prisma: PrismaService) {}

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
}
