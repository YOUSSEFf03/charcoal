import { BadRequestException, Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceLineDto } from './dto/invoice-line.dto';

/** Enriched BAG line stored in invoice.lines JSONB. */
export interface EnrichedBagLine {
  saleUnit: 'BAG';
  bagTypeId: string;
  bagTypeName: string;
  qty: number;
  pricePerBag: string;
  lineTotal: string;
  /** Charcoal type/grade of the stock this line drew from — stamped by the
   * caller (not computeLines itself, which has no stock context) so
   * revenue/cost-by-charcoal-type reporting can read it straight off the
   * line instead of reconstructing it from stock_exits after the fact.
   * Absent on invoices created before this field existed. */
  charcoalType?: string;
  grade?: string;
}

/** Enriched KG line stored in invoice.lines JSONB. */
export interface EnrichedKgLine {
  saleUnit: 'KG';
  kgQuantity: string;
  description: string;
  pricePerKg: string;
  lineTotal: string;
  /** See EnrichedBagLine.charcoalType. */
  charcoalType?: string;
  grade?: string;
}

/** Discriminated union of all enriched line types. */
export type EnrichedLine = EnrichedBagLine | EnrichedKgLine;

@Injectable()
export class InvoiceCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enrich invoice lines with computed lineTotal and return aggregate subtotal.
   *
   * BAG line: lineTotal = qty × pricePerBag
   * KG  line: lineTotal = kgQuantity × pricePerKg
   *
   * The saleUnit discriminator is always written to the output so stored JSONB
   * lines are self-describing. Callers that omit saleUnit are treated as BAG
   * (backward-compat: all historical callers, including walk-in-sales service).
   *
   * @constraint 10 — prices are accepted as-is; no price-list validation.
   */
  computeLines(lines: InvoiceLineDto[]): { lines: EnrichedLine[]; subtotal: string } {
    let subtotal = new Decimal(0);

    const enrichedLines: EnrichedLine[] = lines.map((line) => {
      if (line.saleUnit === 'KG') {
        // KG line — kgQuantity × pricePerKg
        const lineTotal = new Decimal(line.kgQuantity!).mul(line.pricePerKg!);
        subtotal = subtotal.plus(lineTotal);
        return {
          saleUnit: 'KG' as const,
          kgQuantity: new Decimal(line.kgQuantity!).toFixed(3),
          description: line.description!,
          pricePerKg: new Decimal(line.pricePerKg!).toFixed(2),
          lineTotal: lineTotal.toFixed(2),
        };
      }

      // BAG line — qty × pricePerBag (saleUnit = 'BAG' or absent)
      const lineTotal = new Decimal(line.pricePerBag!).mul(line.qty!);
      subtotal = subtotal.plus(lineTotal);
      return {
        saleUnit: 'BAG' as const,
        bagTypeId: line.bagTypeId!,
        bagTypeName: line.bagTypeName!,
        qty: line.qty!,
        pricePerBag: new Decimal(line.pricePerBag!).toFixed(2),
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
   * Recompute invoice paidAmount and status from PaymentAllocation — the
   * authoritative record of how much of which payments applied to this
   * invoice (see PaymentAllocationService). NOT Payment.amount directly:
   * a client-level payment (Payment.invoiceId null) can be FIFO-split across
   * several invoices, so "payments linked to this invoice via invoiceId"
   * undercounts whenever that split happened. Every write path that credits
   * an invoice (direct link or FIFO) goes through PaymentAllocationService,
   * which always inserts a PaymentAllocation row — including for a directly
   * linked payment — so this single source stays correct for both.
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

    const aggregate = await tx.paymentAllocation.aggregate({
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
