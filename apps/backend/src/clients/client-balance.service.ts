import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute a client's outstanding balance.
   *
   * CONSTRAINT 15: balance is ALWAYS computed on-the-fly from invoices and
   * payments — never read from a stored column.
   *
   * balance = Σ invoice.total  −  Σ payment.amount
   *
   * @param clientId - Client UUID
   * @param tx - Optional Prisma transaction client
   * @returns Decimal where positive = client owes money, negative = credit
   * @constraint 15 balance is always computed on-the-fly — never read from a stored column
   */
  async computeBalance(
    clientId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Decimal> {
    const db = tx ?? this.prisma;

    const [invoices, payments, exits] = await Promise.all([
      (db as any).invoice.findMany({
        where: { clientId },
        select: { total: true },
      }),
      (db as any).payment.findMany({
        where: { clientId },
        select: { amount: true },
      }),
      // Warehouse walk-in sales with a stored amount contribute to the balance
      (db as any).stockExit.findMany({
        where: { clientId, amount: { not: null } },
        select: { amount: true },
      }),
    ]);

    const invoiceSum = invoices.reduce(
      (sum: Decimal, inv: any) => sum.plus(new Decimal(inv.total.toString())),
      new Decimal(0),
    );

    const exitSum = exits.reduce(
      (sum: Decimal, e: any) => sum.plus(new Decimal(e.amount.toString())),
      new Decimal(0),
    );

    const paymentSum = payments.reduce(
      (sum: Decimal, pmt: any) =>
        sum.plus(new Decimal(pmt.amount.toString())),
      new Decimal(0),
    );

    return invoiceSum.plus(exitSum).minus(paymentSum);
  }
}
