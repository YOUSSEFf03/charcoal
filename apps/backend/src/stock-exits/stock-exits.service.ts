import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExitType, Prisma } from '@prisma/client';
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

    const [totalCount, rawKgSum, byBagType, explicitAmountByCurrency, unresolvedExits] = await Promise.all([
      this.prisma.stockExit.count({ where: { clientId } }),
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
      totalCount,
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

    return this.prisma.$transaction(async (tx) => {
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
  }
}
