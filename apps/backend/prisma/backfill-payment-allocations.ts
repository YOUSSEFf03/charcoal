/**
 * One-time backfill: create PaymentAllocation rows for every existing Payment
 * so PaymentAllocation (not Payment.invoiceId / Invoice.paidAmount) becomes
 * the authoritative record of how each payment was applied — see
 * apps/backend/src/invoices/payment-allocation.service.ts for the live-path
 * equivalent of the logic duplicated here (kept deliberately simple/direct
 * since this is a standalone one-off script, not NestJS-DI'd).
 *
 * Idempotent: any Payment that already has at least one PaymentAllocation
 * row (i.e. already backfilled, or created post-migration through the live
 * code path) is skipped entirely on every run.
 *
 * Two categories, processed identically to the live PaymentsService.create() rules:
 *   - Payment.invoiceId != null → one allocation, full amount, that invoice
 *     (Rule 1 — no clamping, matches existing overpayment-allowed behavior).
 *   - Payment.invoiceId == null → FIFO across that client's open invoices,
 *     oldest (issuedAt, falling back to createdAt) first (Rule 2). Multiple
 *     unlinked payments for the same client are processed oldest-payment-first
 *     too, each seeing the invoice balances left by the ones before it.
 *
 * Usage:
 *   npx ts-node prisma/backfill-payment-allocations.ts            # dry run — report only, no writes
 *   npx ts-node prisma/backfill-payment-allocations.ts --apply    # apply — writes PaymentAllocation rows,
 *                                                                  #         recomputes affected invoices
 *
 * Always run without --apply first and review the report. Each client's
 * writes happen in one transaction (lock the open invoices, allocate,
 * recompute) — a failure partway through one client's payments rolls back
 * only that client, and is printed instead of aborting the whole run.
 */
import { PrismaClient, InvoiceStatus, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

interface ReportRow {
  paymentId: string;
  paymentDisplayId: string | null;
  clientName: string;
  clientId: string;
  paymentAmount: string;
  existingInvoiceId: string | null;
  candidateInvoices: { id: string; displayId: string | null; remaining: string }[];
  proposedAllocations: { invoiceId: string; invoiceDisplayId: string | null; amount: string }[];
  remainingUnapplied: string;
}

function statusFromPaid(total: Decimal, paid: Decimal): InvoiceStatus {
  if (paid.gte(total)) return 'paid';
  if (paid.gt(0)) return 'partially_paid';
  return 'issued';
}

async function main() {
  const unallocated = await prisma.payment.findMany({
    where: { allocations: { none: {} } },
    orderBy: { date: 'asc' },
    select: {
      id: true, displayId: true, clientId: true, invoiceId: true, amount: true,
      client: { select: { name: true } },
    },
  });

  console.log(`Found ${unallocated.length} payment(s) with no existing PaymentAllocation rows.\n`);

  if (unallocated.length === 0) {
    console.log('Nothing to backfill.');
    await prisma.$disconnect();
    return;
  }

  const linked = unallocated.filter((p) => p.invoiceId !== null);
  const unlinkedByClient = new Map<string, typeof unallocated>();
  for (const p of unallocated) {
    if (p.invoiceId !== null) continue;
    const list = unlinkedByClient.get(p.clientId) ?? [];
    list.push(p);
    unlinkedByClient.set(p.clientId, list);
  }

  const report: ReportRow[] = [];

  // ── Category 1: linked payments — 1:1, unambiguous ─────────────────────────
  for (const p of linked) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: p.invoiceId! },
      select: { id: true, displayId: true, total: true },
    });
    if (!invoice) {
      console.log(`SKIP — payment ${p.id} (${p.displayId}) links to invoice ${p.invoiceId}, which no longer exists.`);
      continue;
    }
    report.push({
      paymentId: p.id,
      paymentDisplayId: p.displayId,
      clientName: p.client.name,
      clientId: p.clientId,
      paymentAmount: p.amount.toString(),
      existingInvoiceId: p.invoiceId,
      candidateInvoices: [{ id: invoice.id, displayId: invoice.displayId, remaining: invoice.total.toString() }],
      proposedAllocations: [{ invoiceId: invoice.id, invoiceDisplayId: invoice.displayId, amount: p.amount.toString() }],
      remainingUnapplied: '0.00',
    });
  }

  // ── Category 2: unlinked payments — FIFO per client, oldest payment first ──
  for (const [clientId, payments] of unlinkedByClient) {
    const clientName = payments[0].client.name;
    const openInvoices = await prisma.invoice.findMany({
      where: { clientId, status: { in: ['issued', 'partially_paid'] } },
      orderBy: [{ issuedAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, displayId: true, total: true },
    });

    // Running remaining-balance simulation across this client's payments, in
    // date order, so payment #2 correctly sees what payment #1 already covered.
    const remainingByInvoice = new Map(openInvoices.map((i) => [i.id, new Decimal(i.total.toString())]));

    for (const p of payments) {
      let remaining = new Decimal(p.amount.toString());
      const candidateInvoices = openInvoices.map((i) => ({
        id: i.id, displayId: i.displayId, remaining: (remainingByInvoice.get(i.id) ?? new Decimal(0)).toFixed(2),
      }));
      const proposedAllocations: ReportRow['proposedAllocations'] = [];

      for (const inv of openInvoices) {
        if (remaining.lte(0)) break;
        const invRemaining = remainingByInvoice.get(inv.id)!;
        if (invRemaining.lte(0)) continue;
        const toAllocate = Decimal.min(invRemaining, remaining);
        proposedAllocations.push({ invoiceId: inv.id, invoiceDisplayId: inv.displayId, amount: toAllocate.toFixed(2) });
        remaining = remaining.minus(toAllocate);
        remainingByInvoice.set(inv.id, invRemaining.minus(toAllocate));
      }

      report.push({
        paymentId: p.id,
        paymentDisplayId: p.displayId,
        clientName,
        clientId,
        paymentAmount: p.amount.toString(),
        existingInvoiceId: null,
        candidateInvoices,
        proposedAllocations,
        remainingUnapplied: remaining.toFixed(2),
      });
    }
  }

  // ── Print the audit report ──────────────────────────────────────────────────
  console.log('='.repeat(100));
  console.log('BACKFILL AUDIT REPORT');
  console.log('='.repeat(100));
  for (const r of report) {
    console.log(`\nPayment ${r.paymentId} (${r.paymentDisplayId ?? 'no display id'})`);
    console.log(`  Client:            ${r.clientName} (${r.clientId})`);
    console.log(`  Payment amount:    $${r.paymentAmount}`);
    console.log(`  Existing invoiceId: ${r.existingInvoiceId ?? 'null (unlinked)'}`);
    console.log(`  Candidate invoices: ${r.candidateInvoices.length === 0 ? 'none' :
      r.candidateInvoices.map((i) => `${i.displayId ?? i.id} (remaining $${i.remaining})`).join(', ')}`);
    console.log(`  Proposed allocation: ${r.proposedAllocations.length === 0 ? 'none' :
      r.proposedAllocations.map((a) => `${a.invoiceDisplayId ?? a.invoiceId} = $${a.amount}`).join(', ')}`);
    console.log(`  Remaining unapplied: $${r.remainingUnapplied}`);
  }
  console.log('\n' + '='.repeat(100));
  console.log(`${report.length} payment(s) would be backfilled. Mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);
  console.log('='.repeat(100));

  if (!APPLY) {
    console.log('\nDry run only — re-run with --apply to write these allocations.');
    await prisma.$disconnect();
    return;
  }

  // ── Apply — one transaction per client, so a failure only affects that client ──
  const byClient = new Map<string, ReportRow[]>();
  for (const r of report) {
    const list = byClient.get(r.clientId) ?? [];
    list.push(r);
    byClient.set(r.clientId, list);
  }

  let appliedPayments = 0;
  let appliedAllocations = 0;

  for (const [clientId, rows] of byClient) {
    try {
      await prisma.$transaction(async (tx) => {
        // Lock every invoice this client's rows touch, before writing anything —
        // mirrors PaymentAllocationService's concurrency discipline.
        const invoiceIds = [...new Set(rows.flatMap((r) => r.proposedAllocations.map((a) => a.invoiceId)))];
        for (const invoiceId of invoiceIds) {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM "invoices" WHERE id = ${invoiceId} FOR UPDATE`);
        }

        for (const r of rows) {
          for (const a of r.proposedAllocations) {
            await tx.paymentAllocation.create({
              data: { paymentId: r.paymentId, invoiceId: a.invoiceId, amount: a.amount },
            });
            appliedAllocations++;
          }
          appliedPayments++;
        }

        for (const invoiceId of invoiceIds) {
          const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { total: true } });
          const agg = await tx.paymentAllocation.aggregate({ where: { invoiceId }, _sum: { amount: true } });
          const paidAmount = new Decimal(agg._sum.amount?.toString() ?? '0');
          const total = new Decimal(invoice!.total.toString());
          await tx.invoice.update({
            where: { id: invoiceId },
            data: { paidAmount: paidAmount.toFixed(2), status: statusFromPaid(total, paidAmount) },
          });
        }
      });
      console.log(`Applied ${rows.length} payment(s) for client ${clientId}.`);
    } catch (err) {
      console.error(`FAILED for client ${clientId} — rolled back, no partial writes for this client:`, err);
    }
  }

  console.log(`\nDone. ${appliedPayments} payment(s), ${appliedAllocations} allocation row(s) written.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
