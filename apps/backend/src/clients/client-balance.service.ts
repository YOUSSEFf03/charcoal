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
   * CONSTRAINT 15: balance is ALWAYS computed on-the-fly from accounting
   * documents — never read from a stored column.
   *
   * balance = Σ invoice.total (status ∉ {draft, cancelled})
   *         − Σ payment.amount
   *
   * Stock exits are operational records, not accounting documents, and are
   * intentionally excluded. Cancelled and draft invoices are excluded because
   * they represent void or uncommitted charges.
   *
   * @param clientId - Client UUID
   * @param tx - Optional Prisma transaction client
   * @returns Decimal where positive = client owes money, negative = credit
   */
  async computeBalance(
    clientId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Decimal> {
    const db = tx ?? this.prisma;

    const [invoices, payments] = await Promise.all([
      (db as any).invoice.findMany({
        where: {
          clientId,
          status: { notIn: ['draft', 'cancelled'] },
        },
        select: { total: true },
      }),
      (db as any).payment.findMany({
        where: { clientId },
        select: { amount: true },
      }),
    ]);

    const invoiceSum = invoices.reduce(
      (sum: Decimal, inv: any) => sum.plus(new Decimal(inv.total.toString())),
      new Decimal(0),
    );

    const paymentSum = payments.reduce(
      (sum: Decimal, pmt: any) =>
        sum.plus(new Decimal(pmt.amount.toString())),
      new Decimal(0),
    );

    return invoiceSum.minus(paymentSum);
  }
}
