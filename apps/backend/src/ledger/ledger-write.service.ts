import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

/**
 * The single write path for every cash-ledger movement (Cash Management System,
 * Phase 0 — PR 1–5). PaymentsService, StockExitsService, WalkInSalesService, and
 * CashHandoversService all delegate here instead of writing UserAccount/AccountEntry
 * directly.
 */
@Injectable()
export class LedgerWriteService {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Upsert a UserAccount and append one AccountEntry inside an existing transaction.
   *
   * Phase 1 (PR 6): validates the holder exists and is eligible before writing
   * anything — closes the gap where a caller could pass an unchecked or
   * nonexistent user id straight through to a silent no-op or a phantom credit.
   */
  async creditAccount(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    userId: string,
    amount: Decimal,
    type: 'payment_received' | 'sale_collected',
    referenceId: string,
    description: string,
    date: Date,
  ) {
    await this.usersService.validateCashCapable(userId);

    const account = await tx.userAccount.upsert({
      where:  { userId },
      update: { balance: { increment: amount.toNumber() } },
      create: { userId, balance: amount.toNumber() },
    });
    await tx.accountEntry.create({
      data: { accountId: account.id, amount: amount.toFixed(2), type, referenceId, description, date },
    });
  }

  async debitAccount(
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
}
