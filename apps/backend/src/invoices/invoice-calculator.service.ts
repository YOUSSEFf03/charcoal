import { BadRequestException, Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceLineDto } from './dto/invoice-line.dto';

export interface EnrichedLine {
  bagTypeId: string;
  bagTypeName: string;
  qty: number;
  pricePerBag: string;
  lineTotal: string;
}

@Injectable()
export class InvoiceCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enrich invoice lines with computed lineTotal and return aggregate subtotal.
   * @constraint 10 — pricePerBag is accepted as-is; no price-list validation.
   */
  computeLines(lines: InvoiceLineDto[]): { lines: EnrichedLine[]; subtotal: string } {
    let subtotal = new Decimal(0);

    const enrichedLines: EnrichedLine[] = lines.map((line) => {
      const lineTotal = new Decimal(line.pricePerBag).mul(line.qty);
      subtotal = subtotal.plus(lineTotal);
      return {
        bagTypeId: line.bagTypeId,
        bagTypeName: line.bagTypeName,
        qty: line.qty,
        pricePerBag: new Decimal(line.pricePerBag).toFixed(2),
        lineTotal: lineTotal.toFixed(2),
      };
    });

    return { lines: enrichedLines, subtotal: subtotal.toFixed(2) };
  }

  /**
   * Compute invoice total from subtotal. Total == subtotal (no tax in scope).
   * Isolated here so future discount/tax logic has a single home.
   */
  computeTotal(subtotal: string): string {
    return new Decimal(subtotal).toFixed(2);
  }

  /**
   * Guard: throws INVALID_TRANSITION if invoice is not in draft status.
   * Valid transition: draft → issued only.
   */
  validateIssuable(invoice: { status: InvoiceStatus }): void {
    if (invoice.status !== 'draft') {
      throw new BadRequestException({
        message: 'Invoice can only be issued from draft status',
        error: 'Invoice can only be issued from draft status',
        code: 'INVALID_TRANSITION',
      });
    }
  }

  /**
   * Guard: throws INVALID_TRANSITION if invoice is paid or already cancelled.
   * Terminal states (paid, cancelled) cannot be cancelled.
   */
  validateCancellable(invoice: { status: InvoiceStatus }): void {
    if (invoice.status === 'paid' || invoice.status === 'cancelled') {
      throw new BadRequestException({
        message: 'Invoice cannot be cancelled from its current status',
        error: 'Invoice cannot be cancelled from its current status',
        code: 'INVALID_TRANSITION',
      });
    }
  }

  /**
   * Recompute invoice paidAmount and status from the payment aggregate.
   * Uses tx.payment.aggregate as source of truth — safe against future edits/deletes.
   * @constraint 15 — does not touch Client.balance
   * Status logic: paidAmount >= total → paid; paidAmount > 0 → partially_paid; else → issued
   */
  async recomputeStatus(
    invoiceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ paidAmount: string; status: InvoiceStatus }> {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { total: true },
    });

    const aggregate = await tx.payment.aggregate({
      where: { invoiceId },
      _sum: { amount: true },
    });

    const paidAmount = new Decimal(
      aggregate._sum.amount?.toString() ?? '0',
    );

    const total = new Decimal(invoice!.total.toString());

    let status: InvoiceStatus;
    if (paidAmount.gte(total)) {
      status = 'paid';
    } else if (paidAmount.gt(0)) {
      status = 'partially_paid';
    } else {
      status = 'issued';
    }

    return { paidAmount: paidAmount.toFixed(2), status };
  }
}
