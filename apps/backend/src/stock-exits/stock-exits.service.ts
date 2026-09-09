import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExitType, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockExitDto } from './dto/create-stock-exit.dto';
import { UpdateStockExitDto } from './dto/update-stock-exit.dto';
import Decimal from 'decimal.js';
import { LedgerWriteService } from '../ledger/ledger-write.service';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';

// SPEC.md §3.4 — Worker: "Log non-sale exits (samples, internal use)" and
// "Cannot see: prices, costs, client information". Workers are role-gated
// into this endpoint (@Roles includes 'worker') but @Roles can't see the
// request body, so the sale-vs-non-sale distinction is enforced here instead.
const WORKER_ALLOWED_EXIT_TYPES: ExitType[] = ['sample', 'internal', 'gift'];

/**
 * SHA-256 of the fields that define WHAT is being exited/collected — never
 * display-only fields (recipient, reason) or the idempotencyKey itself.
 * Mirrors computeSaleFingerprint() in walk-in-sales.service.ts exactly, for
 * the sibling endpoint that actually handles anonymous walk-in sales (see
 * StockExitsService.create()'s doc comment). collectedById takes priority
 * over collectedBy in create()'s own resolution, so an ignored collectedBy
 * must not affect the fingerprint. Exported for direct unit testing.
 */
export function computeStockExitFingerprint(dto: CreateStockExitDto): string {
  const canonical = JSON.stringify({
    exitType: dto.exitType,
    date: dto.date,
    packedStockId: dto.packedStockId ?? null,
    bagTypeId: dto.bagTypeId ?? null,
    quantity: dto.quantity ?? null,
    lotId: dto.lotId ?? null,
    kgQuantity: dto.kgQuantity ?? null,
    clientId: dto.clientId ?? null,
    amount: dto.amount ?? null,
    currency: dto.currency ?? null,
    collectedById: dto.collectedById ?? null,
    collectedBy: dto.collectedById ? null : (dto.collectedBy ?? null),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

@Injectable()
export class StockExitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerWriteService: LedgerWriteService,
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Return a paginated list of stock exits with optional filters.
   *
   * @param page - 1-indexed page
   * @param limit - Items per page
   * @param exitType - Optional exitType filter
   * @param dateFrom - Optional ISO date lower bound
   * @param dateTo - Optional ISO date upper bound
   */
  async findAll(
    page: number,
    limit: number,
    exitType?: ExitType,
    dateFrom?: string,
    dateTo?: string,
    clientId?: string,
    lotId?: string,
    hasAmount?: boolean,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.StockExitWhereInput = {
      ...(exitType ? { exitType } : {}),
      ...(clientId ? { clientId } : {}),
      ...(dateFrom || dateTo
        ? {
            date: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
      // Filter by lot: raw by-kg exits OR packed exits whose packed stock came from this lot
      ...(lotId
        ? { OR: [{ lotId }, { packedStock: { lotId } }] }
        : {}),
      // Opt-in: excludes amount=null rows. For exitType='client_bags_fill'
      // specifically, a null amount means this row is the internal charcoal-
      // consumption bookkeeping exit FillJobsService.create() itself writes
      // (Step 7 of that method — kg leaving the warehouse for a fill job),
      // NOT a customer bag pickup (which always has amount set — see
      // ConfirmFillPickup/POST /stock-exits). The Fill Client Pickups pages
      // pass this so that internal row never renders as a garbled pickup row
      // (its `reason` is a plain "Fill job <id>" string, not the bag-summary
      // JSON a real pickup's reason holds). Same amount:{not:null} distinction
      // FillJobsService.getYtdSummary() already uses for its revenue query.
      ...(hasAmount ? { amount: { not: null } } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.stockExit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          bagType: true,
          loggedBy: { select: { id: true, name: true } },
          lot: { select: { id: true, charcoalType: true, grade: true } },
          packedStock: {
            include: {
              lot: { select: { id: true, charcoalType: true, grade: true, kgReceived: true } },
            },
          },
          // Display-only — lets the UI show the real per-line sale price for
          // invoice-linked walk-ins, whose own `amount` column stays null
          // (see StockExit.invoiceId doc comment in schema.prisma).
          invoice: { select: { id: true, displayId: true, lines: true, currency: true } },
        },
      }),
      this.prisma.stockExit.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Same filters as findAll(), but paginated by LOGICAL SALE rather than raw
   * StockExit row (forensic audit, 2026-08-28 — the confirmed "sale history
   * grouped by StockExit" bug: a single invoiced walk-in sale whose FIFO draw
   * spans more than one packed-stock/lot row produces multiple StockExit
   * rows sharing one `invoiceId`, and every display surface that rendered
   * one row per StockExit therefore showed one sale as several).
   *
   * A "logical sale" is either:
   *   - every StockExit sharing a non-null invoiceId (a registered-client
   *     walk-in sale — see StockExit.invoiceId's doc comment; only
   *     WalkInSalesService ever sets it), collapsed into ONE row whose
   *     `lines` come from Invoice.lines (the complete, authoritative
   *     breakdown of that sale — already covers every line regardless of
   *     how many StockExit rows the FIFO draw actually produced), or
   *   - a single StockExit with invoiceId=null (anonymous walk-in / sample /
   *     internal / fill-job exit — never grouped, since nothing else shares
   *     its key), returned as a one-line row built from its own fields.
   *
   * Pagination is computed over the DISTINCT group key
   * (COALESCE(invoiceId, id)), not raw rows — grouping only the CURRENT PAGE
   * of raw rows client-side would silently split a sale across a page
   * boundary once StockExit rows for one invoice landed on different pages,
   * so the grouping has to happen before pagination, at the database level.
   */
  async findAllGrouped(
    page: number,
    limit: number,
    exitType?: ExitType,
    dateFrom?: string,
    dateTo?: string,
    clientId?: string,
  ) {
    const skip = (page - 1) * limit;

    const conditions: Prisma.Sql[] = [];
    if (exitType) conditions.push(Prisma.sql`"exitType" = ${exitType}::"ExitType"`);
    if (clientId) conditions.push(Prisma.sql`"clientId" = ${clientId}`);
    if (dateFrom) conditions.push(Prisma.sql`"date" >= ${new Date(dateFrom)}`);
    if (dateTo) conditions.push(Prisma.sql`"date" <= ${new Date(dateTo)}`);
    const whereSql = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    const [totalRows, pageKeys] = await Promise.all([
      this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM (
          SELECT COALESCE("invoiceId", "id") AS key FROM "stock_exits" ${whereSql} GROUP BY key
        ) t
      `),
      this.prisma.$queryRaw<{ key: string }[]>(Prisma.sql`
        SELECT COALESCE("invoiceId", "id") AS key
        FROM "stock_exits"
        ${whereSql}
        GROUP BY key
        ORDER BY MAX("date") DESC, key ASC
        LIMIT ${limit} OFFSET ${skip}
      `),
    ]);

    const total = Number(totalRows[0]?.count ?? 0);
    const orderedKeys = pageKeys.map((k) => k.key);
    if (orderedKeys.length === 0) {
      return { data: [], total, page, limit };
    }

    // Fetch every StockExit belonging to one of this page's groups — either
    // its invoiceId is one of the page's keys, or (for a standalone exit)
    // its own id is.
    const exits = await this.prisma.stockExit.findMany({
      where: {
        OR: [
          { invoiceId: { in: orderedKeys } },
          { id: { in: orderedKeys }, invoiceId: null },
        ],
      },
      include: {
        bagType: true,
        lot: { select: { id: true, charcoalType: true, grade: true } },
        packedStock: { include: { lot: { select: { id: true, charcoalType: true, grade: true } } } },
        loggedBy: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        invoice: {
          select: {
            id: true,
            displayId: true,
            lines: true,
            currency: true,
            total: true,
            paidAmount: true,
            status: true,
            // Authoritative "what has actually been applied to this invoice" —
            // same field InvoicesService.findOne() prefers over `payments` for
            // the identical reason (a client-level payment can be FIFO-split
            // across several invoices; `payments` alone would misattribute it).
            allocations: {
              orderBy: { createdAt: 'asc' },
              select: {
                amount: true,
                payment: {
                  select: {
                    id: true,
                    displayId: true,
                    date: true,
                    amount: true,
                    currency: true,
                    method: true,
                    receiverId: true,
                    receiverName: true,
                    receiver: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    // ── Ledger-authoritative receiver credit (forensic audit, warehouse sale
    // log, 2026-08-31) ───────────────────────────────────────────────────────
    // "Credited to receiver" must come from the actual AccountEntry
    // LedgerWriteService wrote — never be recomputed from Payment.amount or
    // StockExit.amount. LedgerWriteService.creditAccount() is the only writer
    // of these entries and is always called with the exact same Decimal that
    // was just stored on the Payment/StockExit, so the two are equal by
    // construction today — but this reads the real ledger row rather than
    // re-deriving the figure, so the log can never silently drift from the
    // ledger if that invariant is ever broken. Never writes anything (pure
    // read) and never allocates/derives a NEW figure — only surfaces the one
    // AccountEntry LedgerWriteService already created at sale time.
    const paymentIds = new Set<string>();
    for (const exit of exits) {
      if (exit.invoiceId && exit.invoice) {
        // Only payments with a receiver ever get an AccountEntry
        // (LedgerWriteService.creditAccount only runs when receiverId is set)
        // — skip the rest so this query never asks the ledger about a payment
        // it can never have an entry for.
        for (const alloc of exit.invoice.allocations) {
          if (alloc.payment.receiverId) paymentIds.add(alloc.payment.id);
        }
      }
    }
    const standaloneExitIds = exits.filter((e) => !e.invoiceId && e.collectedById).map((e) => e.id);
    const referenceIds = [...paymentIds, ...standaloneExitIds];
    const ledgerEntries = referenceIds.length
      ? await this.prisma.accountEntry.findMany({
          where: { referenceId: { in: referenceIds }, type: { in: ['payment_received', 'sale_collected'] } },
          select: { referenceId: true, amount: true },
        })
      : [];
    const ledgerAmountByRef = new Map<string, Decimal>();
    for (const e of ledgerEntries) {
      if (!e.referenceId) continue;
      const prev = ledgerAmountByRef.get(e.referenceId) ?? new Decimal(0);
      ledgerAmountByRef.set(e.referenceId, prev.plus(e.amount.toString()));
    }

    const byKey = new Map<string, typeof exits>();
    for (const exit of exits) {
      const key = exit.invoiceId ?? exit.id;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(exit);
    }

    // Resolve nominalKg/costPerBag/workerRate for every bagTypeId referenced
    // by an invoice line — invoice.lines only stores bagTypeId/bagTypeName/
    // qty/pricePerBag (the SALE price, not the internal cost/worker-rate
    // figures the detail panel also shows), so this needs one extra batched
    // lookup, same pattern as getWalkInSummary() above.
    const invoiceLineBagTypeIds = new Set<string>();
    for (const group of byKey.values()) {
      const rep = group[0];
      if (rep?.invoiceId && rep.invoice) {
        for (const line of (rep.invoice.lines as any[]) ?? []) {
          if (line.saleUnit !== 'KG' && line.bagTypeId) invoiceLineBagTypeIds.add(line.bagTypeId);
        }
      }
    }
    const extraBagTypes = invoiceLineBagTypeIds.size
      ? await this.prisma.bagType.findMany({
          where: { id: { in: [...invoiceLineBagTypeIds] } },
          select: { id: true, nominalKg: true, costPerBag: true, workerRate: true },
        })
      : [];
    const bagTypeById = new Map(extraBagTypes.map((bt) => [bt.id, bt]));
    const nominalKgById = new Map(extraBagTypes.map((bt) => [bt.id, bt.nominalKg]));

    const data = orderedKeys
      .map((key) => {
        const group = byKey.get(key) ?? [];
        const rep = group[0];
        if (!rep) return null;

        if (rep.invoiceId && rep.invoice) {
          const invLines = (rep.invoice.lines as any[]) ?? [];
          const lines = invLines.map((line) => {
            const bt = line.bagTypeId ? bagTypeById.get(line.bagTypeId) : undefined;
            return {
              saleUnit: line.saleUnit ?? 'BAG',
              bagTypeId: line.bagTypeId ?? null,
              bagTypeName: line.bagTypeName ?? null,
              qty: line.qty ?? null,
              kgQuantity: line.kgQuantity ?? null,
              pricePerBag: line.pricePerBag ?? null,
              pricePerKg: line.pricePerKg ?? null,
              lineTotal: line.lineTotal ?? null,
              charcoalType: line.charcoalType ?? null,
              grade: line.grade ?? null,
              nominalKgPerBag: bt?.nominalKg?.toString() ?? null,
              costPerBag: bt?.costPerBag?.toString() ?? null,
              workerRatePerBag: bt?.workerRate?.toString() ?? null,
            };
          });
          let totalQtyBags = 0;
          let totalKg = new Decimal(0);
          for (const line of lines) {
            if (line.saleUnit === 'KG') {
              totalKg = totalKg.plus(new Decimal(line.kgQuantity ?? '0'));
            } else {
              totalQtyBags += line.qty ?? 0;
              const nomKg = line.bagTypeId ? nominalKgById.get(line.bagTypeId) : undefined;
              if (nomKg) totalKg = totalKg.plus(new Decimal(nomKg.toString()).mul(line.qty ?? 0));
            }
          }
          return {
            id: rep.invoiceId,
            invoiceId: rep.invoiceId,
            invoiceDisplayId: rep.invoice.displayId,
            date: rep.date,
            clientId: rep.clientId,
            client: rep.client,
            recipient: rep.recipient,
            loggedBy: rep.loggedBy,
            currency: rep.invoice.currency,
            lines,
            lineCount: lines.length,
            totalQtyBags,
            totalKg: totalKg.toFixed(3),
            // SALE — the invoice's own authoritative total (InvoiceCalculatorService).
            saleTotal: new Decimal(rep.invoice.total.toString()).toFixed(2),
            // PAYMENT/BALANCE — Invoice.paidAmount/status, recomputed by
            // PaymentAllocationService from `allocations` (never a client-side sum).
            paidAmount: new Decimal(rep.invoice.paidAmount.toString()).toFixed(2),
            remaining: Decimal.max(
              0,
              new Decimal(rep.invoice.total.toString()).minus(rep.invoice.paidAmount.toString()),
            ).toFixed(2),
            status: rep.invoice.status,
            // RECEIVER — one entry per payment actually applied to THIS invoice
            // (see `allocations` doc comment above); supports partial/multiple
            // payments and multiple receivers on the same sale.
            payments: rep.invoice.allocations.map((a) => ({
              paymentId: a.payment.id,
              displayId: a.payment.displayId,
              date: a.payment.date,
              // How much of THIS payment applied to THIS invoice (never the
              // payment's full amount, which may span other invoices too).
              appliedAmount: new Decimal(a.amount.toString()).toFixed(2),
              paymentAmount: new Decimal(a.payment.amount.toString()).toFixed(2),
              currency: a.payment.currency,
              method: a.payment.method,
              receiverId: a.payment.receiverId,
              receiverName: a.payment.receiver?.name ?? a.payment.receiverName ?? null,
              // Ledger-authoritative — see the ledgerAmountByRef comment above.
              // Null only when no receiver was assigned (no AccountEntry exists).
              creditedAmount: ledgerAmountByRef.has(a.payment.id)
                ? ledgerAmountByRef.get(a.payment.id)!.toFixed(2)
                : null,
            })),
          };
        }

        // Standalone (non-invoiced) exit — exactly one line, from its own fields.
        const isRaw = !!rep.lotId;
        const line = isRaw
          ? {
              saleUnit: 'KG' as const,
              bagTypeId: null, bagTypeName: null, qty: null,
              kgQuantity: rep.kgQuantity?.toString() ?? null,
              pricePerBag: null, pricePerKg: null,
              charcoalType: rep.lot?.charcoalType ?? null,
              grade: rep.lot?.grade ?? null,
            }
          : {
              saleUnit: 'BAG' as const,
              bagTypeId: rep.bagTypeId ?? null,
              bagTypeName: rep.bagType?.name ?? null,
              qty: rep.quantity ?? null,
              kgQuantity: null,
              pricePerBag: null, pricePerKg: null,
              charcoalType: rep.packedStock?.lot?.charcoalType ?? null,
              grade: rep.packedStock?.lot?.grade ?? null,
            };
        const totalKg = isRaw
          ? new Decimal(rep.kgQuantity?.toString() ?? '0')
          : rep.bagType
            ? new Decimal(rep.bagType.nominalKg.toString()).mul(rep.quantity ?? 0)
            : new Decimal(0);

        // Anonymous walk-ins have no Invoice/Payment — StockExit.amount IS both
        // the sale price and the amount collected (there is no separate
        // "received vs. owed" split for this path; see doSubmitSale() in
        // WarehouseSales.tsx, which computes ONE `amount` for the whole line).
        // amount=null means the price was never recorded ("on account" /
        // unknown) — never treated as $0 paid.
        const anonAmount = rep.amount != null ? new Decimal(rep.amount.toString()).toFixed(2) : null;
        return {
          id: rep.id,
          invoiceId: null,
          invoiceDisplayId: null,
          date: rep.date,
          clientId: rep.clientId,
          client: rep.client,
          recipient: rep.recipient,
          loggedBy: rep.loggedBy,
          currency: rep.currency,
          lines: [line],
          lineCount: 1,
          totalQtyBags: isRaw ? 0 : (rep.quantity ?? 0),
          totalKg: totalKg.toFixed(3),
          saleTotal: anonAmount,
          paidAmount: anonAmount ?? '0.00',
          remaining: anonAmount != null ? '0.00' : null,
          status: anonAmount != null ? 'recorded' : 'on_account',
          // No PaymentMethod is captured for anonymous walk-ins today (no
          // `method` column on StockExit — the Entry tab's payment-method
          // dropdown is only wired to the registered-client/invoiced path).
          // Reported honestly as `method: null` rather than guessed.
          payments: anonAmount != null
            ? [{
                paymentId: null,
                displayId: null,
                date: rep.date,
                appliedAmount: anonAmount,
                paymentAmount: anonAmount,
                currency: rep.currency,
                method: null,
                receiverId: rep.collectedById,
                receiverName: rep.collectedBy,
                creditedAmount: rep.collectedById && ledgerAmountByRef.has(rep.id)
                  ? ledgerAmountByRef.get(rep.id)!.toFixed(2)
                  : null,
              }]
            : [],
          // The full raw exit — needed by the standalone-exit detail panel /
          // edit-amount flow (PATCH /stock-exits/:id), which stays exit-level.
          // Never present on an invoice-grouped row (nothing there is
          // editable via this endpoint — price comes from the invoice).
          rawExit: rep,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return { data, total, page, limit };
  }

  /**
   * Return a single stock exit by ID.
   *
   * @param id - StockExit UUID
   * @throws NotFoundException
   */
  async findOne(id: string) {
    const exit = await this.prisma.stockExit.findUnique({
      where: { id },
      include: {
        bagType: true,
        packedStock: true,
        loggedBy: { select: { id: true, name: true } },
        invoice: { select: { id: true, displayId: true, lines: true, currency: true } },
      },
    });
    if (!exit) {
      throw new NotFoundException({ error: 'Stock exit not found', code: 'NOT_FOUND' });
    }
    return exit;
  }

  /**
   * Aggregate walk-in sales totals for a date range without a page limit.
   *
   * Returns:
   *   bags — SUM(quantity) across all walk_in packed-bag exits in the range
   *   kg   — SUM(quantity × nominalKg) per bag type, accumulated with Decimal
   *
   * Uses groupBy+aggregate inside a transaction so both reads are consistent.
   * This is the source of truth for the KPI tiles; the paginated list endpoint
   * must never be used to compute totals (page cap → undercount).
   */
  async getWalkInSummary(dateFrom: string, dateTo: string): Promise<{ bags: number; kg: string }> {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);

    // Inline where objects — spreading StockExitWhereInput into groupBy's where
    // triggers a Prisma/TS circular-reference error, so both are written explicitly.
    const dateFilter = { gte: from, lte: to };

    const [bagSum, byBagType] = await Promise.all([
      this.prisma.stockExit.aggregate({
        where: { exitType: 'walk_in', date: dateFilter, quantity: { not: null } },
        _sum: { quantity: true },
      }),
      this.prisma.stockExit.groupBy({
        by: ['bagTypeId'],
        where: { exitType: 'walk_in', date: dateFilter, quantity: { not: null }, bagTypeId: { not: null } },
        _sum: { quantity: true },
      }),
    ]);

    // Resolve nominalKg for each bag type that appears in the grouped results.
    const bagTypeIds = byBagType.map((g) => g.bagTypeId).filter(Boolean) as string[];
    const bagTypes = bagTypeIds.length
      ? await this.prisma.bagType.findMany({
          where: { id: { in: bagTypeIds } },
          select: { id: true, nominalKg: true },
        })
      : [];
    const nominalKgById = new Map(bagTypes.map((bt) => [bt.id, bt.nominalKg]));

    const totalKg = byBagType.reduce((sum, g) => {
      const qty = g._sum.quantity ?? 0;
      const nomKg = g.bagTypeId ? (nominalKgById.get(g.bagTypeId) ?? new Decimal(0)) : new Decimal(0);
      return sum.plus(new Decimal(nomKg.toString()).mul(qty));
    }, new Decimal(0));

    return { bags: bagSum._sum.quantity ?? 0, kg: totalKg.toFixed(3) };
  }

  /**
   * Warehouse cash box — cash ACTUALLY COLLECTED from warehouse sales on one
   * calendar day, from the two places it can legitimately live:
   *
   *   A) Anonymous walk-ins — StockExit(exitType='walk_in', invoiceId=null,
   *      amount NOT NULL). No invoice exists for these (WalkInSalesService's
   *      own doc comment: "Anonymous walk-ins are out of scope — they
   *      continue to use POST /stock-exits"), so the exit's own `amount` IS
   *      the cash collected. Scoped to invoiceId=null (not just clientId)
   *      per the StockExit.invoiceId doc comment, so it can never overlap
   *      with case B below even in an edge case where an anonymous-style row
   *      happens to carry a clientId.
   *
   *   B) Registered-client sales — via PaymentAllocation, NOT Payment.invoiceId.
   *      PaymentAllocation is the authoritative record of how much of which
   *      Payment applied to which Invoice (see PaymentAllocationService and
   *      InvoiceCalculatorService.recomputeStatus()'s own doc comment: "a
   *      client-level payment (Payment.invoiceId null) can be FIFO-split
   *      across several invoices, so 'payments linked to this invoice via
   *      invoiceId' undercounts whenever that split happened"). A payment
   *      made directly against a WAREHOUSE_SALE invoice (WalkInSalesService,
   *      via allocateDirect) still produces exactly one PaymentAllocation row
   *      for the full amount — so this single query correctly covers BOTH
   *      directly-linked payments AND FIFO-split client-level payments (no
   *      invoiceId at all) that happened to apply part of their amount to an
   *      open WAREHOUSE_SALE invoice, with no separate path needed for either.
   *      Ordinary client payments (Order-invoice allocations, or the unapplied
   *      portion of a client-level payment) never leak in — the Prisma
   *      relation filter only matches allocation rows whose invoice exists
   *      AND has source='WAREHOUSE_SALE'.
   *      PaymentAllocation has no currency of its own — its `amount` is
   *      always a slice of the parent Payment's own `amount`, so currency
   *      conversion uses the parent Payment's `currency`, not the invoice's.
   *      Dated by the parent Payment's `date` (PaymentAllocation.createdAt is
   *      just an insert timestamp, not the cash-collected date).
   *
   * An unpaid warehouse invoice simply has no PaymentAllocation row yet for
   * that day (contributes 0); a partially-paid one has exactly the amount(s)
   * actually allocated that day — no separate "unpaid" adjustment needed.
   *
   * Both StockExit.date and Payment.date are @db.Date columns — a single
   * calendar-day gte/lte bound, no timezone conversion (same convention
   * reports.service.ts already uses for these two columns).
   *
   * Currency conversion mirrors getClientWarehouseSummary()'s existing rule —
   * the single global exchange rate from SettingsService, LBP divided by rate.
   */
  async getWarehouseCashSummary(date: string): Promise<{
    date: string;
    cashCollected: string;
    paymentCount: number;
    anonymousSalesCount: number;
  }> {
    const day = new Date(date);
    const dateFilter = { gte: day, lte: day };

    const rate = new Decimal(await this.settingsService.getExchangeRate());
    const toUsd = (amount: Decimal, currency: string): Decimal =>
      currency === 'LBP' ? (rate.gt(0) ? amount.div(rate) : new Decimal(0)) : amount;

    const [anonymousExits, warehouseAllocations] = await Promise.all([
      this.prisma.stockExit.findMany({
        where: { exitType: 'walk_in', invoiceId: null, amount: { not: null }, date: dateFilter },
        select: { amount: true, currency: true },
      }),
      this.prisma.paymentAllocation.findMany({
        where: { invoice: { source: 'WAREHOUSE_SALE' }, payment: { date: dateFilter } },
        select: { amount: true, paymentId: true, payment: { select: { currency: true } } },
      }),
    ]);

    const anonymousUsd = anonymousExits.reduce(
      (sum, e) => sum.plus(toUsd(new Decimal(e.amount!.toString()), e.currency)),
      new Decimal(0),
    );
    const paymentsUsd = warehouseAllocations.reduce(
      (sum, a) => sum.plus(toUsd(new Decimal(a.amount.toString()), a.payment.currency)),
      new Decimal(0),
    );
    // One payment can produce multiple allocation rows (FIFO-split across
    // several warehouse invoices on the same day) — count it once.
    const distinctPaymentCount = new Set(warehouseAllocations.map((a) => a.paymentId)).size;

    return {
      date,
      cashCollected: anonymousUsd.plus(paymentsUsd).toFixed(2),
      paymentCount: distinctPaymentCount,
      anonymousSalesCount: anonymousExits.length,
    };
  }

  /**
   * "On account (no amount)" diagnostic — count of today's walk_in StockExit
   * rows that belong to a registered client, carry no amount of their own
   * (invoice-linked — see WalkInSalesService), and whose client hasn't
   * logged ANY payment yet today.
   *
   * This is a direct server-side port of WarehouseSales.tsx's previous
   * client-side computation:
   *   paidClientIds = Set(todayPayments.map(p => p.clientId))
   *   onAccount = todayExits.filter(e =>
   *     e.clientId && !e.amount && !paidClientIds.has(e.clientId)
   *   ).length
   * — same definition, same "has this client paid ANYTHING today" heuristic
   * (not scoped to warehouse-sale invoices, not per-invoice — this is
   * intentionally the exact existing business meaning, not a redefinition;
   * see the WarehouseSales scalability audit for the known limitation of
   * that heuristic, which this fix does not change).
   *
   * Both source queries were previously capped at limit:100 (todayExitsQ /
   * todayPaymentsQ), which could silently undercount this figure on a busy
   * day. This method runs both unbounded for a single date:
   *   - distinct paying clientIds today (bounded by how many DISTINCT
   *     clients pay in one day — small, not a page-cap risk even unbounded)
   *   - a single stockExit.count() for the actual on-account condition,
   *     computed entirely in the database.
   *
   * Deliberately separate from getWarehouseCashSummary() — that method is
   * already correct and is not modified here.
   */
  async getOnAccountCount(date: string): Promise<{ date: string; onAccountCount: number }> {
    const day = new Date(date);
    const dateFilter = { gte: day, lte: day };

    const payingClients = await this.prisma.payment.findMany({
      where: { date: dateFilter },
      distinct: ['clientId'],
      select: { clientId: true },
    });
    const payingClientIds = payingClients.map((p) => p.clientId);

    const onAccountCount = await this.prisma.stockExit.count({
      where: {
        exitType: 'walk_in',
        date: dateFilter,
        clientId: { not: null, notIn: payingClientIds },
        amount: null,
      },
    });

    return { date, onAccountCount };
  }

  /**
   * Aggregate ONE client's COMPLETE warehouse-sales history (all exit types,
   * matching the same unfiltered scope ClientDetail's warehouse-sales tab
   * already queries) — count, kg, and USD-equivalent amount — without
   * paginating and without loading every row into Node for the parts that
   * can be summed in the database.
   *
   * totalCount/totalKg are pure DB aggregation (count/sum/groupBy), the same
   * pattern getWalkInSummary() above already uses for kg (packed bags via
   * groupBy(bagTypeId) + a small bagType lookup; extended here to also cover
   * raw-lot kg via a plain SUM(kgQuantity), which getWalkInSummary() doesn't
   * need since it's bag-sales-only).
   *
   * totalAmount is necessarily a hybrid:
   *  - Rows with an explicit `amount` are SUM'd in the DB, grouped by
   *    currency (LBP divided by the current exchange rate, same conversion
   *    reports.service.ts already uses elsewhere).
   *  - Rows with amount=NULL but an invoiceId — the NORMAL case for a
   *    registered client's atomic invoice-linked sales (see the
   *    StockExit.invoiceId doc comment in schema.prisma) — have their real
   *    price on ONE LINE of the linked invoice's `lines` JSON, not a scalar
   *    column. That can't be safely summed in SQL without reimplementing
   *    WarehouseSales.tsx's line-matching rule (exitDisplayAmountUsd()) in
   *    raw SQL, which risks silently drifting from the canonical logic. This
   *    subset is instead fetched with a minimal field selection, scoped to
   *    ONE client — the same "safe unbounded per-entity history" scale
   *    profile already used by getClientLedger()/computeBalance() — and
   *    resolved with the EXACT same fallback rule exitDisplayAmountUsd()
   *    uses, ported here rather than reinvented so the two can never
   *    disagree. A row whose invoice has no matching line contributes 0 to
   *    the sum (exitDisplayAmountUsd() returns null there, which the UI
   *    shows as "—"; for a SUM total, "no known price" and "0" are the same
   *    thing).
   */
  async getClientWarehouseSummary(
    clientId: string,
  ): Promise<{ totalCount: number; totalKg: string; totalAmount: string }> {
    const rate = new Decimal(await this.settingsService.getExchangeRate());
    const toUsd = (amount: Decimal, currency: string): Decimal =>
      currency === 'LBP' ? (rate.gt(0) ? amount.div(rate) : new Decimal(0)) : amount;
    const toNum = (v: unknown): number => {
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
      return Number.isFinite(n) ? n : 0;
    };

    const [totalCountRows, rawKgSum, byBagType, explicitAmountByCurrency, unresolvedExits] = await Promise.all([
      // DISTINCT logical sale count (forensic audit, 2026-08-28) — a plain
      // stockExit.count() over-counts every multi-lot walk-in sale (2+
      // StockExit rows sharing one invoiceId inflate "Purchases" by however
      // many lots the FIFO draw touched). Same COALESCE(invoiceId, id) group
      // key as findAllGrouped() above.
      this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM (
          SELECT COALESCE("invoiceId", "id") AS key FROM "stock_exits" WHERE "clientId" = ${clientId} GROUP BY key
        ) t
      `),
      this.prisma.stockExit.aggregate({
        where: { clientId, lotId: { not: null } },
        _sum: { kgQuantity: true },
      }),
      this.prisma.stockExit.groupBy({
        by: ['bagTypeId'],
        where: { clientId, bagTypeId: { not: null }, quantity: { not: null } },
        _sum: { quantity: true },
      }),
      this.prisma.stockExit.groupBy({
        by: ['currency'],
        where: { clientId, amount: { not: null } },
        _sum: { amount: true },
      }),
      // Minimal-field, single-client-bounded fetch — only the rows that
      // genuinely need line-level invoice resolution (see doc comment above).
      this.prisma.stockExit.findMany({
        where: { clientId, amount: null, invoiceId: { not: null } },
        select: {
          quantity: true,
          kgQuantity: true,
          lotId: true,
          bagTypeId: true,
          lot: { select: { charcoalType: true, grade: true } },
          invoice: { select: { lines: true, currency: true } },
        },
      }),
    ]);

    // ── kg: raw-lot SUM(kgQuantity) + packed Σ(quantity × bagType.nominalKg) ──
    const bagTypeIds = byBagType.map((g) => g.bagTypeId).filter(Boolean) as string[];
    const bagTypes = bagTypeIds.length
      ? await this.prisma.bagType.findMany({
          where: { id: { in: bagTypeIds } },
          select: { id: true, nominalKg: true },
        })
      : [];
    const nominalKgById = new Map(bagTypes.map((bt) => [bt.id, bt.nominalKg]));
    const packedKg = byBagType.reduce((sum, g) => {
      const qty = g._sum.quantity ?? 0;
      const nomKg = g.bagTypeId ? (nominalKgById.get(g.bagTypeId) ?? new Decimal(0)) : new Decimal(0);
      return sum.plus(new Decimal(nomKg.toString()).mul(qty));
    }, new Decimal(0));
    const totalKg = packedKg.plus(new Decimal(rawKgSum._sum.kgQuantity?.toString() ?? '0'));

    // ── amount: DB-summed explicit amounts (currency-converted) ──
    const explicitAmount = explicitAmountByCurrency.reduce((sum, g) => {
      const amt = new Decimal(g._sum.amount?.toString() ?? '0');
      return sum.plus(toUsd(amt, g.currency));
    }, new Decimal(0));

    // ── ... plus per-invoice-line resolution for amount=NULL, invoice-linked
    // rows — exact same matching rule as WarehouseSales.tsx's
    // exitDisplayAmountUsd(), ported (not reinvented).
    const unresolvedAmount = unresolvedExits.reduce((sum, exit) => {
      const lines: any[] = (exit.invoice?.lines as any[]) ?? [];
      const line = exit.lotId
        ? (lines.find((l) => l.saleUnit === 'KG' && exit.lot && l.description === `${exit.lot.charcoalType} Grade ${exit.lot.grade}`)
          ?? lines.find((l) => l.saleUnit === 'KG'))
        : lines.find((l) => l.bagTypeId === exit.bagTypeId);
      if (!line) return sum;
      const qty = exit.lotId ? new Decimal(toNum(exit.kgQuantity)) : new Decimal(exit.quantity ?? 0);
      const unitPrice = new Decimal(toNum(exit.lotId ? line.pricePerKg : line.pricePerBag));
      const amt = qty.mul(unitPrice);
      return sum.plus(toUsd(amt, exit.invoice?.currency ?? 'USD'));
    }, new Decimal(0));

    const totalAmount = explicitAmount.plus(unresolvedAmount);

    return {
      totalCount: Number(totalCountRows[0]?.count ?? 0),
      totalKg: totalKg.toFixed(3),
      totalAmount: totalAmount.toFixed(2),
    };
  }

  /**
   * Update mutable fields on an existing exit (amount, recipient).
   * Identity and audit fields (loggedById, exitType, date) are immutable after creation.
   */
  async updateExit(id: string, dto: UpdateStockExitDto) {
    const exit = await this.prisma.stockExit.findUnique({ where: { id } });
    if (!exit) throw new NotFoundException({ error: 'Exit not found', code: 'NOT_FOUND' });
    // This exit's price already lives on its invoice line — setting `amount`
    // here too would double-count its revenue in the P&L walk-in aggregate
    // (which sums StockExit.amount for exitType='walk_in' rows).
    if (dto.amount != null && exit.invoiceId) {
      throw new BadRequestException({
        error: 'This sale is already invoiced — its amount is set by the invoice, not the exit',
        code: 'CONSTRAINT_VIOLATION',
      });
    }
    return this.prisma.stockExit.update({
      where: { id },
      data: {
        ...(dto.amount != null ? { amount: dto.amount.toFixed(2) } : {}),
        ...(dto.recipient !== undefined ? { recipient: dto.recipient } : {}),
      },
      include: { bagType: true, lot: true, loggedBy: { select: { id: true, name: true } } },
    });
  }

  /**
   * Create a stock exit and decrement the corresponding packed stock.
   *
   * Step 1: Resolve internal User from clerkId (loggedById source — CONSTRAINT 5)
   * Step 2: Validate PackedStock exists
   * Step 3: CONSTRAINT 2 — reject if packedStock.quantity - dto.quantity < 0
   * Step 4: Decrement packed stock quantity
   * Step 5: Create StockExit with loggedById = user.id (never from DTO)
   *
   * ── Idempotency (forensic audit, 2026-08-28) ─────────────────────────────────
   * This endpoint is what anonymous walk-in sales actually use (WalkInSalesService
   * / POST /walk-in-sales only ever handles REGISTERED clients — see that
   * method's own doc comment). A double-click, a slow-network retry, or two
   * near-simultaneous identical anonymous-sale requests must not create two
   * independent financial effects — confirmed live against the real dev DB:
   * two concurrent identical requests each independently succeeded (2 stock
   * deductions, 2 stock-exit rows, 2 collector ledger credits). The frontend's
   * disabled-while-pending button (WarehouseSales.tsx) is UX protection only.
   * This method is the actual guarantee, mirroring
   * WalkInSalesService.create()'s idempotencyKey/requestFingerprint pattern
   * exactly (see computeStockExitFingerprint() above):
   *   1. Application-level guard: if a stock exit with this idempotencyKey
   *      already exists, compare its stored requestFingerprint — MATCH
   *      returns the existing exit (no new work); MISMATCH rejects with 409
   *      IDEMPOTENCY_KEY_REUSED and zero side effects.
   *   2. DB-level backstop (`stock_exits_idempotencyKey_key`, a plain unique
   *      index — StockExit has no cancel/void state, so unlike Invoice's
   *      partial index, a plain one is correct here): if two requests both
   *      pass check (1) at the same instant, only one INSERT wins; the
   *      loser's P2002 is caught below and re-runs the same match/mismatch
   *      comparison against the winner.
   * `idempotencyKey` is optional (backward-compatible DTO addition) — every
   * non-sale exit type (sample/internal/gift/fill-job pickup) and any caller
   * that omits it gets no idempotency protection, exactly as before this fix.
   * Two genuinely different exits (no key, or two different keys) are NEVER
   * deduplicated.
   *
   * @param dto    - Exit creation data; must not include loggedById
   * @param userId - Clerk user ID from @CurrentUser — sole source of loggedById
   * @param role   - Caller's role from @CurrentUser — workers are restricted to
   *                 non-sale exitTypes (SPEC.md §3.4); see WORKER_ALLOWED_EXIT_TYPES.
   * @constraint 2 packedStock.quantity - dto.quantity < 0 → 400 CONSTRAINT_VIOLATION; transaction rolled back
   * @constraint 5 loggedById is always user.id resolved from the JWT, never from the request body
   */
  async create(dto: CreateStockExitDto, userId: string, role?: string) {
    if (role === 'worker' && !WORKER_ALLOWED_EXIT_TYPES.includes(dto.exitType)) {
      throw new ForbiddenException({
        error: 'Workers may only log non-sale exits (sample, internal, gift)',
        code: 'FORBIDDEN',
      });
    }

    const fingerprint = dto.idempotencyKey ? computeStockExitFingerprint(dto) : undefined;
    if (dto.idempotencyKey) {
      const existing = await this.prisma.stockExit.findFirst({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) {
          throw new ConflictException({
            message: 'This idempotency key was already used for a different exit request',
            error: 'This idempotency key was already used for a different exit request',
            code: 'IDEMPOTENCY_KEY_REUSED',
          });
        }
        return existing;
      }
    }

    // Resolve caller before opening a transaction — this read is safe outside
    // the tx because the user record is not mutated during the operation.
    const user = await this.prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });

    // Resolve collector name outside tx (display-only, not a constraint)
    let collectorFields: { collectedById?: string; collectedBy?: string } = {};
    if (dto.collectedById) {
      // PR 6b: validate before any FK-constrained write (StockExit.collectedById) is
      // attempted, so an invalid collector fails with a clean NotFoundException instead
      // of a raw DB foreign-key-violation error. LedgerWriteService.creditAccount()'s own
      // validation (PR 6) is unchanged and still runs later — this is additional, not a
      // replacement.
      await this.usersService.validateCashCapable(dto.collectedById);
      const collector = await this.prisma.user.findUnique({ where: { id: dto.collectedById }, select: { name: true } });
      collectorFields = { collectedById: dto.collectedById, collectedBy: collector?.name };
    } else if (dto.collectedBy) {
      collectorFields = { collectedBy: dto.collectedBy };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
      // Warning: walk_in exits with amount != null count in P&L walk-in revenue.
      // Only create these for anonymous (no-invoice) sales. Invoice-linked walk-ins
      // use WalkInSalesService with amount=null.
      const commonData = {
        exitType: dto.exitType,
        date: new Date(dto.date),
        loggedById: user.id,
        ...(dto.reason ? { reason: dto.reason } : {}),
        ...(dto.recipient ? { recipient: dto.recipient } : {}),
        ...(dto.orderId ? { orderId: dto.orderId } : {}),
        ...(dto.clientId ? { clientId: dto.clientId } : {}),
        ...(dto.amount != null ? { amount: dto.amount.toFixed(2) } : {}),
        // BUG-K (P5): capture the amount's currency so P&L can convert LBP cash sales.
        // Defaults USD (column default) when omitted; only meaningful when amount != null.
        ...(dto.currency ? { currency: dto.currency } : {}),
        ...(dto.idempotencyKey ? { idempotencyKey: dto.idempotencyKey, requestFingerprint: fingerprint } : {}),
        ...collectorFields,
      };

      // ── MODE A: Raw lot (by-kg sale) ──────────────────────────────────────
      let exit: any;
      if (dto.lotId && dto.kgQuantity) {
        // Lock the lot row before reading kgRemaining — mirrors the FOR UPDATE
        // pattern in payments.service.ts / payment-allocation.service.ts. Two
        // concurrent exits against the same lot now serialize on this lock:
        // the second transaction only reads kgRemaining after the first has
        // committed (or rolled back), so it validates against the true
        // post-deduction value instead of a stale pre-deduction one.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "stock_lots" WHERE id = ${dto.lotId} FOR UPDATE`);
        const lot = await tx.stockLot.findUnique({ where: { id: dto.lotId } });
        if (!lot) throw new NotFoundException({ error: 'Stock lot not found', code: 'NOT_FOUND' });

        const available = parseFloat(lot.kgRemaining.toString());
        if (dto.kgQuantity > available) {
          throw new BadRequestException({
            error: `Insufficient raw stock — available: ${available} kg, requested: ${dto.kgQuantity} kg`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
        await tx.stockLot.update({
          where: { id: dto.lotId },
          data: { kgRemaining: (available - dto.kgQuantity).toFixed(3) },
        });
        exit = await tx.stockExit.create({
          data: { ...commonData, lotId: dto.lotId, kgQuantity: dto.kgQuantity.toFixed(3) },
          include: { lot: true, loggedBy: { select: { id: true, name: true } } },
        });
      }
      // ── MODE C: Fill-client pickup ─────────────────────────────────────────
      else if (dto.exitType === 'client_bags_fill' && !dto.packedStockId) {
        exit = await tx.stockExit.create({
          data: { ...commonData },
          include: { loggedBy: { select: { id: true, name: true } } },
        });
      }
      // ── MODE B: Packed bags ───────────────────────────────────────────────
      else {
        if (!dto.packedStockId || !dto.quantity) {
          throw new BadRequestException({
            error: 'Either (packedStockId + quantity) or (lotId + kgQuantity) is required',
            code: 'VALIDATION_ERROR',
          });
        }
        // Lock the packed-stock row before reading quantity/reservedQuantity —
        // same FOR UPDATE pattern as the raw-lot path above. Two concurrent
        // exits against the same packed-stock row serialize on this lock, so
        // the second transaction's freeQuantity check always reflects the
        // first transaction's committed decrement.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "packed_stocks" WHERE id = ${dto.packedStockId} FOR UPDATE`);
        const packedStock = await tx.packedStock.findUnique({ where: { id: dto.packedStockId } });
        if (!packedStock) throw new NotFoundException({ error: 'Packed stock not found', code: 'NOT_FOUND' });
        // BUG-E (P2): consumers must draw against FREE quantity (quantity − reservedQuantity),
        // never raw quantity — bags reserved for a pending shipment are not available to a sale/exit.
        const freeQuantity = packedStock.quantity - packedStock.reservedQuantity;
        if (freeQuantity - dto.quantity < 0) {
          throw new BadRequestException({
            error: `Insufficient packed stock — available: ${freeQuantity}, requested: ${dto.quantity}`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
        await tx.packedStock.update({
          where: { id: dto.packedStockId },
          data: { quantity: { decrement: dto.quantity } },
        });
        exit = await tx.stockExit.create({
          data: { ...commonData, packedStockId: dto.packedStockId, bagTypeId: dto.bagTypeId, quantity: dto.quantity },
          include: {
            bagType: true,
            loggedBy: { select: { id: true, name: true } },
            packedStock: { include: { lot: { select: { id: true, charcoalType: true, grade: true, kgReceived: true } } } },
          },
        });
      }

      // Credit the collector's account when a collector is assigned and an amount was recorded
      if (collectorFields.collectedById && dto.amount != null && dto.amount > 0) {
        await this.ledgerWriteService.creditAccount(
          tx, collectorFields.collectedById,
          new Decimal(dto.amount),
          'sale_collected',
          exit.id,
          `Warehouse sale${dto.recipient ? ' — ' + dto.recipient : ''}`,
          new Date(dto.date),
        );
      }

      return exit;
      });
    } catch (e) {
      // Expected race (see this method's doc comment): two near-simultaneous
      // requests carrying the SAME idempotencyKey can both pass the
      // application-level check above — only one tx.stockExit.create() wins,
      // the other hits stock_exits_idempotencyKey_key (P2002). Return the
      // winner's exit instead of surfacing a raw constraint violation; if no
      // matching exit actually exists, this wasn't that race — rethrow
      // (mirrors WalkInSalesService.create()'s identical P2002-recovery).
      if (dto.idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const winner = await this.prisma.stockExit.findFirst({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (winner) {
          if (winner.requestFingerprint !== fingerprint) {
            throw new ConflictException({
              message: 'This idempotency key was already used for a different exit request',
              error: 'This idempotency key was already used for a different exit request',
              code: 'IDEMPOTENCY_KEY_REUSED',
            });
          }
          return winner;
        }
      }
      throw e;
    }
  }
}
