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
   *         + Σ StockExit.amount (exitType = 'client_bags_fill', amount NOT NULL)
   *         − Σ payment.amount
   *
   * Stock exits are operational records, not accounting documents, and are
   * excluded from balance — EXCEPT exitType='client_bags_fill' rows that carry
   * an explicit amount. Those specifically represent a Fill Client's pickup
   * confirmation (see StockExitsService MODE C / FillJobsService — a fill
   * client never receives an Invoice, so this is the ONLY debit source for
   * that client type). This term is a no-op for every other client: normal
   * clients are never given exitType='client_bags_fill' rows by any existing
   * flow, and this query is additionally scoped to amount NOT NULL, which
   * also excludes the amount-less client_bags_fill rows FillJobsService
   * writes for raw charcoal consumption (an internal production record, not
   * a charge — see FillClientLedger audit). Cancelled and draft invoices are
   * excluded because they represent void or uncommitted charges.
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

    const [invoices, fillPickups, payments] = await Promise.all([
      (db as any).invoice.findMany({
        where: {
          clientId,
          status: { notIn: ['draft', 'cancelled'] },
        },
        select: { total: true },
      }),
      (db as any).stockExit.findMany({
        where: {
          clientId,
          exitType: 'client_bags_fill',
          amount: { not: null },
        },
        select: { amount: true },
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

    const fillPickupSum = fillPickups.reduce(
      (sum: Decimal, exit: any) => sum.plus(new Decimal(exit.amount.toString())),
      new Decimal(0),
    );

    const paymentSum = payments.reduce(
      (sum: Decimal, pmt: any) =>
        sum.plus(new Decimal(pmt.amount.toString())),
      new Decimal(0),
    );

    return invoiceSum.plus(fillPickupSum).minus(paymentSum);
  }
}
