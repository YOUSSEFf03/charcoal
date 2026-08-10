import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { InvoiceCalculatorService } from './invoice-calculator.service';

export interface AllocationResult {
  invoiceId: string;
  amount: string;
}

/**
 * Single authoritative place that writes PaymentAllocation rows and keeps
 * Invoice.paidAmount/status in sync (via InvoiceCalculatorService.recomputeStatus,
 * which itself reads PaymentAllocation — see that method's doc comment).
 *
 * Two entry points, matching the two ways a Payment can be created:
 *   - allocateDirect — Payment.invoiceId was set: the full amount goes to that
 *     one invoice. No clamping to the invoice's remaining balance — this
 *     preserves pre-existing behavior where a directly-linked payment can
 *     push status to 'paid' even if it technically overpays.
 *   - allocateFifo — Payment.invoiceId was null (client-level payment): the
 *     amount is split across the client's open invoices oldest-first,
 *     clamped per invoice to what's actually still owed on it. Any amount
 *     left over after all open invoices are covered is NOT allocated to
 *     anything — it stays visible only as a negative live-computed client
 *     balance (ClientBalanceService, CONSTRAINT 15), never written anywhere.
 *
 * Concurrency: both entry points take out a `SELECT ... FOR UPDATE` lock on
 * every invoice they're about to touch, inside the same transaction the
 * caller is already running the whole payment-creation flow in, BEFORE
 * reading how much is already allocated to those invoices. Two payments
 * racing to allocate against the same invoice therefore serialize on that
 * lock — the second one only computes "remaining balance" after the first
 * has committed (or rolled back), so they can never both see the invoice as
 * having $100 left and both allocate $100 against it.
 *
 * Invariants (enforced here transactionally, not by a DB CHECK constraint —
 * Postgres CHECK constraints are per-row and can't reference other rows,
 * i.e. can't express a cross-row SUM; a trigger could, but that's more
 * machinery than a single code path funneling all writes needs):
 *   - SUM(allocations for a given payment) never exceeds that payment's amount
 *     — structurally true by construction (allocateFifo only ever allocates
 *     out of a monotonically-decreasing running remainder that starts at the
 *     payment amount; allocateDirect writes exactly one row for the full
 *     amount). Asserted defensively below anyway.
 *   - SUM(allocations for a given invoice) never exceeds that invoice's total
 *     — enforced by clamping in allocateFifo. NOT enforced in allocateDirect
 *     (matches existing pre-this-change behavior for linked payments).
 */
@Injectable()
export class PaymentAllocationService {
  constructor(private readonly calculator: InvoiceCalculatorService) {}

  /**
   * Rule 1 — payment explicitly linked to one invoice at creation time.
   * Locks that invoice, writes one allocation for the full payment amount,
   * recomputes the invoice's paidAmount/status.
   */
  async allocateDirect(
    tx: Prisma.TransactionClient,
    paymentId: string,
    invoiceId: string,
    amount: Decimal,
  ): Promise<void> {
    if (!amount.gt(0)) {
      throw new InternalServerErrorException('allocateDirect requires a positive amount');
    }

    // Lock the target invoice row — serializes against any concurrent
    // allocator (direct or FIFO) touching the same invoice.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "invoices" WHERE id = ${invoiceId} FOR UPDATE`);

    await tx.paymentAllocation.create({
      data: { paymentId, invoiceId, amount: amount.toFixed(2) },
    });

    const { paidAmount, status } = await this.calculator.recomputeStatus(invoiceId, tx);
    await tx.invoice.update({ where: { id: invoiceId }, data: { paidAmount, status } });
  }

  /**
   * Rule 2 — client-level payment (no invoiceId given at creation time).
   * FIFO-allocates `amount` across clientId's open invoices, oldest
   * (issuedAt, falling back to createdAt for never-issued edge cases —
   * matches ReportsService.getClientLedger's own ordering convention) first.
   * Returns the per-invoice amounts allocated and whatever was left over
   * unapplied (informational only — never written anywhere; the client's
   * live balance calculation is what actually represents it).
   */
  async allocateFifo(
    tx: Prisma.TransactionClient,
    clientId: string,
    paymentId: string,
    amount: Decimal,
  ): Promise<{ allocations: AllocationResult[]; unapplied: string }> {
    if (!amount.gt(0)) {
      throw new InternalServerErrorException('allocateFifo requires a positive amount');
    }

    // Lock + fetch the client's open invoices in one statement, pre-ordered
    // oldest-first, so there's no gap between locking and reading order in
    // which a concurrent transaction could change what we see.
    const invoices = await tx.$queryRaw<{ id: string; total: string }[]>(Prisma.sql`
      SELECT id, total::text AS total
      FROM "invoices"
      WHERE "clientId" = ${clientId}
        AND status IN ('issued', 'partially_paid')
      ORDER BY COALESCE("issuedAt", "createdAt") ASC
      FOR UPDATE
    `);

    if (invoices.length === 0) {
      return { allocations: [], unapplied: amount.toFixed(2) };
    }

    const grouped = await tx.paymentAllocation.groupBy({
      by: ['invoiceId'],
      where: { invoiceId: { in: invoices.map((i) => i.id) } },
      _sum: { amount: true },
    });
    const alreadyAllocatedByInvoice = new Map(
      grouped.map((g) => [g.invoiceId, new Decimal(g._sum.amount?.toString() ?? '0')]),
    );

    let remaining = amount;
    const allocations: AllocationResult[] = [];

    for (const inv of invoices) {
      if (remaining.lte(0)) break;

      const total = new Decimal(inv.total);
      const alreadyAllocated = alreadyAllocatedByInvoice.get(inv.id) ?? new Decimal(0);
      const invoiceRemaining = total.minus(alreadyAllocated);
      // Defensive only: an invoice fetched here is issued/partially_paid,
      // which recomputeStatus never sets while paidAmount >= total — this
      // should be unreachable, but skip rather than write a non-positive row.
      if (invoiceRemaining.lte(0)) continue;

      const toAllocate = Decimal.min(invoiceRemaining, remaining);

      await tx.paymentAllocation.create({
        data: { paymentId, invoiceId: inv.id, amount: toAllocate.toFixed(2) },
      });
      allocations.push({ invoiceId: inv.id, amount: toAllocate.toFixed(2) });
      remaining = remaining.minus(toAllocate);

      const { paidAmount, status } = await this.calculator.recomputeStatus(inv.id, tx);
      await tx.invoice.update({ where: { id: inv.id }, data: { paidAmount, status } });
    }

    if (remaining.gt(amount)) {
      // Can only happen from a logic error above — never allocate more than received.
      throw new InternalServerErrorException('FIFO allocation exceeded payment amount');
    }

    return { allocations, unapplied: remaining.toFixed(2) };
  }
}
