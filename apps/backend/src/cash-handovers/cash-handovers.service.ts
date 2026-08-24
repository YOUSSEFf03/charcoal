import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerWriteService } from '../ledger/ledger-write.service';
import { BalanceQueryService } from '../ledger/balance-query.service';
import { CreateCashHandoverDto } from './dto/create-cash-handover.dto';

@Injectable()
export class CashHandoversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerWriteService: LedgerWriteService,
    private readonly balanceQueryService: BalanceQueryService,
  ) {}

  async findAll(page = 1, limit = 20, dateFrom?: string, dateTo?: string, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (dateFrom || dateTo) {
      // date is a @db.Date column (business date, not a timestamp) — plain
      // gte/lte is the same convention already used for Payment.date
      // elsewhere in this codebase.
      where.date = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }
    if (search) {
      // receiverName is the historical snapshot (present on every row, even
      // if receiverId is null for legacy data) — searching it, not a live
      // join, matches what a user actually saw at the time. notes is the
      // only other free-text field on this model. Mirrors the OR/contains/
      // insensitive pattern InvoicesService.findAll() already uses.
      where.OR = [
        { receiverName: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.cashHandover.findMany({
        where, skip, take: limit,
        // Newest handover first by its actual business date — createdAt is
        // only a tiebreaker for same-day handovers, so ordering stays
        // deterministic without letting a backdated/late-entered handover's
        // insert time override the date the user filters and reads by.
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: {
          loggedBy: { select: { id: true, name: true } },
          receiver: { select: { id: true, name: true } },
          expenses: true,
        },
      }),
      this.prisma.cashHandover.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * All users with balance > 0. Delegates to BalanceQueryService (moved there in PR 1
   * of the Cash Management System roadmap — logic unchanged, location only).
   */
  async getAllBalances() {
    return this.balanceQueryService.getAllBalances();
  }

  /**
   * Full balance detail for one user. Delegates to BalanceQueryService (moved there in
   * PR 1 of the Cash Management System roadmap — logic unchanged, location only).
   */
  async getReceiverBalance(receiverId: string) {
    return this.balanceQueryService.getReceiverBalance(receiverId);
  }

  async create(dto: CreateCashHandoverDto, userId: string) {
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
    const expenseItems = dto.expenses ?? [];

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
          ...(expenseItems.length > 0 ? {
            expenses: {
              create: expenseItems.map(e => ({
                description: e.description,
                amount: new Decimal(e.amount).toFixed(2),
              })),
            },
          } : {}),
        },
        include: {
          loggedBy: { select: { id: true, name: true } },
          receiver: { select: { id: true, name: true } },
          expenses: true,
        },
      });

      // Debit the receiver's account (delegates to LedgerWriteService, moved in PR 1)
      await this.ledgerWriteService.debitAccount(tx, receiver.id, handedDec, handover.id, new Date(dto.date));

      return handover;
    });
  }
}
