import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SubmitPhysicalCountDto } from './dto/physical-count.dto';
import { buildGeneralExpenseWhere } from '../general-expenses/general-expenses.service';
import { ClientBalanceService } from '../clients/client-balance.service';
import { StockExitsService } from '../stock-exits/stock-exits.service';

interface DateRangeFilter {
  /**
   * UTC midnight of `from` / `to` — correct as-is for @db.Date columns
   * (stock_exits.date, bag_purchases.date, packing_sessions.date,
   * payments.date, supplier_payments.date, stock_lots.dateReceived): a SQL
   * DATE has no time-of-day, so comparing it against UTC midnight of `to`
   * with `<=` already includes the whole day — Postgres has nothing to
   * truncate away. Do not use these two fields for a genuine DateTime column
   * (issuedAt, completedAt, arrivalDate, createdAt) — use businessGte/businessLt below.
   */
  gte?: Date;
  lte?: Date;
  /**
   * Asia/Beirut calendar-day boundaries, for genuine DateTime columns where
   * `gte`/`lte` above would silently exclude same-day records that occurred
   * after local midnight — new Date("2026-08-08") is UTC midnight, so the
   * plain `lte` cuts a same-day range off at the very start of the end date,
   * not the end of it. businessLt is deliberately an EXCLUSIVE upper bound
   * (the instant the day after `to` begins, Beirut-local) rather than an
   * inclusive 23:59:59.999 — avoids millisecond-precision edge cases and
   * mirrors how `<` against a DATE column already behaves. Pair with `>=` /
   * `<` (not `<=`) at every call site.
   */
  businessGte?: Date;
  businessLt?: Date;
}

/**
 * Business/reporting timezone for dateFrom/dateTo calendar-day filters.
 * Deliberately Asia/Beirut — not server timezone (this backend has none
 * configured; date-only strings parse as UTC by JS spec regardless of
 * server locale) and not browser timezone (the frontend's `<input
 * type="date">` sends a bare "YYYY-MM-DD" with no offset attached, so the
 * backend has no way to recover a browser's zone even if it wanted to).
 * Fixed, not user-configurable, by explicit decision — see the report
 * date-filter audit this fix implements.
 */
const BUSINESS_TIMEZONE = 'Asia/Beirut';

/**
 * Returns the UTC instant of 00:00:00.000 on `dateOnlyStr` ("YYYY-MM-DD",
 * carrying no timezone of its own) in `timeZone`.
 *
 * Standard single-pass technique, correct across DST transitions: format a
 * naive UTC-midnight guess for that calendar date AS SEEN IN the target
 * zone, read back what wall-clock moment that guess actually lands on
 * there, and shift the guess by exactly that discrepancy. `Intl.DateTimeFormat`
 * resolves `timeZone` against the IANA tzdata bundled with Node's full ICU
 * (built in since Node 13 — no extra package), so this never hardcodes a
 * fixed UTC offset and stays correct if Beirut's DST rules ever change.
 */
function zonedMidnightUtc(dateOnlyStr: string, timeZone: string): Date {
  const [year, month, day] = dateOnlyStr.split('-').map(Number);
  const guessMs = Date.UTC(year, month - 1, day);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(guessMs).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});

  const observedAsUtcMs = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );

  return new Date(guessMs - (observedAsUtcMs - guessMs));
}

/** `dateOnlyStr` ("YYYY-MM-DD") shifted forward by exactly one calendar day, same format. */
function nextDateOnlyString(dateOnlyStr: string): string {
  const [year, month, day] = dateOnlyStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** `dateOnlyStr` ("YYYY-MM-DD") shifted backward by exactly one calendar day, same format. */
function previousDateOnlyString(dateOnlyStr: string): string {
  const [year, month, day] = dateOnlyStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * Validates an OPTIONAL "YYYY-MM-DD" query param — same format/calendar
 * check getDailyReport() already applies to its own (required) `date` path
 * param, generalized for a param that may legitimately be absent.
 *
 * Root-cause fix (2026-09 "Invalid time value" audit): getDailyRevenue()
 * used `filters.dateFrom ?? beirutDay(...)` to decide its loop's start/end
 * day. `??` only falls back on null/undefined — an EMPTY STRING (a cleared
 * `<input type="date">` sent as `dateFrom=` rather than omitted entirely,
 * or any other caller sending `''`) is neither, so it was used LITERALLY as
 * the loop's starting date string. The very first iteration then called
 * nextDateOnlyString('') → `''.split('-').map(Number)` → `[0]` → destructures
 * to `{year: 0, month: undefined, day: undefined}` → `Date.UTC(0, NaN, NaN)`
 * is `NaN` → `new Date(NaN).toISOString()` throws exactly
 * `RangeError: Invalid time value` — matching the reported stack trace at
 * getDailyRevenue()'s loop, not this file's date-range-filter helpers.
 *
 * This function closes that gap at the boundary: an empty string is
 * normalized to "not provided" (preserving this endpoint's existing
 * contract — omitted dateFrom/dateTo falls back to the default lookback
 * window), while a non-empty value that is malformed OR names a calendar
 * date that doesn't exist (e.g. "2026-02-31") is rejected with the SAME
 * client-error shape getDailyReport() already uses — never silently
 * defaulted to today, never allowed to reach Date.prototype.toISOString()
 * in an invalid state.
 */
function validateOptionalDateOnly(value: string | undefined, paramName: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  // Format check first — same shape getDailyReport() already requires.
  // Calendar-validity check second: unlike getDailyReport()'s plain
  // `new Date(str).getTime()` check, V8's Date STRING parser silently rolls
  // an out-of-range day/month over into the next month/year instead of
  // producing Invalid Date (verified: `new Date('2026-02-31').getTime()` is
  // a valid number — March 3, 2026 — not NaN). Round-tripping through
  // Date.UTC's numeric constructor (the SAME technique nextDateOnlyString/
  // previousDateOnlyString above already use for date-only arithmetic) and
  // comparing the read-back Y/M/D against the input catches that silent
  // rollover, so "2026-02-31" is correctly rejected rather than silently
  // reinterpreted as March 3.
  if (match) {
    const [, y, m, d] = match;
    const year = Number(y), month = Number(m), day = Number(d);
    const asUtc = new Date(Date.UTC(year, month - 1, day));
    if (asUtc.getUTCFullYear() === year && asUtc.getUTCMonth() === month - 1 && asUtc.getUTCDate() === day) {
      return value;
    }
  }
  throw new BadRequestException({ error: `${paramName} must be a valid YYYY-MM-DD string`, code: 'VALIDATION_ERROR' });
}

/** How far back to look when neither dateFrom nor dateTo is supplied. */
export const DEFAULT_LOOKBACK_DAYS = 90;

export function buildDateFilter(from?: string, to?: string): DateRangeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(from), businessGte: zonedMidnightUtc(from, BUSINESS_TIMEZONE) } : {}),
    ...(to   ? { lte: new Date(to),   businessLt:  zonedMidnightUtc(nextDateOnlyString(to), BUSINESS_TIMEZONE) } : {}),
  };
}

/**
 * Like buildDateFilter but always returns a filter — defaults to the last
 * DEFAULT_LOOKBACK_DAYS days when neither bound is supplied.  Prevents
 * unfiltered calls from scanning the full table history.
 */
export function buildDateFilterWithDefault(from?: string, to?: string): DateRangeFilter {
  if (from || to) return buildDateFilter(from, to) ?? {};
  const gte = new Date();
  gte.setDate(gte.getDate() - DEFAULT_LOOKBACK_DAYS);
  // No dateFrom/dateTo strings were given, so there's nothing to convert —
  // `gte` is already an exact instant (now − N days), unambiguous regardless
  // of timezone, so it doubles as businessGte too. No upper bound either way.
  return { gte, businessGte: gte };
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly clientBalanceService: ClientBalanceService,
    private readonly stockExitsService: StockExitsService,
  ) {}

  /**
   * P&L report — CONSTRAINT 11: restricted to owner role.
   *
   * Revenue basis: ACCRUAL — sums inv."total" (the full invoice amount, not paidAmount)
   *   for 'issued', 'partially_paid', and 'paid' invoices. Revenue is recognized when the
   *   sale is invoiced, not when cash is collected. 'draft' and 'cancelled' are excluded
   *   (void/uncommitted charges — same exclusion ClientBalanceService already uses).
   * COGS basis: EXIT-ACCRUAL — sums cost at time of stock exit (kgQuantity × costPerKg).
   *   Now on the same accrual timeline as revenue, so a sale's cost and revenue land in the
   *   same period instead of revenue lagging behind to whenever payment happens to arrive.
   * Currency: all components converted to USD using the single rate from SettingsService (resolved once).
   *
   * Cash flow is tracked separately via `cashCollected` (SUM of payment.amount actually
   * received in the range) — it does NOT feed into gross_profit. Use it alongside revenue
   * to see the profitability/cash-flow split explicitly instead of one number conflating both.
   *
   * All components are computed server-side (no in-memory row folds):
   *   revenue         = SQL SUM(invoice.total converted to USD)                  (invoices, accrual basis)
   *                 + aggregate SUM(amount)                                      (walk-in exits, unchanged)
   *   cogs            = raw SQL NUMERIC SUM with LEFT JOINs                      (exit-accrual basis)
   *   bag_cost        = aggregate SUM(totalCost)
   *   variance_cost   = LATERAL SQL weighted-avg per session (varianceKg > 0 only)
   *   delivery_cost   = aggregate SUM(fuelCost)
   *                 + SQL jsonb_array_elements SUM(otherExpenses[].amount)
   *   gross_profit    = revenue − cogs − bag_cost − variance_cost − delivery_cost   (UNCHANGED — never redefined)
   *   cash_collected  = SQL SUM(payment.amount converted to USD) — reported, not subtracted
   *
   * container expenses are NOT double-counted — they are already inside lot.costPerKg
   *
   * ── Net Profit (additive second tier — approved P&L architecture) ──────────────
   *   labor_cost       = aggregate SUM(PackingSession.sessionEarnings) + SUM(WorkerCost.amount),
   *                      both bounded by their own @db.Date `date` column over the SAME
   *                      resolved range as every other @db.Date-keyed component here
   *                      (dateFilter.gte/lte — same fields bagCost/varianceCost already use).
   *                      Accrual only — WorkerPayment is a cash SETTLEMENT of already-accrued
   *                      labor, never added as a second expense (would double-count).
   *   general_expense  = aggregate SUM(GeneralExpense.amount) using buildGeneralExpenseWhere()
   *                      — the SAME "Option B" recurrence helper the Expenses page's
   *                      GeneralExpensesService.findAll() uses, so there is exactly one
   *                      recurrence implementation, never a second divergent one.
   *   handover_expense = aggregate SUM(CashHandoverExpense.amount), filtered by the PARENT
   *                      CashHandover.date (CashHandoverExpense has no date column of its own).
   *   net_profit       = gross_profit − labor_cost − general_expense − handover_expense
   *
   *   Deliberately NOT added here (already inside gross_profit or not a P&L expense at all —
   *   see the Net Profit architecture audit): ContainerExpense (already folded into
   *   StockLot.costPerKg → cogs), BagPurchase (already bag_cost), driver fuel/otherExpenses
   *   (already delivery_cost), SupplierPayment (settles accounts payable, not an expense),
   *   WorkerPayment (settles accrued labor, not a second expense), cashCollected (cash-flow
   *   figure, never subtracted from profit).
   *
   * All twelve queries run in parallel via Promise.all.
   */
  async getProfitLoss(filters: {
    dateFrom?: string;
    dateTo?: string;
    clientId?: string;
  }) {
    const dateFilter = buildDateFilterWithDefault(filters.dateFrom, filters.dateTo);

    // Resolve exchange rate ONCE — all currency conversions within this call use the same rate.
    // Rate is LBP per 1 USD (e.g. 89550 means 1 USD = 89,550 LBP).
    const rate = new Decimal(await this.settingsService.getExchangeRate());

    // Net Profit's three new components are all @db.Date-keyed (PackingSession.date,
    // WorkerCost.date, GeneralExpense.date, CashHandover.date) — same category as
    // bagCost/varianceCost/cashCollected above, so they use the same plain
    // dateFilter.gte/lte (NOT businessGte/businessLt, which is only for genuine
    // DateTime columns like issuedAt/completedAt).
    const laborPeriodWhere = {
      ...(dateFilter.gte ? { gte: dateFilter.gte } : {}),
      ...(dateFilter.lte ? { lte: dateFilter.lte } : {}),
    };

    const [
      invoiceRevenueResult,
      walkInResult,
      cogsResult,
      bagCostResult,
      varianceCostResult,
      fuelResult,
      otherExpensesResult,
      cashCollectedResult,
      sessionEarningsAgg,
      workerCostAgg,
      generalExpenseAgg,
      handoverExpenseAgg,
    ] = await Promise.all([

      // ── invoice revenue — accrual basis: sum invoice total (not paidAmount) ──
      // 'issued', 'partially_paid', and 'paid' all contribute their FULL total — revenue is
      // recognized at issuance, not at collection. 'draft' (not yet issued) and 'cancelled'
      // (void) are excluded — same set ClientBalanceService.computeBalance() already uses.
      // BUG-J (P5): each LBP invoice is divided by its OWN issue-time rate snapshot
      // (inv."exchangeRateSnapshot"), so historical revenue does not move when the global
      // rate changes. The global `rate` is used only as a defensive fallback for any legacy
      // issued row whose snapshot is somehow null (the backfill stamped all issued rows).
      // USD invoices pass through unchanged.
      this.prisma.$queryRaw<[{ invoice_revenue: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(
          CASE WHEN inv."currency" = 'LBP'
               THEN inv."total"::numeric
                    / NULLIF(COALESCE(inv."exchangeRateSnapshot", ${rate}::numeric), 0)
               ELSE inv."total"::numeric
          END
        ), 0::numeric)::text AS invoice_revenue
        FROM "invoices" inv
        WHERE inv."status" IN ('issued', 'partially_paid', 'paid')
        ${dateFilter.businessGte ? Prisma.sql`AND inv."issuedAt" >= ${dateFilter.businessGte}` : Prisma.empty}
        ${dateFilter.businessLt  ? Prisma.sql`AND inv."issuedAt" <  ${dateFilter.businessLt}`  : Prisma.empty}
        ${filters.clientId ? Prisma.sql`AND inv."clientId" = ${filters.clientId}` : Prisma.empty}
      `),

      // ── walk-in revenue — raw SQL with per-row currency conversion (BUG-K) ───
      // Only non-null amounts counted — walk-in exits linked to invoices are always null
      // (see WalkInSalesService). BUG-K (P5): each exit now carries a `currency`; LBP
      // amounts are divided by the global rate, USD pass through. Legacy rows backfilled USD.
      this.prisma.$queryRaw<[{ walk_in_revenue: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(
          CASE WHEN se."currency" = 'LBP'
               THEN se."amount"::numeric / NULLIF(${rate}::numeric, 0)
               ELSE se."amount"::numeric
          END
        ), 0::numeric)::text AS walk_in_revenue
        FROM "stock_exits" se
        WHERE se."exitType" = 'walk_in'
          AND se."amount" IS NOT NULL
        ${dateFilter.gte ? Prisma.sql`AND se."date" >= ${dateFilter.gte}` : Prisma.empty}
        ${dateFilter.lte ? Prisma.sql`AND se."date" <= ${dateFilter.lte}` : Prisma.empty}
        ${filters.clientId ? Prisma.sql`AND se."clientId" = ${filters.clientId}` : Prisma.empty}
      `),

      // ── COGS — raw SQL SUM (NUMERIC precision, no JS float math) ────────────
      // costPerKg is derived from container import pricing (ContainerProductLine.pricePerTon).
      // Neither StockLot nor Container has a currency column; costPerKg is assumed USD
      // (all import purchases are priced in USD). A currency column on stock_lots/containers
      // would make this explicit (tracked in ISSUES.md).
      this.prisma.$queryRaw<[{ cogs: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(
          CASE
            WHEN se."lotId" IS NOT NULL AND se."kgQuantity" IS NOT NULL
              THEN se."kgQuantity" * l."costPerKg"
            WHEN se."packedStockId" IS NOT NULL AND se."quantity" IS NOT NULL
                 AND bt."nominalKg" IS NOT NULL AND ps_lot."costPerKg" IS NOT NULL
              THEN se."quantity"::numeric * bt."nominalKg" * ps_lot."costPerKg"
            ELSE 0::numeric
          END
        ), 0::numeric)::text AS cogs
        FROM "stock_exits" se
        LEFT JOIN "packed_stocks" ps     ON se."packedStockId" = ps."id"
        LEFT JOIN "stock_lots"  ps_lot  ON ps."lotId"          = ps_lot."id"
        LEFT JOIN "bag_types"   bt      ON se."bagTypeId"       = bt."id"
        LEFT JOIN "stock_lots"  l       ON se."lotId"           = l."id"
        WHERE se."exitType" IN ('order', 'walk_in')
        ${dateFilter.gte ? Prisma.sql`AND se."date" >= ${dateFilter.gte}` : Prisma.empty}
        ${dateFilter.lte ? Prisma.sql`AND se."date" <= ${dateFilter.lte}` : Prisma.empty}
      `),

      // ── bag_cost — raw SQL with per-row currency conversion (BUG-L) ──────────
      // BUG-L (P5): each bag purchase carries a `currency`; LBP totals are divided by the
      // global rate, USD pass through. Legacy rows backfilled USD.
      this.prisma.$queryRaw<[{ bag_cost: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(
          CASE WHEN bp."currency" = 'LBP'
               THEN bp."totalCost"::numeric / NULLIF(${rate}::numeric, 0)
               ELSE bp."totalCost"::numeric
          END
        ), 0::numeric)::text AS bag_cost
        FROM "bag_purchases" bp
        WHERE 1=1
        ${dateFilter.gte ? Prisma.sql`AND bp."date" >= ${dateFilter.gte}` : Prisma.empty}
        ${dateFilter.lte ? Prisma.sql`AND bp."date" <= ${dateFilter.lte}` : Prisma.empty}
      `),

      // ── variance_cost — LATERAL SQL weighted avg per session (no row fetch) ──
      // varianceKg > 0 = real packing loss (dust, breakage); negatives excluded.
      // costPerKg assumed USD — same basis as COGS above (tracked in ISSUES.md).
      this.prisma.$queryRaw<[{ variance_cost: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(
          ps."varianceKg" *
          CASE WHEN COALESCE(tot.kg, 0::numeric) > 0
            THEN COALESCE(wc.cost, 0::numeric) / tot.kg
            ELSE 0::numeric
          END
        ), 0::numeric)::text AS variance_cost
        FROM "packing_sessions" ps
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(sl."kgUsed"), 0::numeric) AS kg
          FROM "packing_session_lots" sl
          WHERE sl."sessionId" = ps."id"
        ) tot
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(sl."kgUsed" * l."costPerKg"), 0::numeric) AS cost
          FROM "packing_session_lots" sl
          JOIN "stock_lots" l ON l."id" = sl."lotId"
          WHERE sl."sessionId" = ps."id"
        ) wc
        WHERE ps."varianceKg" > 0
        ${dateFilter.gte ? Prisma.sql`AND ps."date" >= ${dateFilter.gte}` : Prisma.empty}
        ${dateFilter.lte ? Prisma.sql`AND ps."date" <= ${dateFilter.lte}` : Prisma.empty}
      `),

      // ── delivery: fuelCost — raw SQL with per-row currency conversion (BUG-M) ─
      // BUG-M (P5): fuelCost now carries `fuelCurrency`; LBP fuel is divided by the global
      // rate, USD pass through. Legacy rows backfilled USD.
      this.prisma.$queryRaw<[{ fuel_cost: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(
          CASE WHEN dt."fuelCurrency" = 'LBP'
               THEN COALESCE(dt."fuelCost", 0)::numeric / NULLIF(${rate}::numeric, 0)
               ELSE COALESCE(dt."fuelCost", 0)::numeric
          END
        ), 0::numeric)::text AS fuel_cost
        FROM "driver_trips" dt
        WHERE dt."status" = 'completed'
        ${dateFilter.businessGte ? Prisma.sql`AND dt."completedAt" >= ${dateFilter.businessGte}` : Prisma.empty}
        ${dateFilter.businessLt  ? Prisma.sql`AND dt."completedAt" <  ${dateFilter.businessLt}`  : Prisma.empty}
      `),

      // ── delivery: otherExpenses — LATERAL SQL with per-item currency (BUG-M) ─
      // BUG-M (P5): each JSONB element now carries a `currency`; LBP items are divided by
      // the global rate, USD (or missing → treated USD) pass through. Backfilled to USD.
      this.prisma.$queryRaw<[{ other_expenses: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(
          CASE WHEN (exp->>'currency') = 'LBP'
               THEN (exp->>'amount')::numeric / NULLIF(${rate}::numeric, 0)
               ELSE (exp->>'amount')::numeric
          END
        ), 0::numeric)::text AS other_expenses
        FROM "driver_trips" dt
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(dt."otherExpenses", '[]'::jsonb)) AS exp
        WHERE dt."status" = 'completed'
        ${dateFilter.businessGte ? Prisma.sql`AND dt."completedAt" >= ${dateFilter.businessGte}` : Prisma.empty}
        ${dateFilter.businessLt  ? Prisma.sql`AND dt."completedAt" <  ${dateFilter.businessLt}`  : Prisma.empty}
      `),

      // ── cash collected — actual money received in range, reported separately from ──
      // revenue (Phase 3). Sums payment.amount, converted per-row by the payment's own
      // currency using the same global-rate CASE pattern as walk-in/bag-cost/fuel above.
      // Not part of grossProfit — this is a cash-flow figure, not a profitability one.
      this.prisma.$queryRaw<[{ cash_collected: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(
          CASE WHEN p."currency" = 'LBP'
               THEN p."amount"::numeric / NULLIF(${rate}::numeric, 0)
               ELSE p."amount"::numeric
          END
        ), 0::numeric)::text AS cash_collected
        FROM "payments" p
        WHERE 1=1
        ${dateFilter.gte ? Prisma.sql`AND p."date" >= ${dateFilter.gte}` : Prisma.empty}
        ${dateFilter.lte ? Prisma.sql`AND p."date" <= ${dateFilter.lte}` : Prisma.empty}
        ${filters.clientId ? Prisma.sql`AND p."clientId" = ${filters.clientId}` : Prisma.empty}
      `),

      // ── labor: session earnings — accrual, dated by PackingSession.date ─────
      // Source of truth for piece-rate earnings (see workers.service.ts computeTotals()
      // — the same field, same "accrual not payment" principle, reused here for P&L).
      this.prisma.packingSession.aggregate({
        where: { date: laborPeriodWhere },
        _sum: { sessionEarnings: true },
      }),

      // ── labor: WorkerCost — accrual, dated by its OWN `date` column (independent
      // of any PackingSession — daily_wage/bonus/fuel/food/transport/advance/etc,
      // never double-counted against sessionEarnings; the two are separate tables
      // summed independently, exactly as computeTotals() already does). ─────────
      this.prisma.workerCost.aggregate({
        where: { date: laborPeriodWhere },
        _sum: { amount: true },
      }),

      // ── general expenses — "Option B" recurrence, same helper the Expenses
      // page's GeneralExpensesService.findAll() uses (see buildGeneralExpenseWhere).
      this.prisma.generalExpense.aggregate({
        where: buildGeneralExpenseWhere(dateFilter),
        _sum: { amount: true },
      }),

      // ── cash-handover expenses — filtered via the PARENT CashHandover.date;
      // CashHandoverExpense itself has no date column (see schema comment).
      this.prisma.cashHandoverExpense.aggregate({
        where: { cashHandover: { date: laborPeriodWhere } },
        _sum: { amount: true },
      }),
    ]);

    const invoiceRevenue = new Decimal(invoiceRevenueResult[0]?.invoice_revenue ?? '0');
    // BUG-K (P5): walk-in exit amounts are converted per-row by their stored currency.
    const walkInRevenue  = new Decimal(walkInResult[0]?.walk_in_revenue ?? '0');
    const revenue        = invoiceRevenue.plus(walkInRevenue);

    const cogs         = new Decimal(cogsResult[0]?.cogs ?? '0');
    // BUG-L (P5): bag cost converted per-row by stored currency.
    const bagCost      = new Decimal(bagCostResult[0]?.bag_cost ?? '0');
    const varianceCost = new Decimal(varianceCostResult[0]?.variance_cost ?? '0');

    // BUG-M (P5): fuel + per-item incidentals converted by stored currency.
    const fuelCost      = new Decimal(fuelResult[0]?.fuel_cost ?? '0');
    const otherExpenses = new Decimal(otherExpensesResult[0]?.other_expenses ?? '0');
    const deliveryCost  = fuelCost.plus(otherExpenses);

    // Cash actually collected in range — reported alongside gross profit, never subtracted
    // from it (Phase 3: profitability and cash flow are tracked as separate figures).
    const cashCollected = new Decimal(cashCollectedResult[0]?.cash_collected ?? '0');

    const grossProfit = revenue
      .minus(cogs)
      .minus(bagCost)
      .minus(varianceCost)
      .minus(deliveryCost);

    // ── Net Profit — additive second tier. Gross Profit above is untouched. ────
    // Labor = accrued earnings only (sessionEarnings + WorkerCost) — WorkerPayment
    // is a cash settlement of already-accrued labor and is deliberately never
    // read here (adding it would double-count: earn $100, get paid $70 → labor
    // cost is still $100, not $170, and the remaining $30 stays owed).
    const sessionEarnings = new Decimal(sessionEarningsAgg._sum.sessionEarnings?.toString() ?? '0');
    const workerCostAmount = new Decimal(workerCostAgg._sum.amount?.toString() ?? '0');
    const laborCost = sessionEarnings.plus(workerCostAmount);

    const generalExpense = new Decimal(generalExpenseAgg._sum.amount?.toString() ?? '0');
    const handoverExpense = new Decimal(handoverExpenseAgg._sum.amount?.toString() ?? '0');

    const netProfit = grossProfit
      .minus(laborCost)
      .minus(generalExpense)
      .minus(handoverExpense);

    return {
      from: filters.dateFrom ?? null,
      to:   filters.dateTo   ?? null,
      revenue:       revenue.toFixed(2),
      cogs:          cogs.toFixed(2),
      bagCost:       bagCost.toFixed(2),
      varianceCost:  varianceCost.toFixed(2),
      deliveryCost:  deliveryCost.toFixed(2),
      grossProfit:   grossProfit.toFixed(2),
      cashCollected: cashCollected.toFixed(2),
      laborCost:       laborCost.toFixed(2),
      generalExpense:  generalExpense.toFixed(2),
      handoverExpense: handoverExpense.toFixed(2),
      netProfit:       netProfit.toFixed(2),
    };
  }

  /**
   * Daily revenue report — same accrual revenue definition as getProfitLoss()
   * (invoice total for 'issued'/'partially_paid'/'paid', + non-null walk-in
   * exit amounts; same per-row currency conversion, same exchangeRateSnapshot
   * fallback for invoices), just bucketed by day instead of summed to one
   * total. Powers both the Reports P&L tab and the Dashboard "Daily revenue"
   * card — one endpoint, one hook, one chart, so the two pages can never show
   * different numbers for the same period.
   *
   * Every day in the range is included (zero-filled), not just days with
   * revenue, so the chart's x-axis is continuous.
   */
  async getDailyRevenue(rawFilters: { dateFrom?: string; dateTo?: string }) {
    // Validate/normalize BEFORE anything below ever reads these values — see
    // validateOptionalDateOnly()'s doc comment for the exact crash this closes.
    const dateFrom = validateOptionalDateOnly(rawFilters.dateFrom, 'dateFrom');
    const dateTo   = validateOptionalDateOnly(rawFilters.dateTo, 'dateTo');
    const filters = { dateFrom, dateTo };
    const dateFilter = buildDateFilterWithDefault(filters.dateFrom, filters.dateTo);
    // se.date (a @db.Date column) bounds — unchanged, still correct as-is.
    const rangeFrom = dateFilter.gte as Date;
    const rangeTo   = dateFilter.lte ?? new Date();
    // inv.issuedAt (a genuine DateTime column) bounds — Asia/Beirut calendar day,
    // businessRangeTo exclusive. Always <= rangeFrom / >= rangeTo respectively
    // (Beirut is UTC+3, so its day start is earlier in UTC and its exclusive
    // next-day start is later), so this range always fully contains the other.
    const businessRangeFrom = dateFilter.businessGte as Date;
    const businessRangeTo   = dateFilter.businessLt ?? new Date();

    // Resolved start/end of the zero-fill loop below — computed HERE (before
    // any database query) so an effectively-reversed range can be rejected
    // up front. Prefer the caller's own date strings directly when given —
    // they're exactly what businessRangeFrom/businessRangeTo were derived
    // from, so no round-trip through Intl is needed (or risked) in the
    // common, explicit-range case. Only the no-args default-lookback path
    // (an arbitrary "now − N days" instant, not aligned to any day boundary
    // — a pre-existing imprecision of that default, not something this fix
    // changes) needs deriving the boundary days from the instants themselves.
    const beirutDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE }).format(d);
    const startDay = filters.dateFrom ?? beirutDay(businessRangeFrom);
    const endDay   = filters.dateTo   ?? beirutDay(new Date(businessRangeTo.getTime() - 1));
    // Guard against an effectively-reversed range — e.g. an omitted/empty
    // dateFrom defaults to TODAY while an explicit past dateTo stays in the
    // past, which would otherwise start the day-loop below AFTER its own end
    // and never terminate (the earlier dateFrom>dateTo check above only
    // catches the case where BOTH were explicitly supplied and reversed).
    if (startDay > endDay) {
      throw new BadRequestException({ error: 'dateFrom must not be after dateTo', code: 'VALIDATION_ERROR' });
    }

    // Same single-resolve-per-call rate as getProfitLoss — see its docstring.
    const rate = new Decimal(await this.settingsService.getExchangeRate());

    const [invoiceRows, walkInRows] = await Promise.all([
      // Same WHERE/CASE as getProfitLoss's invoice-revenue query, grouped by issue day.
      // issuedAt is `timestamp WITHOUT time zone` holding UTC wall-clock values (verified
      // against the live DB — SHOW timezone = UTC; information_schema confirms the column
      // type). A single `AT TIME ZONE 'Asia/Beirut'` on a naive column does the OPPOSITE of
      // what's needed (treats the naive value as already-Beirut-local and converts it TO
      // UTC). The correct idiom for "naive column holding UTC instants, read in a target
      // zone" is the double conversion: attach the UTC interpretation first (→ timestamptz),
      // then re-render in Beirut wall-clock (→ naive timestamp, now Beirut-local) before
      // truncating. Verified against real invoices and synthetic Beirut-midnight boundary
      // cases (summer UTC+3 and winter UTC+2) in the getDailyRevenue timezone audit.
      this.prisma.$queryRaw<{ day: string; revenue: string }[]>(Prisma.sql`
        SELECT date_trunc('day', inv."issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Beirut')::date::text AS day,
          COALESCE(SUM(
            CASE WHEN inv."currency" = 'LBP'
                 THEN inv."total"::numeric
                      / NULLIF(COALESCE(inv."exchangeRateSnapshot", ${rate}::numeric), 0)
                 ELSE inv."total"::numeric
            END
          ), 0::numeric)::text AS revenue
        FROM "invoices" inv
        WHERE inv."status" IN ('issued', 'partially_paid', 'paid')
          AND inv."issuedAt" >= ${businessRangeFrom}
          AND inv."issuedAt" <  ${businessRangeTo}
        GROUP BY date_trunc('day', inv."issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Beirut')
      `),

      // Same WHERE/CASE as getProfitLoss's walk-in-revenue query, grouped by exit day.
      this.prisma.$queryRaw<{ day: string; revenue: string }[]>(Prisma.sql`
        SELECT date_trunc('day', se."date")::date::text AS day,
          COALESCE(SUM(
            CASE WHEN se."currency" = 'LBP'
                 THEN se."amount"::numeric / NULLIF(${rate}::numeric, 0)
                 ELSE se."amount"::numeric
            END
          ), 0::numeric)::text AS revenue
        FROM "stock_exits" se
        WHERE se."exitType" = 'walk_in'
          AND se."amount" IS NOT NULL
          AND se."date" >= ${rangeFrom}
          AND se."date" <= ${rangeTo}
        GROUP BY date_trunc('day', se."date")
      `),
    ]);

    const byDay = new Map<string, Decimal>();
    for (const row of invoiceRows) {
      byDay.set(row.day, (byDay.get(row.day) ?? new Decimal(0)).plus(row.revenue));
    }
    for (const row of walkInRows) {
      byDay.set(row.day, (byDay.get(row.day) ?? new Decimal(0)).plus(row.revenue));
    }

    // Zero-fill exactly the requested Asia/Beirut business-day range — no wider
    // defensive padding needed now that invoice bucketing is itself Beirut-aware
    // (see the SQL above): every invoice row satisfying `issuedAt >= businessRangeFrom
    // AND < businessRangeTo` necessarily buckets, under the same AT TIME ZONE
    // conversion, to a Beirut calendar day within [startDay, endDay] inclusive —
    // that's exactly what those two instants mean (businessRangeFrom IS Beirut
    // midnight of startDay; businessRangeTo IS Beirut midnight of the day after
    // endDay). Walk-in/se.date rows are bounded by rangeFrom/rangeTo (@db.Date,
    // unaffected by this fix), which for an explicit dateFrom/dateTo resolves to
    // exactly [startDay, endDay] too — never wider. So neither source can ever
    // produce a key outside this loop's range; nothing to silently lose.
    // (startDay/endDay were already resolved and range-checked above.)
    const data: { date: string; revenue: string }[] = [];
    let totalRevenue = new Decimal(0);
    for (let day = startDay; ; day = nextDateOnlyString(day)) {
      const amount = byDay.get(day) ?? new Decimal(0);
      totalRevenue = totalRevenue.plus(amount);
      data.push({ date: day, revenue: amount.toFixed(2) });
      if (day === endDay) break;
    }

    return {
      from: filters.dateFrom ?? null,
      to:   filters.dateTo   ?? null,
      data,
      totalRevenue: totalRevenue.toFixed(2),
    };
  }

  /**
   * Revenue by charcoal type — same accrual revenue definition as
   * getProfitLoss()/getDailyRevenue() (same status filter, same per-row
   * currency conversion, same exchangeRateSnapshot fallback for invoices),
   * grouped by charcoal type instead of summed to one total or bucketed by day.
   *
   * Three sources, an exact split of getProfitLoss()'s two revenue sources:
   *   1. ORDER invoices — attributed via ClientOrder.charcoalType. An order
   *      (and therefore its invoice — createFromOrder always writes exactly
   *      one line, from the order's own charcoalType) is always a single
   *      type, so this is exact, not an apportionment.
   *   2. WAREHOUSE_SALE invoices (registered-client walk-in sales) — attributed
   *      per line, reading the charcoalType WalkInSalesService now stamps onto
   *      each enriched line at creation time (see walk-in-sales.service.ts).
   *      Σ(line.lineTotal) === invoice.total always (computeTotal is a plain
   *      sum, no tax/fee), so summing per line never diverges from summing
   *      the whole invoice. Invoices created before the stamp existed simply
   *      lack the JSON key and fall back to 'Uncategorized' — not wrong data,
   *      just data reported before this field existed.
   *   3. Anonymous walk-in exits (exitType='walk_in', amount IS NOT NULL, no
   *      invoice) — attributed via the same stock_lot/packed_stock join
   *      getProfitLoss's COGS query already uses.
   *
   * Σ(revenue across the returned types) === getProfitLoss(filters).revenue
   * for the same filters — every dollar counted here comes from exactly one
   * of the same two SQL sources getProfitLoss's invoice_revenue/walk_in_revenue
   * already sum; this only adds a GROUP BY, never a different WHERE.
   *
   * Foundation for the future P&L-by-charcoal-type report: that feature adds
   * a parallel COGS-by-type query (the same lot-chain join COGS already uses
   * in getProfitLoss, just GROUP BY charcoal type) and merges it against this
   * method's `data` by charcoalType — no new revenue source or join strategy
   * needed, only an additional query alongside these three.
   */
  async getRevenueByCharcoalType(filters: { dateFrom?: string; dateTo?: string }) {
    const dateFilter = buildDateFilterWithDefault(filters.dateFrom, filters.dateTo);
    const rate = new Decimal(await this.settingsService.getExchangeRate());

    const [orderRows, warehouseLineRows, anonWalkInRows] = await Promise.all([
      // Source 1 — same status filter/currency CASE as getProfitLoss's
      // invoice_revenue, restricted to source='ORDER', grouped by the order's
      // single charcoal type.
      this.prisma.$queryRaw<{ charcoal_type: string; revenue: string }[]>(Prisma.sql`
        SELECT co."charcoalType" AS charcoal_type,
          COALESCE(SUM(
            CASE WHEN inv."currency" = 'LBP'
                 THEN inv."total"::numeric
                      / NULLIF(COALESCE(inv."exchangeRateSnapshot", ${rate}::numeric), 0)
                 ELSE inv."total"::numeric
            END
          ), 0::numeric)::text AS revenue
        FROM "invoices" inv
        JOIN "client_orders" co ON inv."orderId" = co."id"
        WHERE inv."status" IN ('issued', 'partially_paid', 'paid')
          AND inv."source" = 'ORDER'
          ${dateFilter.businessGte ? Prisma.sql`AND inv."issuedAt" >= ${dateFilter.businessGte}` : Prisma.empty}
          ${dateFilter.businessLt  ? Prisma.sql`AND inv."issuedAt" <  ${dateFilter.businessLt}`  : Prisma.empty}
        GROUP BY co."charcoalType"
      `),

      // Source 2 — same status filter/currency CASE, applied per line
      // (lineTotal) instead of the whole invoice.total, since one
      // WAREHOUSE_SALE invoice can mix multiple charcoal types.
      this.prisma.$queryRaw<{ charcoal_type: string; revenue: string }[]>(Prisma.sql`
        SELECT COALESCE(line->>'charcoalType', 'Uncategorized') AS charcoal_type,
          COALESCE(SUM(
            CASE WHEN inv."currency" = 'LBP'
                 THEN (line->>'lineTotal')::numeric
                      / NULLIF(COALESCE(inv."exchangeRateSnapshot", ${rate}::numeric), 0)
                 ELSE (line->>'lineTotal')::numeric
            END
          ), 0::numeric)::text AS revenue
        FROM "invoices" inv
        CROSS JOIN LATERAL jsonb_array_elements(inv."lines") AS line
        WHERE inv."status" IN ('issued', 'partially_paid', 'paid')
          AND inv."source" = 'WAREHOUSE_SALE'
          ${dateFilter.businessGte ? Prisma.sql`AND inv."issuedAt" >= ${dateFilter.businessGte}` : Prisma.empty}
          ${dateFilter.businessLt  ? Prisma.sql`AND inv."issuedAt" <  ${dateFilter.businessLt}`  : Prisma.empty}
        GROUP BY COALESCE(line->>'charcoalType', 'Uncategorized')
      `),

      // Source 3 — same status filter/currency CASE as getProfitLoss's
      // walk_in_revenue, grouped by charcoal type via the same lot/packed-stock
      // join the COGS query already uses.
      this.prisma.$queryRaw<{ charcoal_type: string; revenue: string }[]>(Prisma.sql`
        SELECT COALESCE(l."charcoalType", ps_lot."charcoalType") AS charcoal_type,
          COALESCE(SUM(
            CASE WHEN se."currency" = 'LBP'
                 THEN se."amount"::numeric / NULLIF(${rate}::numeric, 0)
                 ELSE se."amount"::numeric
            END
          ), 0::numeric)::text AS revenue
        FROM "stock_exits" se
        LEFT JOIN "stock_lots" l      ON se."lotId" = l."id"
        LEFT JOIN "packed_stocks" ps  ON se."packedStockId" = ps."id"
        LEFT JOIN "stock_lots" ps_lot ON ps."lotId" = ps_lot."id"
        WHERE se."exitType" = 'walk_in'
          AND se."amount" IS NOT NULL
          ${dateFilter.gte ? Prisma.sql`AND se."date" >= ${dateFilter.gte}` : Prisma.empty}
          ${dateFilter.lte ? Prisma.sql`AND se."date" <= ${dateFilter.lte}` : Prisma.empty}
        GROUP BY COALESCE(l."charcoalType", ps_lot."charcoalType")
      `),
    ]);

    const byType = new Map<string, Decimal>();
    for (const rows of [orderRows, warehouseLineRows, anonWalkInRows]) {
      for (const row of rows) {
        const key = row.charcoal_type ?? 'Uncategorized';
        byType.set(key, (byType.get(key) ?? new Decimal(0)).plus(row.revenue));
      }
    }

    const data = Array.from(byType.entries())
      .map(([charcoalType, revenue]) => ({ charcoalType, revenue: revenue.toFixed(2) }))
      .sort((a, b) => parseFloat(b.revenue) - parseFloat(a.revenue));

    const totalRevenue = data.reduce((sum, row) => sum.plus(row.revenue), new Decimal(0));

    return {
      from: filters.dateFrom ?? null,
      to:   filters.dateTo   ?? null,
      data,
      totalRevenue: totalRevenue.toFixed(2),
    };
  }

  /**
   * COGS by charcoal type — the exact same WHERE/CASE/joins as getProfitLoss's
   * cogs query, just GROUP BY charcoal type instead of summed to one total.
   * No currency conversion needed here — costPerKg is assumed USD, same basis
   * as getProfitLoss's COGS (see that query's comment).
   *
   * Σ(data[].cogs) === getProfitLoss(filters).cogs for the same filters —
   * same WHERE, same CASE, same joins, only the GROUP BY differs.
   *
   * Independently callable — not just an internal helper of
   * getPnlByCharcoalType — so any future report needing cost-by-type doesn't
   * need to re-derive this join.
   */
  async getCogsByCharcoalType(filters: { dateFrom?: string; dateTo?: string }) {
    const dateFilter = buildDateFilterWithDefault(filters.dateFrom, filters.dateTo);

    const rows = await this.prisma.$queryRaw<{ charcoal_type: string; cogs: string }[]>(Prisma.sql`
      SELECT COALESCE(l."charcoalType", ps_lot."charcoalType") AS charcoal_type,
        COALESCE(SUM(
          CASE
            WHEN se."lotId" IS NOT NULL AND se."kgQuantity" IS NOT NULL
              THEN se."kgQuantity" * l."costPerKg"
            WHEN se."packedStockId" IS NOT NULL AND se."quantity" IS NOT NULL
                 AND bt."nominalKg" IS NOT NULL AND ps_lot."costPerKg" IS NOT NULL
              THEN se."quantity"::numeric * bt."nominalKg" * ps_lot."costPerKg"
            ELSE 0::numeric
          END
        ), 0::numeric)::text AS cogs
      FROM "stock_exits" se
      LEFT JOIN "packed_stocks" ps    ON se."packedStockId" = ps."id"
      LEFT JOIN "stock_lots"  ps_lot ON ps."lotId"          = ps_lot."id"
      LEFT JOIN "bag_types"   bt     ON se."bagTypeId"       = bt."id"
      LEFT JOIN "stock_lots"  l      ON se."lotId"           = l."id"
      WHERE se."exitType" IN ('order', 'walk_in')
        ${dateFilter.gte ? Prisma.sql`AND se."date" >= ${dateFilter.gte}` : Prisma.empty}
        ${dateFilter.lte ? Prisma.sql`AND se."date" <= ${dateFilter.lte}` : Prisma.empty}
      GROUP BY COALESCE(l."charcoalType", ps_lot."charcoalType")
    `);

    const data = rows
      .map((row) => ({ charcoalType: row.charcoal_type ?? 'Uncategorized', cogs: new Decimal(row.cogs).toFixed(2) }))
      .sort((a, b) => parseFloat(b.cogs) - parseFloat(a.cogs));

    const totalCogs = data.reduce((sum, row) => sum.plus(row.cogs), new Decimal(0));

    return {
      from: filters.dateFrom ?? null,
      to:   filters.dateTo   ?? null,
      data,
      totalCogs: totalCogs.toFixed(2),
    };
  }

  /**
   * P&L by charcoal type — merges getRevenueByCharcoalType() and
   * getCogsByCharcoalType() by charcoal type. Introduces no new revenue or
   * cost aggregation of its own; it is purely a merge of the two existing,
   * independently-reusable, independently-tested methods above.
   *
   * Gross profit here is Revenue − COGS (textbook gross profit), NOT the same
   * figure as getProfitLoss().grossProfit — that field additionally nets out
   * bag cost, packing variance, and delivery cost, none of which are
   * attributable to a single charcoal type without an apportionment rule
   * that Profit & Loss itself doesn't define (bag purchases aren't
   * charcoal-type-specific; a delivery trip can carry multiple orders of
   * different types). Introducing such a rule here would not be "reusing
   * existing accounting rules" — it would be inventing a new one. So:
   *   Σ(data[].revenue)     === getRevenueByCharcoalType(filters).totalRevenue === getProfitLoss(filters).revenue
   *   Σ(data[].cogs)        === getCogsByCharcoalType(filters).totalCogs       === getProfitLoss(filters).cogs
   *   Σ(data[].grossProfit) === totalRevenue − totalCogs (a genuine, well-defined
   *     subtotal — just not identical to getProfitLoss's fuller grossProfit,
   *     which subtracts three more cost lines that don't have a type dimension).
   */
  async getPnlByCharcoalType(filters: { dateFrom?: string; dateTo?: string }) {
    const [revenueReport, cogsReport] = await Promise.all([
      this.getRevenueByCharcoalType(filters),
      this.getCogsByCharcoalType(filters),
    ]);

    const byType = new Map<string, { revenue: Decimal; cogs: Decimal }>();
    for (const row of revenueReport.data) {
      byType.set(row.charcoalType, { revenue: new Decimal(row.revenue), cogs: new Decimal(0) });
    }
    for (const row of cogsReport.data) {
      const entry = byType.get(row.charcoalType) ?? { revenue: new Decimal(0), cogs: new Decimal(0) };
      entry.cogs = new Decimal(row.cogs);
      byType.set(row.charcoalType, entry);
    }

    const data = Array.from(byType.entries())
      .map(([charcoalType, { revenue, cogs }]) => {
        const grossProfit = revenue.minus(cogs);
        const marginPct = revenue.gt(0) ? grossProfit.div(revenue).mul(100) : new Decimal(0);
        return {
          charcoalType,
          revenue: revenue.toFixed(2),
          cogs: cogs.toFixed(2),
          grossProfit: grossProfit.toFixed(2),
          marginPct: marginPct.toFixed(1),
        };
      })
      .sort((a, b) => parseFloat(b.revenue) - parseFloat(a.revenue));

    const totalRevenue = new Decimal(revenueReport.totalRevenue);
    const totalCogs = new Decimal(cogsReport.totalCogs);
    const totalGrossProfit = totalRevenue.minus(totalCogs);
    const totalMarginPct = totalRevenue.gt(0) ? totalGrossProfit.div(totalRevenue).mul(100) : new Decimal(0);

    return {
      from: filters.dateFrom ?? null,
      to:   filters.dateTo   ?? null,
      data,
      totalRevenue:     totalRevenue.toFixed(2),
      totalCogs:        totalCogs.toFixed(2),
      totalGrossProfit: totalGrossProfit.toFixed(2),
      totalMarginPct:   totalMarginPct.toFixed(1),
    };
  }

  /**
   * Stock value report — paginated lot list with a DB-computed grand total.
   * CONSTRAINT 12: costPerKg visible to owner/accountant only (enforced at controller).
   *
   * totalValue is computed via raw SQL SUM(kgRemaining * costPerKg) using
   * NUMERIC precision — not loaded into memory.
   */
  async getStockValue(page = 1, limit = 50) {
    const skip  = (page - 1) * limit;
    const where = { kgRemaining: { gt: 0 } };

    const totalValueResult = await this.prisma.$queryRaw<[{ total_value: string }]>(Prisma.sql`
      SELECT COALESCE(SUM("kgRemaining" * "costPerKg"), 0::numeric)::text AS total_value
      FROM "stock_lots"
      WHERE "kgRemaining" > 0::numeric
    `);
    const totalValue = new Decimal(totalValueResult[0]?.total_value ?? '0');

    const [lots, total] = await this.prisma.$transaction([
      this.prisma.stockLot.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      this.prisma.stockLot.count({ where }),
    ]);

    const data = lots.map((lot) => {
      const kgRemaining = new Decimal(lot.kgRemaining.toString());
      const costPerKg   = new Decimal(lot.costPerKg.toString());
      return {
        lotId:        lot.id,
        charcoalType: lot.charcoalType,
        grade:        lot.grade,
        kgRemaining:  kgRemaining.toFixed(3),
        costPerKg:    costPerKg.toFixed(4),
        lotValue:     kgRemaining.times(costPerKg).toFixed(2),
      };
    });

    return { data, total, page, limit, totalValue: totalValue.toFixed(2) };
  }

  /**
   * Variance report — paginated session rows with DB-computed grand totals.
   *
   * Grand totals (totalVarianceKg, totalVarianceCost) are computed over the
   * entire filtered period via DB aggregate / LATERAL SQL — not in memory.
   * Defaults to the last DEFAULT_LOOKBACK_DAYS days when no date filter is given.
   *
   * byCharcoalType is an additional, purely-additive full-table breakdown of
   * the same varianceKg figures — see the comment at its query below. It does
   * not change `data`/`total`/`totalVarianceKg`/`totalVarianceCost`, so it's
   * safe to add without touching any existing consumer of this endpoint.
   */
  async getVariance(filters: {
    dateFrom?: string;
    dateTo?: string;
    workerId?: string;
    page?:  number;
    limit?: number;
  }) {
    const dateFilter = buildDateFilterWithDefault(filters.dateFrom, filters.dateTo);
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 50;
    const skip  = (page - 1) * limit;

    // packing_sessions.date is a @db.Date column — plain gte/lte, same category
    // as bagCost/varianceCost in getProfitLoss (see laborPeriodWhere there).
    // Passing dateFilter wholesale would leak businessGte/businessLt as
    // unrecognized keys into Prisma's filter validation (see getContainerCosts'
    // arrivalDate comment for the same footgun) and throw at runtime.
    const where: Prisma.PackingSessionWhereInput = {
      date: {
        ...(dateFilter.gte ? { gte: dateFilter.gte } : {}),
        ...(dateFilter.lte ? { lte: dateFilter.lte } : {}),
      },
      ...(filters.workerId ? { workerId: filters.workerId } : {}),
    };

    const varianceKgAgg = await this.prisma.packingSession.aggregate({
      where,
      _sum: { varianceKg: true },
    });
    const totalVarianceKg = new Decimal(varianceKgAgg._sum.varianceKg?.toString() ?? '0');

    // Use WHERE 1=1 so every AND clause is unconditional — avoids the
    // leading-AND bug that appeared when only lte was supplied.
    const varianceCostResult = await this.prisma.$queryRaw<[{ total_variance_cost: string }]>(
      Prisma.sql`
        SELECT COALESCE(SUM(
          ABS(ps."varianceKg") *
          CASE WHEN COALESCE(tot.kg, 0::numeric) > 0
            THEN COALESCE(wc.cost, 0::numeric) / tot.kg
            ELSE 0::numeric
          END
        ), 0::numeric)::text AS total_variance_cost
        FROM "packing_sessions" ps
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(sl."kgUsed"), 0::numeric) AS kg
          FROM "packing_session_lots" sl
          WHERE sl."sessionId" = ps."id"
        ) tot
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(sl."kgUsed" * l."costPerKg"), 0::numeric) AS cost
          FROM "packing_session_lots" sl
          JOIN "stock_lots" l ON l."id" = sl."lotId"
          WHERE sl."sessionId" = ps."id"
        ) wc
        WHERE 1=1
        ${dateFilter.gte ? Prisma.sql`AND ps."date" >= ${dateFilter.gte}` : Prisma.empty}
        ${dateFilter.lte ? Prisma.sql`AND ps."date" <= ${dateFilter.lte}` : Prisma.empty}
        ${filters.workerId ? Prisma.sql`AND ps."workerId" = ${filters.workerId}` : Prisma.empty}
      `,
    );
    const totalVarianceCost = new Decimal(varianceCostResult[0]?.total_variance_cost ?? '0');

    // ── Variance by charcoal type — apportions each session's single varianceKg
    // figure across the charcoal type(s) it actually packed, weighted by each
    // lot's share of the session's total kgUsed. This is not a second
    // definition of variance: it's the exact same session-level varianceKg
    // already summed above, split proportionally instead of left as one
    // number — the same kg-weighting approach the varianceCost query above
    // already uses to blend cost-per-kg across a session's lots.
    // Σ(byCharcoalType[].totalVarianceKg) === totalVarianceKg above, because
    // each session's lot shares (kgUsed / session total kgUsed) always sum to
    // 1, so its apportioned pieces always sum back to its own varianceKg —
    // this holds over the FULL filtered set (not just the current page),
    // since both totals come from full-table aggregates, not `data`.
    // A session that packed more than one charcoal type is counted once
    // under EACH type it touched — by design, not a bug: it genuinely
    // contributed variance to both.
    const varianceByTypeResult = await this.prisma.$queryRaw<
      { charcoal_type: string; sessions: bigint; kg_used: string; variance_kg: string }[]
    >(Prisma.sql`
      SELECT
        l."charcoalType" AS charcoal_type,
        COUNT(DISTINCT ps."id") AS sessions,
        COALESCE(SUM(sl."kgUsed"), 0::numeric)::text AS kg_used,
        COALESCE(SUM(
          ps."varianceKg" * sl."kgUsed" / NULLIF(tot.kg, 0::numeric)
        ), 0::numeric)::text AS variance_kg
      FROM "packing_sessions" ps
      JOIN "packing_session_lots" sl ON sl."sessionId" = ps."id"
      JOIN "stock_lots" l             ON l."id"         = sl."lotId"
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(sl2."kgUsed"), 0::numeric) AS kg
        FROM "packing_session_lots" sl2
        WHERE sl2."sessionId" = ps."id"
      ) tot
      WHERE 1=1
      ${dateFilter.gte ? Prisma.sql`AND ps."date" >= ${dateFilter.gte}` : Prisma.empty}
      ${dateFilter.lte ? Prisma.sql`AND ps."date" <= ${dateFilter.lte}` : Prisma.empty}
      ${filters.workerId ? Prisma.sql`AND ps."workerId" = ${filters.workerId}` : Prisma.empty}
      GROUP BY l."charcoalType"
    `);

    const byCharcoalTypeRaw = varianceByTypeResult.map((row) => {
      const kgUsed = new Decimal(row.kg_used);
      const typeVarianceKg = new Decimal(row.variance_kg);
      return {
        charcoalType: row.charcoal_type,
        sessions: Number(row.sessions),
        kgUsed,
        varianceKg: typeVarianceKg,
        avgVariancePct: kgUsed.gt(0) ? typeVarianceKg.div(kgUsed).mul(100) : new Decimal(0),
      };
    });
    // Share of total is computed against the sum of each type's own |variance|,
    // not the signed grand total — a signed total near zero (offsetting
    // over/under-packing across types) would otherwise blow the percentage up
    // arbitrarily. This way every type's share is stable and shares sum to 100%.
    const totalAbsVarianceKg = byCharcoalTypeRaw.reduce((s, r) => s.plus(r.varianceKg.abs()), new Decimal(0));
    const byCharcoalType = byCharcoalTypeRaw
      .map((r) => ({
        charcoalType:    r.charcoalType,
        sessions:        r.sessions,
        totalVarianceKg: r.varianceKg.toFixed(3),
        avgVariancePct:  r.avgVariancePct.toFixed(1),
        shareOfTotalPct: totalAbsVarianceKg.gt(0) ? r.varianceKg.abs().div(totalAbsVarianceKg).mul(100).toFixed(1) : '0.0',
      }))
      .sort((a, b) => Math.abs(parseFloat(b.totalVarianceKg)) - Math.abs(parseFloat(a.totalVarianceKg)));

    const [sessions, total] = await this.prisma.$transaction([
      this.prisma.packingSession.findMany({
        where,
        include: {
          worker:      { select: { name: true } },
          sessionLots: {
            select: {
              lotId: true,
              kgUsed: true,
              lot: { select: { id: true, charcoalType: true, grade: true, costPerKg: true } },
            },
          },
        },
        orderBy: { date: 'asc' },
        take: limit,
        skip,
      }),
      this.prisma.packingSession.count({ where }),
    ]);

    const rows = sessions.map((session) => {
      const varianceKg    = new Decimal(session.varianceKg.toString());
      const totalKg       = session.sessionLots.reduce(
        (s, sl) => s.plus(sl.kgUsed.toString()), new Decimal(0),
      );
      const weightedCost  = session.sessionLots.reduce(
        (s, sl) => s.plus(new Decimal(sl.lot.costPerKg.toString()).mul(sl.kgUsed.toString())),
        new Decimal(0),
      );
      const avgCostPerKg  = totalKg.gt(0) ? weightedCost.div(totalKg) : new Decimal(0);
      const varianceCost  = varianceKg.abs().times(avgCostPerKg);

      return {
        sessionId:     session.id,
        date:          session.date,
        workerId:      session.workerId,
        workerName:    session.worker.name,
        lots: session.sessionLots.map(sl => ({
          lotId:        sl.lotId,
          charcoalType: sl.lot.charcoalType,
          grade:        sl.lot.grade,
          kgUsed:       sl.kgUsed.toString(),
        })),
        kgConsumed:    new Decimal(session.kgConsumed.toString()).toFixed(3),
        kgOutputTotal: new Decimal(session.kgOutputTotal.toString()).toFixed(3),
        varianceKg:    varianceKg.toFixed(3),
        varianceNote:  session.varianceNote,
        varianceCost:  varianceCost.toFixed(2),
      };
    });

    return {
      from: filters.dateFrom ?? null,
      to:   filters.dateTo   ?? null,
      data: rows,
      total,
      page,
      limit,
      totalVarianceKg:   totalVarianceKg.toFixed(3),
      totalVarianceCost: totalVarianceCost.toFixed(2),
      byCharcoalType,
    };
  }

  /**
   * Container costs report — paginated list.
   * Per-container cost computation stays in-memory but is bounded by page size.
   * Defaults to the last DEFAULT_LOOKBACK_DAYS days when no date filter is given.
   */
  async getContainerCosts(filters: {
    dateFrom?: string;
    dateTo?: string;
    supplierId?: string;
    page?:  number;
    limit?: number;
  }) {
    const dateFilter = buildDateFilterWithDefault(filters.dateFrom, filters.dateTo);
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 20;
    const skip  = (page - 1) * limit;

    const where: Prisma.ContainerWhereInput = {
      status: 'arrived',
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      // arrivalDate is a genuine DateTime column — Asia/Beirut boundaries, not
      // the plain gte/lte (those are for @db.Date columns; passing the whole
      // dateFilter object here would also leak businessGte/businessLt as
      // unrecognized keys into Prisma's filter validation).
      arrivalDate: { gte: dateFilter.businessGte, lt: dateFilter.businessLt },
    };

    const [containers, total] = await this.prisma.$transaction([
      this.prisma.container.findMany({
        where,
        include: {
          supplier:     { select: { name: true } },
          productLines: { orderBy: { createdAt: 'asc' } },
          expenses:     true,
          discount:     true,
        },
        orderBy: { arrivalDate: 'desc' },
        take: limit,
        skip,
      }),
      this.prisma.container.count({ where }),
    ]);

    const data = containers.map((container) => {
      const totalExpenses = container.expenses.reduce(
        (sum, e) => sum.plus(new Decimal(e.amount.toString())), new Decimal(0),
      );
      const totalDiscount = container.discount
        ? new Decimal(container.discount.amount.toString())
        : new Decimal(0);

      const linesWith = container.productLines.map((line) => {
        const paidBags    = new Decimal(line.paidBags);
        const kgPerBag    = new Decimal(line.kgPerBag.toString());
        const pricePerTon = new Decimal(line.pricePerTon.toString());
        const tonnage     = paidBags.times(kgPerBag).div(1000);
        return { line, tonnage, pricePerTon, kgPerBag };
      });

      const totalTonnage = linesWith.reduce((sum, l) => sum.plus(l.tonnage), new Decimal(0));

      const productLines = linesWith.map(({ line, tonnage, pricePerTon, kgPerBag }) => {
        const expenseShare  = totalTonnage.gt(0)
          ? totalExpenses.times(tonnage.div(totalTonnage)) : new Decimal(0);
        const discountShare = totalTonnage.gt(0)
          ? totalDiscount.times(tonnage.div(totalTonnage)) : new Decimal(0);
        const allInCostPerTon = tonnage.gt(0)
          ? pricePerTon.plus(expenseShare.div(tonnage)).minus(discountShare.div(tonnage))
          : pricePerTon;
        const allInCostPerKg = allInCostPerTon.div(1000);

        return {
          id:           line.id,
          charcoalType: line.charcoalType,
          grade:        line.grade,
          paidBags:     line.paidBags,
          giftBags:     line.giftBags,
          kgPerBag:     kgPerBag.toFixed(3),
          pricePerTon:  pricePerTon.toFixed(2),
          computed: {
            tonnage:         tonnage.toFixed(3),
            expenseShare:    expenseShare.toFixed(2),
            discountShare:   discountShare.toFixed(2),
            allInCostPerTon: allInCostPerTon.toFixed(2),
            allInCostPerKg:  allInCostPerKg.toFixed(4),
          },
        };
      });

      return {
        containerId:   container.id,
        number:        container.number,
        supplierName:  container.supplier.name,
        arrivalDate:   container.arrivalDate,
        productLines,
        totalExpenses: totalExpenses.toFixed(2),
        totalDiscount: totalDiscount.toFixed(2),
        totalTonnage:  totalTonnage.toFixed(3),
      };
    });

    return { data, total, page, limit };
  }

  // ── Ledger description helpers ───────────────────────────────────────────────

  /**
   * @param locationName - Multiple-locations audit, 2026-08-31: the order's
   *   ClientLocation.name, when this invoice was raised from an order placed
   *   for one (see the `order.location` select at this method's call site).
   *   Always null for a WAREHOUSE_SALE invoice or an order with no location
   *   selected — never fabricated. Appended to the END of the existing
   *   description string (never a separate field/column — see
   *   ClientLedgerEntry: still just one `description` string), so every
   *   existing reader of this string keeps working, just with more context.
   */
  private buildInvoiceDescription(source: string | null, lines: any[], locationName?: string | null): string {
    const prefix = source === 'WAREHOUSE_SALE' ? 'Warehouse Sale' : 'Order Sale';
    const base = (!lines || lines.length === 0)
      ? prefix
      : `${prefix} · ${lines.map((l: any) => {
          if (l.saleUnit === 'KG') {
            return `${l.kgQuantity} kg ${l.description ?? ''}`.trim();
          }
          // BAG line — saleUnit may be absent on pre-Phase-3 lines; treat absent as BAG.
          const qty  = l.qty ?? 0;
          const name = l.bagTypeName ?? '';
          return `${qty} × ${name}`;
        }).join(' · ')}`;
    return locationName ? `${base} - ${locationName}` : base;
  }

  private buildPaymentDescription(method: string): string {
    const map: Record<string, string> = {
      cash:          'Cash Payment',
      whish:         'Whish',
      omt:           'OMT',
      bank_transfer: 'Bank Transfer',
      cheque:        'Cheque Payment',
    };
    return map[method] ?? 'Payment';
  }

  /**
   * Description for a Fill Client pickup debit entry — parses the same
   * bag-summary JSON `reason` blob FillClientDetail.tsx already parses
   * client-side (specKey/size/charcoal/qty array), ported rather than
   * reinvented so the wording stays derived from the existing source data.
   */
  private buildFillPickupDescription(reason: string | null): string {
    if (!reason) return 'Filled bags pickup';
    try {
      const items = JSON.parse(reason) as { size?: number; charcoal?: string; qty: number }[];
      const totalBags = items.reduce((sum, i) => sum + (i.qty ?? 0), 0);
      if (totalBags === 0) return 'Filled bags pickup';
      const detail = items.map((i) => `${i.qty}× ${i.size ?? '?'}kg`).join(', ');
      return `Filled bags pickup — ${totalBags} bags (${detail})`;
    } catch {
      return 'Filled bags pickup';
    }
  }

  private buildProductLineDescription(
    containerNumber: string | null,
    charcoalType: string,
    grade: string,
    paidBags: number,
  ): string {
    const containerLabel = containerNumber ? `Container ${containerNumber}` : 'Container purchase';
    return `${containerLabel} · ${charcoalType} · Grade ${grade} · ${paidBags} bags`;
  }

  private buildDirectLotDescription(charcoalType: string, grade: string, kgReceived: string): string {
    return `Direct purchase · ${charcoalType} · Grade ${grade} · ${kgReceived} kg`;
  }

  /**
   * Client ledger — chronological invoice/payment list with running balance.
   *
   * Phase 5 changes:

   *   - Cancelled and draft invoices excluded (accounting correctness).
   *   - openingBalance computed from pre-period aggregate when dateFrom is set.
   *   - description built from invoice.lines + source and payment.method.
   *   - displayId included for human-readable references.
   *   - Sort tie-breaking: debits (invoices) before credits (payments) on same date.
   *
   * CONSTRAINT 15: balance always computed from records, never stored.
   */
  async getClientLedger(
    clientId: string,
    filters: { dateFrom?: string; dateTo?: string },
  ) {
    const dateFilter = buildDateFilter(filters.dateFrom, filters.dateTo);

    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });

    // ── Opening balance — aggregate of all non-cancelled invoices, Fill Client
    // pickups, and payments strictly BEFORE dateFrom. Zero when no start-date
    // filter is supplied.
    //
    // Fill Client pickups use the EXACT same filter as
    // ClientBalanceService.computeBalance() (exitType='client_bags_fill',
    // amount NOT NULL) — additive only. A normal client never has
    // exitType='client_bags_fill' rows (see computeBalance()'s doc comment),
    // so this term is always 0 for them and the pre-existing invoice/payment
    // opening balance is unchanged.
    let openingBalance = new Decimal(0);
    if (dateFilter?.gte) {
      const [priorInv, priorFillPickups, priorPay] = await Promise.all([
        this.prisma.invoice.aggregate({
          where: {
            clientId,
            status: { notIn: ['draft', 'cancelled'] },
            issuedAt: { lt: dateFilter.gte },
          },
          _sum: { total: true },
        }),
        this.prisma.stockExit.aggregate({
          where: {
            clientId,
            exitType: 'client_bags_fill',
            amount: { not: null },
            date: { lt: dateFilter.gte },
          },
          _sum: { amount: true },
        }),
        this.prisma.payment.aggregate({
          where: { clientId, date: { lt: dateFilter.gte } },
          _sum: { amount: true },
        }),
      ]);
      openingBalance = new Decimal(priorInv._sum.total?.toString()  ?? '0')
        .plus(new Decimal(priorFillPickups._sum.amount?.toString() ?? '0'))
        .minus(new Decimal(priorPay._sum.amount?.toString() ?? '0'));
    }

    // ── Period entries ────────────────────────────────────────────────────────
    // invoice.issuedAt is a genuine DateTime column — Asia/Beirut boundaries.
    // payment.date is a @db.Date column — plain gte/lte, unchanged, still correct.
    // Neither passes `dateFilter` wholesale (it now also carries businessGte/
    // businessLt, which Prisma would reject as unrecognized filter keys).
    // Fill Client pickups — same filter as ClientBalanceService.computeBalance()
    // (exitType='client_bags_fill', amount NOT NULL). date is a plain @db.Date
    // column, same as payment.date, so it uses gte/lte like the payments query
    // below rather than invoice's businessGte/businessLt DateTime handling.
    // Additive only: normal clients never have these rows (see computeBalance()'s
    // doc comment), so this query returns [] for them and existing behavior for
    // invoices/payments is unchanged.
    const [invoices, fillPickups, payments] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          clientId,
          status: { notIn: ['draft', 'cancelled'] },
          ...(dateFilter ? { issuedAt: { gte: dateFilter.businessGte, lt: dateFilter.businessLt } } : {}),
        },
        select: {
          id: true, displayId: true, issuedAt: true, createdAt: true,
          total: true, source: true, lines: true, status: true,
          // Forensic audit (2026-08-31): the Statement previously showed
          // Invoice.displayId ("SI-xxxx") for every invoice entry — including
          // one raised FROM an order, where the client/business user actually
          // knows the transaction by its Order reference ("SO-xxxx", shown on
          // Orders/OrderDetail and already resolved this same way in this
          // file's own Invoices-tab INVOICES mapping via orderDisplayById).
          // orderId + order.displayId are added here (not resolved client-side
          // against a page-capped orders fetch — ClientDetail.tsx's own
          // useOrders({ limit: 200 }) would silently miss the order for any
          // client with >200 orders) so the entry can carry the true Order
          // reference when one exists, and fall back to the invoice's own
          // displayId otherwise (e.g. WAREHOUSE_SALE, which has no orderId).
          orderId: true,
          // Multiple-locations audit, 2026-08-31: order.location.name is the
          // ONLY new thing read here — it's appended into the Statement's
          // existing `description` string by buildInvoiceDescription() below
          // (never a separate column/field on the entry — see that method's
          // doc comment). Always null for a WAREHOUSE_SALE invoice (no
          // orderId at all — see the orderId/orderDisplayId comment above),
          // so a Warehouse Sale can never end up with a location in its
          // description, structurally, without any Warehouse-Sale-specific
          // guard code.
          order: { select: { displayId: true, location: { select: { name: true } } } },
        },
        orderBy: { issuedAt: 'asc' },
      }),
      this.prisma.stockExit.findMany({
        where: {
          clientId,
          exitType: 'client_bags_fill',
          amount: { not: null },
          ...(dateFilter ? { date: { gte: dateFilter.gte, lte: dateFilter.lte } } : {}),
        },
        select: { id: true, date: true, amount: true, reason: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: { clientId, ...(dateFilter ? { date: { gte: dateFilter.gte, lte: dateFilter.lte } } : {}) },
        select: { id: true, displayId: true, date: true, amount: true, method: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    type EntryItem =
      // status: minimum field needed so callers (e.g. ClientDetail's open-invoice
      // count) can classify each invoice entry without a second, unbounded fetch —
      // see the ClientDetail invoice-scalability audit. Not used in any balance
      // math here; the running-balance fold below is unchanged.
      | { kind: 'invoice'; date: Date; id: string; displayId: string | null;
          total: Decimal; source: string | null; lines: any[]; status: string;
          orderId: string | null; orderDisplayId: string | null; locationName: string | null }
      | { kind: 'fillPickup'; date: Date; id: string; amount: Decimal; reason: string | null }
      | { kind: 'payment'; date: Date; id: string; displayId: string | null;
          amount: Decimal; method: string };

    const items: EntryItem[] = [
      ...invoices.map((inv) => ({
        kind:      'invoice' as const,
        date:      inv.issuedAt ?? inv.createdAt,
        id:        inv.id,
        displayId: inv.displayId,
        total:     new Decimal(inv.total.toString()),
        source:    inv.source as string | null,
        lines:     (inv.lines ?? []) as any[],
        status:    inv.status as string,
        orderId:        inv.orderId,
        orderDisplayId: inv.order?.displayId ?? null,
        locationName:   inv.order?.location?.name ?? null,
      })),
      ...fillPickups.map((exit) => ({
        kind:   'fillPickup' as const,
        date:   exit.date instanceof Date ? exit.date : new Date(exit.date),
        id:     exit.id,
        amount: new Decimal(exit.amount!.toString()),
        reason: exit.reason,
      })),
      ...payments.map((pmt) => ({
        kind:      'payment' as const,
        date:      pmt.date instanceof Date ? pmt.date : new Date(pmt.date),
        id:        pmt.id,
        displayId: pmt.displayId,
        amount:    new Decimal(pmt.amount.toString()),
        method:    pmt.method as string,
      })),
    ];

    // Chronological; debits (invoice / fillPickup) before credits (payment) on
    // the same timestamp — generalized from the original invoice-before-payment
    // rule so Fill Client pickups sort the same way invoices always have.
    const isDebit = (kind: EntryItem['kind']) => kind === 'invoice' || kind === 'fillPickup';
    items.sort((a, b) => {
      const diff = a.date.getTime() - b.date.getTime();
      if (diff !== 0) return diff;
      if (isDebit(a.kind) && b.kind === 'payment') return -1;
      if (a.kind === 'payment' && isDebit(b.kind)) return  1;
      return 0;
    });

    // ── Running balance fold ──────────────────────────────────────────────────
    let runningBalance = new Decimal(openingBalance);
    const entries = items.map((item) => {
      if (item.kind === 'invoice') {
        runningBalance = runningBalance.plus(item.total);
        return {
          date:           item.date,
          type:           'invoice' as const,
          reference:      item.id,
          displayId:      item.displayId,
          description:    this.buildInvoiceDescription(item.source, item.lines, item.locationName),
          debit:          item.total.toFixed(2),
          credit:         '0.00',
          runningBalance: runningBalance.toFixed(2),
          // Present on invoice entries only — lets a caller derive an
          // "open invoice" count (status not in paid/cancelled) from this
          // already-unbounded-per-client list, with no second invoice query.
          status:         item.status,
          // Present on invoice entries only. `displayId` above stays the
          // Invoice's own reference (unchanged — other callers/back-compat);
          // orderId/orderDisplayId let a caller show the ORDER's reference
          // instead when this invoice was raised from one (source: 'ORDER'),
          // which is what the client actually knows the sale by (see
          // Orders.tsx/OrderDetail.tsx, where order.displayId is the primary
          // shown reference). null for a WAREHOUSE_SALE invoice (no order).
          orderId:        item.orderId,
          orderDisplayId: item.orderDisplayId,
        };
      } else if (item.kind === 'fillPickup') {
        runningBalance = runningBalance.plus(item.amount);
        return {
          date:           item.date,
          type:           'fill_pickup' as const,
          reference:      item.id,
          displayId:      null,
          description:    this.buildFillPickupDescription(item.reason),
          debit:          item.amount.toFixed(2),
          credit:         '0.00',
          runningBalance: runningBalance.toFixed(2),
        };
      } else {
        runningBalance = runningBalance.minus(item.amount);
        return {
          date:           item.date,
          type:           'payment' as const,
          reference:      item.id,
          displayId:      item.displayId,
          description:    this.buildPaymentDescription(item.method),
          debit:          '0.00',
          credit:         item.amount.toFixed(2),
          runningBalance: runningBalance.toFixed(2),
        };
      }
    });

    return {
      clientId,
      currency:       client.currency,
      openingBalance: openingBalance.toFixed(2),
      entries,
      balance:        runningBalance.toFixed(2),
    };
  }

  /**
   * Supplier ledger (Supplier Statement of Account) — chronological purchase/payment
   * list with running balance. Mirrors getClientLedger()'s architecture and
   * tie-breaking behavior.
   *
   * Debit sources (debt recognized at purchase creation, not container arrival):
   *   - ContainerProductLine: pricePerTon × (paidBags × kgPerBag / 1000), dated by the
   *     line's own createdAt. Deliberately NOT StockLot.costPerKg — that field doesn't
   *     exist until the container arrives, and once it does it's a fully-loaded figure
   *     with container-expense/discount allocation folded in, which this statement
   *     excludes by design (approved design review, Phase 3).
   *   - StockLot (source='direct' only): costPerKg × kgReceived, dated by the user-set
   *     dateReceived (not the row's createdAt insert time), matching how
   *     getClientLedger() prefers invoice.issuedAt over invoice.createdAt.
   * Credit source:
   *   - SupplierPayment.amount, converted to USD when currency='LBP' using the same
   *     global exchange rate SettingsService already provides elsewhere in this
   *     service. This fixes the currency gap identified in SuppliersService, where
   *     LBP payments were previously excluded from totalPaidUsd/outstandingUsd
   *     entirely (see suppliers.service.ts, updated alongside this method).
   *
   * Explicitly excluded: ContainerExpense, ContainerDiscount, BagPurchase — none are
   * queried here (approved design review, Phase 3/6).
   *
   * Balance always computed from records, never stored — same principle as
   * getClientLedger()'s CONSTRAINT 15 note.
   */
  async getSupplierLedger(
    supplierId: string,
    filters: { dateFrom?: string; dateTo?: string },
  ) {
    const dateFilter = buildDateFilter(filters.dateFrom, filters.dateTo);

    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundException({ error: 'Supplier not found', code: 'NOT_FOUND' });

    const rate = new Decimal(await this.settingsService.getExchangeRate());
    const toUsd = (amount: Decimal, currency: string): Decimal =>
      currency === 'LBP' ? (rate.gt(0) ? amount.div(rate) : new Decimal(0)) : amount;

    // ── Opening balance — aggregate of all purchases and payments strictly BEFORE
    // dateFrom. Zero when no start-date filter is supplied.
    let openingBalance = new Decimal(0);
    if (dateFilter?.gte) {
      const [priorLines, priorLots, priorPayments] = await Promise.all([
        this.prisma.containerProductLine.findMany({
          where: { supplierId, createdAt: { lt: dateFilter.gte } },
          select: { paidBags: true, kgPerBag: true, pricePerTon: true },
        }),
        this.prisma.stockLot.findMany({
          where: { supplierId, source: 'direct', dateReceived: { lt: dateFilter.gte } },
          select: { kgReceived: true, costPerKg: true },
        }),
        this.prisma.supplierPayment.findMany({
          where: { supplierId, date: { lt: dateFilter.gte } },
          select: { amount: true, currency: true },
        }),
      ]);

      const priorLineTotal = priorLines.reduce((sum, l) => {
        const tonnage = new Decimal(l.paidBags).mul(new Decimal(l.kgPerBag.toString())).div(1000);
        return sum.plus(tonnage.mul(new Decimal(l.pricePerTon.toString())));
      }, new Decimal(0));
      const priorLotTotal = priorLots.reduce(
        (sum, lot) => sum.plus(new Decimal(lot.kgReceived.toString()).mul(new Decimal(lot.costPerKg.toString()))),
        new Decimal(0),
      );
      const priorPaymentTotal = priorPayments.reduce(
        (sum, p) => sum.plus(toUsd(new Decimal(p.amount.toString()), p.currency)),
        new Decimal(0),
      );

      openingBalance = priorLineTotal.plus(priorLotTotal).minus(priorPaymentTotal);
    }

    // ── Period entries ────────────────────────────────────────────────────────
    // containerProductLine.createdAt is a genuine DateTime column — Asia/Beirut
    // boundaries. stockLot.dateReceived and supplierPayment.date are @db.Date —
    // plain gte/lte, unchanged. None pass `dateFilter` wholesale (see getClientLedger).
    const [productLines, directLots, payments] = await Promise.all([
      this.prisma.containerProductLine.findMany({
        where: { supplierId, ...(dateFilter ? { createdAt: { gte: dateFilter.businessGte, lt: dateFilter.businessLt } } : {}) },
        select: {
          id: true, charcoalType: true, grade: true, paidBags: true, kgPerBag: true,
          pricePerTon: true, createdAt: true,
          container: { select: { id: true, number: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.stockLot.findMany({
        // NOTE: StockLot has no displayId column (unlike Invoice/Payment/StockExit) —
        // the frontend falls back to a truncated UUID, same as it already does for
        // any client-ledger entry with a null displayId.
        where: { supplierId, source: 'direct', ...(dateFilter ? { dateReceived: { gte: dateFilter.gte, lte: dateFilter.lte } } : {}) },
        select: {
          id: true, charcoalType: true, grade: true,
          kgReceived: true, costPerKg: true, dateReceived: true,
        },
        orderBy: { dateReceived: 'asc' },
      }),
      this.prisma.supplierPayment.findMany({
        where: { supplierId, ...(dateFilter ? { date: { gte: dateFilter.gte, lte: dateFilter.lte } } : {}) },
        select: { id: true, displayId: true, date: true, amount: true, currency: true, method: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    type EntryItem =
      | { kind: 'productLine'; date: Date; id: string; amount: Decimal;
          charcoalType: string; grade: string; paidBags: number;
          containerId: string | null; containerNumber: string | null }
      | { kind: 'directLot'; date: Date; id: string;
          amount: Decimal; charcoalType: string; grade: string; kgReceived: string }
      | { kind: 'payment'; date: Date; id: string; displayId: string | null;
          amount: Decimal; method: string };

    const items: EntryItem[] = [
      ...productLines.map((line) => {
        const tonnage = new Decimal(line.paidBags).mul(new Decimal(line.kgPerBag.toString())).div(1000);
        return {
          kind:            'productLine' as const,
          date:            line.createdAt,
          id:              line.id,
          amount:          tonnage.mul(new Decimal(line.pricePerTon.toString())),
          charcoalType:    line.charcoalType,
          grade:           line.grade,
          paidBags:        line.paidBags,
          containerId:     line.container?.id ?? null,
          containerNumber: line.container?.number ?? null,
        };
      }),
      ...directLots.map((lot) => ({
        kind:         'directLot' as const,
        date:         lot.dateReceived,
        id:           lot.id,
        amount:       new Decimal(lot.kgReceived.toString()).mul(new Decimal(lot.costPerKg.toString())),
        charcoalType: lot.charcoalType,
        grade:        lot.grade,
        kgReceived:   lot.kgReceived.toString(),
      })),
      ...payments.map((pmt) => ({
        kind:      'payment' as const,
        date:      pmt.date instanceof Date ? pmt.date : new Date(pmt.date),
        id:        pmt.id,
        displayId: pmt.displayId,
        amount:    toUsd(new Decimal(pmt.amount.toString()), pmt.currency),
        method:    pmt.method as string,
      })),
    ];

    // Chronological; purchases (either source) before payments on the same
    // timestamp — mirrors getClientLedger()'s invoice-before-payment tie-break.
    items.sort((a, b) => {
      const diff = a.date.getTime() - b.date.getTime();
      if (diff !== 0) return diff;
      if (a.kind !== 'payment' && b.kind === 'payment') return -1;
      if (a.kind === 'payment' && b.kind !== 'payment') return 1;
      return 0;
    });

    // ── Running balance fold ─────────────────────────────────────────────────
    let runningBalance = new Decimal(openingBalance);
    let totalPurchased = new Decimal(0);
    let totalPaid      = new Decimal(0);

    const entries = items.map((item) => {
      if (item.kind === 'payment') {
        runningBalance = runningBalance.minus(item.amount);
        totalPaid      = totalPaid.plus(item.amount);
        return {
          date:           item.date,
          type:           'payment' as const,
          reference:      item.id,
          displayId:      item.displayId,
          description:    this.buildPaymentDescription(item.method),
          debit:          '0.00',
          credit:         item.amount.toFixed(2),
          runningBalance: runningBalance.toFixed(2),
        };
      }

      runningBalance = runningBalance.plus(item.amount);
      totalPurchased = totalPurchased.plus(item.amount);

      if (item.kind === 'productLine') {
        return {
          date:           item.date,
          type:           'purchase' as const,
          sourceType:     'container' as const,
          reference:      item.containerId ?? item.id,
          displayId:      item.containerNumber,
          description:    this.buildProductLineDescription(item.containerNumber, item.charcoalType, item.grade, item.paidBags),
          debit:          item.amount.toFixed(2),
          credit:         '0.00',
          runningBalance: runningBalance.toFixed(2),
        };
      }

      return {
        date:           item.date,
        type:           'purchase' as const,
        sourceType:     'direct' as const,
        reference:      item.id,
        displayId:      null, // StockLot has no displayId column
        description:    this.buildDirectLotDescription(item.charcoalType, item.grade, item.kgReceived),
        debit:          item.amount.toFixed(2),
        credit:         '0.00',
        runningBalance: runningBalance.toFixed(2),
      };
    });

    return {
      supplierId,
      summary: {
        totalPurchased: totalPurchased.toFixed(2),
        totalPaid:      totalPaid.toFixed(2),
        outstanding:    runningBalance.toFixed(2),
        openingBalance: openingBalance.toFixed(2),
      },
      entries,
    };
  }

  /**
   * Physical count — returns all PackedStock records grouped by bag type.
   * Owner submits actual counts; discrepancies trigger StockAdjustment creation (CONSTRAINT 13).
   * packedStock is a dimension table (SKU count), not a transaction-history table — no OOM risk.
   */
  async getPhysicalCount() {
    const packedStocks = await this.prisma.packedStock.findMany({
      select: {
        id:        true,
        bagTypeId: true,
        lotId:     true,
        quantity:  true,
        bagType:   { select: { name: true } },
      },
      orderBy: [{ bagType: { name: 'asc' } }, { createdAt: 'asc' }],
    });

    const byBagType: Record<
      string,
      { bagTypeId: string; bagTypeName: string; items: { packedStockId: string; lotId: string; quantity: number }[] }
    > = {};

    for (const ps of packedStocks) {
      if (!byBagType[ps.bagTypeId]) {
        byBagType[ps.bagTypeId] = { bagTypeId: ps.bagTypeId, bagTypeName: ps.bagType.name, items: [] };
      }
      byBagType[ps.bagTypeId].items.push({ packedStockId: ps.id, lotId: ps.lotId, quantity: ps.quantity });
    }

    return { generatedAt: new Date(), packedStock: Object.values(byBagType) };
  }

  /**
   * Submit physical count — CONSTRAINT 13.
   * No silent auto-correction: every mismatch produces a StockAdjustment record.
   */
  async submitPhysicalCount(dto: SubmitPhysicalCountDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { clerkId: userId } });
      if (!user) throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });

      const results = await Promise.all(
        dto.items.map(async (item) => {
          const ps = await tx.packedStock.findUnique({ where: { id: item.packedStockId } });
          if (!ps) {
            throw new NotFoundException({
              error: `PackedStock ${item.packedStockId} not found`,
              code: 'NOT_FOUND',
            });
          }
          if (item.actualQuantity === ps.quantity) return null;

          // BUG-E (P2): a physical count must not strand reservations — the counted total
          // cannot drop below bags already reserved for pending shipments.
          if (item.actualQuantity < ps.reservedQuantity) {
            throw new BadRequestException({
              error: `Counted quantity ${item.actualQuantity} is below reserved ${ps.reservedQuantity} for PackedStock ${ps.id}`,
              code: 'CONSTRAINT_VIOLATION',
            });
          }

          // qtyBefore is resolved from the LIVE row (ps.quantity), never from the client.
          const qtyBefore  = new Decimal(ps.quantity);
          const qtyAfter   = new Decimal(item.actualQuantity);
          const difference = qtyAfter.minus(qtyBefore);

          // BUG-G (P4): apply the delta atomically against the live value, never an absolute set.
          await tx.packedStock.update({
            where: { id: ps.id },
            data: { quantity: { increment: difference.toNumber() } },
          });

          return tx.stockAdjustment.create({
            data: {
              adjustmentType: 'packed_stock',
              packedStockId:  ps.id,
              qtyBefore:      qtyBefore.toFixed(3),
              qtyAfter:       qtyAfter.toFixed(3),
              difference:     difference.toFixed(3),
              reason:         'physical count',
              countedById:    user.id,
              approvedById:   user.id,
              date:           new Date(),
            },
          });
        })
      );

      const adjustments = results.filter(Boolean);
      return { adjustmentsCreated: adjustments.length, details: adjustments };
    });
  }

  /**
   * Unified activity feed — most-recent events from all domains, merged in memory
   * after pulling a bounded slice (PER_SOURCE rows) from each source.
   * In-memory merge is required because events span different tables; the per-source
   * take keeps memory usage O(limit).
   */
  async getActivity(limit: number) {
    const PER_SOURCE = Math.max(limit, 20);

    const [packingSessions, shipments, payments, invoices, orders, fillJobs, containers, exits] =
      await Promise.all([
        this.prisma.packingSession.findMany({
          take: PER_SOURCE,
          orderBy: { startedAt: 'desc' },
          select: {
            id: true, bagsOutput: true, kgConsumed: true, startedAt: true,
            workerEntity: { select: { name: true } },
            worker:       { select: { name: true } },
          },
        }),
        this.prisma.shipment.findMany({
          where:   { status: 'delivered' },
          take:    PER_SOURCE,
          orderBy: { deliveredAt: 'desc' },
          select: {
            id: true, deliveredAt: true, updatedAt: true, actualKg: true,
            order: { select: { client: { select: { name: true } } } },
            bags:  { select: { quantity: true } },
          },
        }),
        this.prisma.payment.findMany({
          take:    PER_SOURCE,
          orderBy: { createdAt: 'desc' },
          select: { id: true, amount: true, currency: true, method: true, createdAt: true, client: { select: { name: true } } },
        }),
        this.prisma.invoice.findMany({
          where:   { issuedAt: { not: null } },
          take:    PER_SOURCE,
          orderBy: { issuedAt: 'desc' },
          select: { id: true, total: true, currency: true, status: true, issuedAt: true, client: { select: { name: true } } },
        }),
        this.prisma.clientOrder.findMany({
          take:    PER_SOURCE,
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, charcoalType: true, grade: true, totalKgRequested: true, createdAt: true, client: { select: { name: true } } },
        }),
        this.prisma.fillJob.findMany({
          take:    PER_SOURCE,
          orderBy: { createdAt: 'desc' },
          select: { id: true, totalBags: true, totalCharcoalKg: true, createdAt: true, client: { select: { name: true } } },
        }),
        this.prisma.container.findMany({
          where:   { status: 'arrived' },
          take:    PER_SOURCE,
          orderBy: { updatedAt: 'desc' },
          select: { id: true, number: true, updatedAt: true, supplier: { select: { name: true } } },
        }),
        this.prisma.stockExit.findMany({
          take:    PER_SOURCE,
          orderBy: { createdAt: 'desc' },
          select: { id: true, exitType: true, quantity: true, kgQuantity: true, createdAt: true, client: { select: { name: true } } },
        }),
      ]);

    type ActivityItem = { id: string; type: string; title: string; subtitle: string; timestamp: string };
    const items: ActivityItem[] = [];

    for (const s of packingSessions) {
      const totalBags  = (s.bagsOutput as Array<{ qty: number }>).reduce((acc, b) => acc + (b.qty ?? 0), 0);
      const workerName = s.workerEntity?.name ?? s.worker?.name ?? 'Unknown worker';
      items.push({ id: `packing-${s.id}`, type: 'packing',
        title:     `Packing session — ${totalBags} bag${totalBags !== 1 ? 's' : ''}`,
        subtitle:  `Worker: ${workerName} · ${parseFloat(s.kgConsumed.toString()).toFixed(0)} kg charcoal in`,
        timestamp: s.startedAt.toISOString() });
    }
    for (const sh of shipments) {
      const totalBags = sh.bags.reduce((acc, b) => acc + b.quantity, 0);
      const ts = sh.deliveredAt ?? sh.updatedAt;
      items.push({ id: `delivery-${sh.id}`, type: 'delivery',
        title:    `Delivery confirmed — ${sh.order?.client?.name ?? 'Unknown client'}`,
        subtitle: `${totalBags} bag${totalBags !== 1 ? 's' : ''}${sh.actualKg ? ` · ${parseFloat(sh.actualKg.toString()).toFixed(0)} kg` : ''}`,
        timestamp: ts.toISOString() });
    }
    for (const p of payments) {
      items.push({ id: `payment-${p.id}`, type: 'payment',
        title:    `Payment received — ${p.client?.name ?? 'Unknown'}`,
        subtitle: `$${parseFloat(p.amount.toString()).toFixed(0)} ${p.currency} · ${p.method}`,
        timestamp: p.createdAt.toISOString() });
    }
    for (const inv of invoices) {
      items.push({ id: `invoice-${inv.id}`, type: 'invoice',
        title:    `Invoice issued — ${inv.client?.name ?? 'Unknown'}`,
        subtitle: `$${parseFloat(inv.total.toString()).toFixed(0)} ${inv.currency} · ${inv.status}`,
        timestamp: inv.issuedAt!.toISOString() });
    }
    for (const o of orders) {
      items.push({ id: `order-${o.id}`, type: 'order',
        title:    `Order ${o.status.replace(/_/g, ' ')} — ${o.client?.name ?? 'Unknown'}`,
        subtitle: `${o.charcoalType} · ${o.grade} · ${parseFloat(o.totalKgRequested.toString()).toFixed(0)} kg`,
        timestamp: o.createdAt.toISOString() });
    }
    for (const fj of fillJobs) {
      items.push({ id: `fill-${fj.id}`, type: 'fill',
        title:    `Fill job — ${fj.client?.name ?? 'Unknown'}`,
        subtitle: `${fj.totalBags} bag${fj.totalBags !== 1 ? 's' : ''} · ${parseFloat(fj.totalCharcoalKg.toString()).toFixed(0)} kg charcoal`,
        timestamp: fj.createdAt.toISOString() });
    }
    for (const c of containers) {
      items.push({ id: `container-${c.id}`, type: 'container',
        title:    `Container arrived — ${c.number}`,
        subtitle: c.supplier?.name ?? 'Unknown supplier',
        timestamp: c.updatedAt.toISOString() });
    }
    for (const ex of exits) {
      const qty = ex.quantity != null
        ? `${ex.quantity} bag${ex.quantity !== 1 ? 's' : ''}`
        : ex.kgQuantity != null ? `${parseFloat(ex.kgQuantity.toString()).toFixed(0)} kg` : '';
      const clientPart = ex.client?.name ? ` — ${ex.client.name}` : '';
      items.push({ id: `exit-${ex.id}`, type: 'exit',
        title:    `Stock exit · ${ex.exitType.replace(/_/g, ' ')}${clientPart}`,
        subtitle: qty,
        timestamp: ex.createdAt.toISOString() });
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items.slice(0, limit);
  }

  /**
   * AR (accounts-receivable) summary — all four aggregates computed in SQL
   * over the full table so the numbers are correct regardless of row count.
   *
   * Four parallel queries; no rows fetched into memory.
   *
   * Accessible to owner, accountant, and sales_rep (matches invoice list visibility).
   */
  async getArSummary() {
    // Every figure below sums across ALL clients regardless of their individual
    // Client.currency — Invoice.total and Payment.amount are per-row currency-
    // tagged (Currency is independently settable per invoice/payment, not forced
    // to match Client.currency), so a raw SUM() mixes USD and LBP magnitudes as
    // if they were the same unit (an LBP client's 45,000,000 added straight to a
    // USD client's 500). Every LBP row is converted to USD here — invoices via
    // their own issue-time rate snapshot (same BUG-J pattern getProfitLoss
    // already uses), payments via the current global rate (Payment has no
    // per-row snapshot column) — before any SUM(), mirroring how every other
    // multi-currency aggregate in this file (getProfitLoss, getSupplierLedger)
    // already converts before summing.
    const rate = new Decimal(await this.settingsService.getExchangeRate());

    const [invoicedAgg, collectedAgg, outstandingResult, overdueResult] = await Promise.all([
      // totalInvoiced: sum of all issued/partially_paid/paid invoice totals, USD-converted
      this.prisma.$queryRaw<[{ total_invoiced: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(
          CASE WHEN "currency" = 'LBP'
               THEN "total"::numeric / NULLIF(COALESCE("exchangeRateSnapshot", ${rate.toString()}::numeric), 0)
               ELSE "total"::numeric
          END
        ), 0)::text AS total_invoiced
        FROM "invoices"
        WHERE "status" NOT IN ('draft', 'cancelled')
      `),

      // totalCollected: sum of every payment recorded, USD-converted
      this.prisma.$queryRaw<[{ total_collected: string }]>(Prisma.sql`
        SELECT COALESCE(SUM(
          CASE WHEN "currency" = 'LBP'
               THEN "amount"::numeric / NULLIF(${rate.toString()}::numeric, 0)
               ELSE "amount"::numeric
          END
        ), 0)::text AS total_collected
        FROM "payments"
      `),

      // totalOutstanding: computed per-client the same way as ClientBalanceService
      // (CONSTRAINT 15) — invoiced minus ALL of that client's payments, never from
      // Invoice.paidAmount. paidAmount is only updated when a payment is linked to
      // a specific invoice via invoiceId, which is optional (CreatePaymentDto):
      // a payment recorded against a client without an invoiceId still counts
      // toward what they've paid, but never clears any invoice's paidAmount. The
      // old `SUM(total - paidAmount)` therefore overstated outstanding balance by
      // exactly the amount of any unlinked payment. Balances are floored at 0 per
      // client so a credit (over-payment) on one client can't net against — and
      // hide — another client's genuine balance. Both subqueries convert LBP rows
      // to USD (same rule as above) before summing per client.
      // open_count keeps its original, unrelated meaning: invoices not marked paid.
      this.prisma.$queryRaw<[{ total_outstanding: string; open_count: string }]>(Prisma.sql`
        WITH client_balances AS (
          SELECT
            c.id,
            COALESCE(inv.invoiced, 0) - COALESCE(pmt.paid, 0) AS balance
          FROM "clients" c
          LEFT JOIN (
            SELECT "clientId", SUM(
              CASE WHEN "currency" = 'LBP'
                   THEN "total"::numeric / NULLIF(COALESCE("exchangeRateSnapshot", ${rate.toString()}::numeric), 0)
                   ELSE "total"::numeric
              END
            ) AS invoiced
            FROM "invoices"
            WHERE "status" NOT IN ('draft', 'cancelled')
            GROUP BY "clientId"
          ) inv ON inv."clientId" = c.id
          LEFT JOIN (
            SELECT "clientId", SUM(
              CASE WHEN "currency" = 'LBP'
                   THEN "amount"::numeric / NULLIF(${rate.toString()}::numeric, 0)
                   ELSE "amount"::numeric
              END
            ) AS paid
            FROM "payments"
            GROUP BY "clientId"
          ) pmt ON pmt."clientId" = c.id
        )
        SELECT
          COALESCE((SELECT SUM(GREATEST(balance, 0)) FROM client_balances), 0)::text AS total_outstanding,
          (SELECT COUNT(*) FROM "invoices" WHERE "status" NOT IN ('paid', 'cancelled', 'draft'))::text AS open_count
      `),

      // totalOverdue + overdue count + oldest overdue age. paidAmount is always in
      // the same currency as that invoice's own total (updated in-place by
      // PaymentAllocationService in the invoice's own currency), so converting the
      // combined (total - paidAmount) by the same per-row rate is correct.
      this.prisma.$queryRaw<[{ total_overdue: string; overdue_count: string; oldest_days: string }]>(Prisma.sql`
        SELECT
          COALESCE(SUM(
            CASE WHEN "currency" = 'LBP'
                 THEN ("total" - "paidAmount")::numeric / NULLIF(COALESCE("exchangeRateSnapshot", ${rate.toString()}::numeric), 0)
                 ELSE ("total" - "paidAmount")::numeric
            END
          ), 0)::text                                                                                       AS total_overdue,
          COUNT(*)::text                                                                                    AS overdue_count,
          COALESCE(MAX(GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - "dueDate")) / 86400))), 0)::text      AS oldest_days
        FROM "invoices"
        WHERE "status" IN ('issued', 'partially_paid')
          AND "dueDate" IS NOT NULL
          AND "dueDate" < NOW()
      `),
    ]);

    return {
      totalInvoiced:    new Decimal(invoicedAgg[0]?.total_invoiced   ?? '0').toFixed(2),
      totalCollected:   new Decimal(collectedAgg[0]?.total_collected ?? '0').toFixed(2),
      totalOutstanding: new Decimal(outstandingResult[0]?.total_outstanding ?? '0').toFixed(2),
      totalOverdue:     new Decimal(overdueResult[0]?.total_overdue          ?? '0').toFixed(2),
      openInvoiceCount: Number(outstandingResult[0]?.open_count  ?? 0),
      overdueCount:     Number(overdueResult[0]?.overdue_count   ?? 0),
      oldestOverdueDays: Number(overdueResult[0]?.oldest_days    ?? 0),
    };
  }

  // ===========================================================================
  // Full Day Report (forensic audit, 2026-09) — a read-only, printable
  // end-of-day business summary. Every figure below is READ from an existing
  // authoritative model/service — nothing here invents a new accounting rule,
  // and this method never calls create/update/upsert/delete on anything (see
  // the read-only-proof test in reports.service.spec.ts).
  //
  // Date/timezone: uses buildDateFilter()/zonedMidnightUtc() exactly like
  // every other report in this file. @db.Date columns (payments.date,
  // stock_exits.date, cash_handovers.date, general_expenses.date,
  // worker_costs.date, stock_lots.dateReceived, packing_sessions.date) are
  // bounded by the plain gte/lte UTC-midnight pair; genuine DateTime columns
  // (invoices.issuedAt, client_orders.createdAt) are bounded by the
  // Asia/Beirut businessGte/businessLt pair — never mixed.
  //
  // Deduplication: a "sale" is either ONE Invoice (source ORDER or
  // WAREHOUSE_SALE — both use the exact SAME accrual query getProfitLoss()/
  // getArSummary() already use: issuedAt in range, status ∉ {draft,
  // cancelled}) or ONE anonymous (no client, no invoice) walk-in StockExit.
  // Deliberately NOT StockExitsService.findAllGrouped() — that method groups
  // by COALESCE(invoiceId, id), but an ORDER invoice's StockExit rows never
  // carry invoiceId at all (only WalkInSalesService ever sets it — see
  // StockExit.invoiceId's schema doc comment), so a normal Client Order's
  // FIFO-drain exits would each show up as their own zero-amount "on
  // account" row instead of the one real Invoice.total sale it actually is.
  // Reading Invoice directly sidesteps that mismatch entirely and needs no
  // StockExit join for the (by far the most common) invoiced sale path.
  // buildInvoiceDescription() is the SAME method the Client Statement of
  // Account already uses, so a sale's description here can never disagree
  // with what getClientLedger() would show for the identical invoice.
  // Client receivables reuse ClientBalanceService.computeBalance()'s exact
  // formula (date-bounded), the SAME balance figure shown everywhere else in
  // this app.
  //
  // General expenses deliberately do NOT use buildGeneralExpenseWhere()'s
  // "Option B" forward-recurrence semantics (confirmed business decision,
  // Full Day Report audit Phase 1 §21.1) — a recurring expense appears ONLY
  // on its own recorded `date`, never repeated onto every later day.
  //
  // Client receivables are scoped to clients with activity on the report day
  // only (confirmed business decision, Phase 1 §21.2) — an inactive client
  // never appears, even though its balance is still computable.
  // ===========================================================================

  async getDailyReport(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
      throw new BadRequestException({ error: 'date must be a valid YYYY-MM-DD string', code: 'VALIDATION_ERROR' });
    }

    // Both bounds resolved from the SAME date — gives the exact one-calendar-day
    // window for every column kind in one call (gte/lte for @db.Date columns,
    // businessGte/businessLt for genuine DateTime columns).
    const day = buildDateFilter(date, date)!;
    const dateColFilter = { gte: day.gte!, lte: day.lte! };
    const businessFilter = { gte: day.businessGte!, lt: day.businessLt! };

    const rate = new Decimal(await this.settingsService.getExchangeRate());
    const toUsd = (amount: Decimal, currency: string): Decimal =>
      currency === 'LBP' ? (rate.gt(0) ? amount.div(rate) : new Decimal(0)) : amount;
    /** Consistent 2-decimal money formatting for every line-item field below. */
    const fmt2 = (v: { toString(): string }): string => new Decimal(v.toString()).toFixed(2);

    const [
      issuedInvoicesToday,
      anonymousWalkInsToday,
      payments,
      cashHandoverExpenses,
      generalExpenses,
      workerCosts,
      cashHandovers,
      ordersCreated,
      deliveredOrderExits,
      allExitsToday,
      stockLotsReceived,
      packingSessions,
      accountEntriesToday,
      onAccount,
    ] = await Promise.all([
      // Sales, part 1 — every invoiced sale (ORDER or WAREHOUSE_SALE), same
      // accrual definition getProfitLoss()/getArSummary() already use. One
      // row per Invoice — never touches StockExit, so a multi-lot FIFO drain
      // can never inflate this.
      this.prisma.invoice.findMany({
        where: { issuedAt: businessFilter, status: { notIn: ['draft', 'cancelled'] } },
        include: {
          client: { select: { id: true, name: true } },
          order: { select: { location: { select: { name: true } } } },
        },
        orderBy: { issuedAt: 'asc' },
      }),
      // Sales, part 2 — anonymous (no client, no invoice) walk-in exits,
      // where StockExit.amount genuinely IS the sale price (see
      // StockExitsService.getWarehouseCashSummary()'s own doc comment for
      // why this is the one case that's authoritative).
      this.prisma.stockExit.findMany({
        where: { exitType: 'walk_in', clientId: null, invoiceId: null, amount: { not: null }, date: dateColFilter },
        select: {
          id: true, date: true, amount: true, currency: true, recipient: true, quantity: true, kgQuantity: true,
          bagType: { select: { name: true } },
          lot: { select: { charcoalType: true, grade: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { date: dateColFilter },
        orderBy: { createdAt: 'asc' },
        include: {
          client: { select: { id: true, name: true } },
          receiver: { select: { id: true, name: true } },
          allocations: {
            select: { amount: true, invoiceId: true, invoice: { select: { id: true, displayId: true, source: true } } },
          },
        },
      }),
      this.prisma.cashHandoverExpense.findMany({
        where: { cashHandover: { date: dateColFilter } },
        include: {
          cashHandover: {
            select: { id: true, date: true, receiverId: true, receiverName: true, receiver: { select: { id: true, name: true } } },
          },
          category: { select: { id: true, name: true } },
        },
      }),
      // Full Day Report audit decision (Phase 1 §21.1): STRICT single-day
      // filter — deliberately bypasses buildGeneralExpenseWhere()'s
      // recurring-forward semantics used by the Expenses page / P&L.
      this.prisma.generalExpense.findMany({ where: { date: dateColFilter }, orderBy: { date: 'asc' } }),
      // Accrued wage cost only (WorkerCost) — WorkerPayment is a cash
      // SETTLEMENT of already-accrued labor, never a second expense line
      // (same exclusion getProfitLoss() already documents and applies).
      this.prisma.workerCost.findMany({
        where: { date: dateColFilter },
        include: { worker: { select: { id: true, name: true } } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.cashHandover.findMany({
        where: { date: dateColFilter },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        include: {
          receiver: { select: { id: true, name: true } },
          loggedBy: { select: { id: true, name: true } },
          expenses: { include: { category: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.clientOrder.findMany({
        where: { createdAt: businessFilter },
        include: { client: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      // Delivery-day signal (Phase 1 §3 finding): ClientOrder has no
      // deliveredAt column, and the now-common no-shipment path never creates
      // a Shipment either — the exitType='order' StockExit row's own `date`
      // (stamped at delivery time by both drainShipment() and
      // drainPackedStockDirect()) is the one signal that works uniformly for
      // BOTH delivery paths. `distinct` collapses a multi-lot FIFO drain
      // (several StockExit rows, one order) to one order.
      this.prisma.stockExit.findMany({
        where: { exitType: 'order', date: dateColFilter, orderId: { not: null } },
        select: {
          orderId: true,
          order: {
            select: {
              id: true, displayId: true, status: true,
              client: { select: { id: true, name: true } },
              location: { select: { id: true, name: true } },
            },
          },
        },
        distinct: ['orderId'],
      }),
      // Every exit type, for the stock-movement section — grouped in-memory
      // below (small, single-day, bounded result set; the charcoal type/grade
      // join needed for grouping isn't expressible in a plain Prisma groupBy).
      this.prisma.stockExit.findMany({
        where: { date: dateColFilter },
        select: {
          exitType: true, quantity: true, kgQuantity: true,
          lot: { select: { charcoalType: true, grade: true } },
          packedStock: { select: { lot: { select: { charcoalType: true, grade: true } } } },
        },
      }),
      this.prisma.stockLot.findMany({
        where: { dateReceived: dateColFilter },
        include: { supplier: { select: { id: true, name: true } } },
      }),
      this.prisma.packingSession.findMany({
        where: { date: dateColFilter },
        include: { worker: { select: { id: true, name: true } }, workerEntity: { select: { id: true, name: true } } },
      }),
      this.prisma.accountEntry.findMany({
        where: { date: dateColFilter },
        include: { account: { include: { user: { select: { id: true, name: true } } } } },
      }),
      // Existing authoritative "unpaid registered-client walk-in" exception
      // detector — reused as-is, never re-derived.
      this.stockExitsService.getOnAccountCount(date),
    ]);

    // ── Sales — one row per Invoice, plus one row per anonymous walk-in exit (see this method's own doc comment above) ──
    const invoiceSales = issuedInvoicesToday.map((inv) => ({
      id: inv.id,
      invoiceId: inv.id,
      invoiceDisplayId: inv.displayId,
      source: inv.source,
      date: inv.issuedAt,
      clientId: inv.clientId,
      client: inv.client,
      currency: inv.currency,
      description: this.buildInvoiceDescription(inv.source, inv.lines as any[], inv.order?.location?.name),
      saleTotal: fmt2(inv.total),
      paidAmount: fmt2(inv.paidAmount),
      remaining: fmt2(new Decimal(inv.total.toString()).minus(inv.paidAmount.toString())),
      status: inv.status,
    }));
    const anonymousSales = anonymousWalkInsToday.map((exit) => ({
      id: exit.id,
      invoiceId: null,
      invoiceDisplayId: null,
      source: 'ANONYMOUS' as const,
      date: exit.date,
      clientId: null,
      client: null,
      currency: exit.currency,
      description: exit.lot
        ? `Anonymous walk-in · ${exit.kgQuantity} kg ${exit.lot.charcoalType} ${exit.lot.grade}${exit.recipient ? ` — ${exit.recipient}` : ''}`
        : `Anonymous walk-in · ${exit.quantity ?? 0}× ${exit.bagType?.name ?? 'bags'}${exit.recipient ? ` — ${exit.recipient}` : ''}`,
      saleTotal: fmt2(exit.amount!),
      paidAmount: fmt2(exit.amount!),
      remaining: '0.00',
      status: 'recorded',
    }));
    const sales = [...invoiceSales, ...anonymousSales];

    // ── Summary (USD-converted totals — same conversion convention getArSummary/getProfitLoss already use) ──
    const salesTotalUsd = sales.reduce(
      (sum, s) => sum.plus(toUsd(new Decimal(s.saleTotal), s.currency)),
      new Decimal(0),
    );
    const cashCollectedUsd = payments.reduce(
      (sum, p) => sum.plus(toUsd(new Decimal(p.amount.toString()), p.currency)),
      new Decimal(0),
    );
    const handoverExpenseTotal = cashHandoverExpenses.reduce((s, e) => s.plus(e.amount.toString()), new Decimal(0));
    const generalExpenseTotal = generalExpenses.reduce((s, e) => s.plus(e.amount.toString()), new Decimal(0));
    const workerCostTotal = workerCosts.reduce((s, w) => s.plus(w.amount.toString()), new Decimal(0));
    const handedOverTotal = cashHandovers.reduce(
      (s, h) => s.plus(h.handedAmt.toString()).plus(h.expenses.reduce((es, e) => es.plus(e.amount.toString()), new Decimal(0))),
      new Decimal(0),
    );

    // ── Client receivables (active-only, opening/today/closing roll-forward) ──
    const clientReceivables = await this.getDailyClientReceivables(date, businessFilter, dateColFilter);

    // ── Stock movement — grouped by exitType + charcoalType + grade ──
    const stockOut = this.groupStockMovement(allExitsToday);
    const stockIn = {
      rawLots: stockLotsReceived.map((l) => ({
        lotId: l.id, charcoalType: l.charcoalType, grade: l.grade,
        supplier: l.supplier.name, kgReceived: l.kgReceived.toString(), source: l.source,
      })),
      packedFromSessions: packingSessions.map((s) => ({
        sessionId: s.id,
        worker: s.workerEntity?.name ?? s.worker?.name ?? 'Unknown',
        kgConsumed: s.kgConsumed.toString(), kgOutputTotal: s.kgOutputTotal.toString(),
        bagsOutput: s.bagsOutput,
      })),
    };

    // ── Employee summary — from the SAME AccountEntry ledger LedgerWriteService writes ──
    const employeeSummary = await this.getDailyEmployeeSummary(accountEntriesToday, dateColFilter);

    // ── Exceptions — only conditions reliably derivable from existing data ──
    const exceptions = await this.getDailyExceptions(date, businessFilter, handedOverTotal, cashHandovers, payments, onAccount, deliveredOrderExits);

    return {
      date,
      generatedAt: new Date().toISOString(),
      summary: {
        totalSales: salesTotalUsd.toFixed(2),
        totalCashCollected: cashCollectedUsd.toFixed(2),
        totalCashHandoverExpenses: handoverExpenseTotal.toFixed(2),
        totalGeneralExpenses: generalExpenseTotal.toFixed(2),
        totalWorkerCost: workerCostTotal.toFixed(2),
        totalHandedOver: handedOverTotal.toFixed(2),
        saleCount: sales.length,
        paymentCount: payments.length,
      },
      sales,
      payments: payments.map((p) => ({
        id: p.id, displayId: p.displayId, client: p.client, amount: fmt2(p.amount),
        currency: p.currency, method: p.method, date: p.date, receiver: p.receiver,
        allocations: p.allocations.map((a) => ({
          amount: fmt2(a.amount), invoiceId: a.invoiceId,
          invoiceDisplayId: a.invoice.displayId, invoiceSource: a.invoice.source,
        })),
      })),
      expenses: {
        cashHandoverExpenses: cashHandoverExpenses.map((e) => ({
          id: e.id, amount: fmt2(e.amount), category: e.category?.name ?? e.description,
          employee: e.cashHandover.receiver ?? { id: e.cashHandover.receiverId, name: e.cashHandover.receiverName },
          cashHandoverId: e.cashHandoverId,
        })),
        generalExpenses: generalExpenses.map((e) => ({
          id: e.id, description: e.description, amount: fmt2(e.amount),
          category: e.category, isRecurring: e.isRecurring, notes: e.notes,
        })),
        workerCosts: workerCosts.map((w) => ({
          id: w.id, worker: w.worker, amount: fmt2(w.amount), category: w.category, notes: w.notes,
        })),
      },
      cashHandovers: cashHandovers.map((h) => ({
        id: h.id, receiver: h.receiver ?? { id: h.receiverId, name: h.receiverName },
        expectedAmt: fmt2(h.expectedAmt), handedAmt: fmt2(h.handedAmt),
        difference: fmt2(h.difference), notes: h.notes,
        expenses: h.expenses.map((e) => ({ id: e.id, category: e.category?.name ?? e.description, amount: fmt2(e.amount) })),
        settledAmount: new Decimal(h.handedAmt.toString())
          .plus(h.expenses.reduce((s, e) => s.plus(e.amount.toString()), new Decimal(0))).toFixed(2),
      })),
      orders: {
        created: ordersCreated.map((o) => ({
          id: o.id, displayId: o.displayId, client: o.client, location: o.location,
          status: o.status, charcoalType: o.charcoalType, grade: o.grade,
          totalKgRequested: o.totalKgRequested.toString(),
        })),
        delivered: deliveredOrderExits.map((e) => e.order).filter((o): o is NonNullable<typeof o> => o !== null),
      },
      stockMovement: { in: stockIn, out: stockOut },
      clientReceivables,
      employeeSummary,
      exceptions,
    };
  }

  /**
   * Client receivable roll-forward for clients with activity on `date` only
   * (confirmed business decision — Phase 1 §21.2). Opening/closing both reuse
   * ClientBalanceService.computeBalance()'s exact formula with a point-in-time
   * upper bound (never a second, divergent balance calculation) — opening is
   * "as of end of the PREVIOUS day", closing is "as of end of THIS day".
   */
  private async getDailyClientReceivables(
    date: string,
    businessFilter: { gte: Date; lt: Date },
    dateColFilter: { gte: Date; lte: Date },
  ) {
    const [invoicedClients, paidClients, fillPickupClients] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { issuedAt: businessFilter, status: { notIn: ['draft', 'cancelled'] } },
        distinct: ['clientId'],
        select: { clientId: true },
      }),
      this.prisma.payment.findMany({ where: { date: dateColFilter }, distinct: ['clientId'], select: { clientId: true } }),
      this.prisma.stockExit.findMany({
        where: { exitType: 'client_bags_fill', amount: { not: null }, date: dateColFilter, clientId: { not: null } },
        distinct: ['clientId'],
        select: { clientId: true },
      }),
    ]);
    const activeClientIds = [...new Set([
      ...invoicedClients.map((c) => c.clientId),
      ...paidClients.map((c) => c.clientId),
      ...fillPickupClients.map((c) => c.clientId!),
    ])];
    if (activeClientIds.length === 0) return [];

    const closingCutoff = buildDateFilter(undefined, date)!;
    const openingCutoff = buildDateFilter(undefined, previousDateOnlyString(date))!;
    const closingAsOf = { lte: closingCutoff.lte!, businessLt: closingCutoff.businessLt! };
    const openingAsOf = { lte: openingCutoff.lte!, businessLt: openingCutoff.businessLt! };

    const [clients, todaysInvoicesByClient, todaysPaymentsByClient] = await Promise.all([
      this.prisma.client.findMany({ where: { id: { in: activeClientIds } }, select: { id: true, name: true, currency: true } }),
      this.prisma.invoice.groupBy({
        by: ['clientId'],
        where: { clientId: { in: activeClientIds }, issuedAt: businessFilter, status: { notIn: ['draft', 'cancelled'] } },
        _sum: { total: true },
      }),
      this.prisma.payment.groupBy({
        by: ['clientId'],
        where: { clientId: { in: activeClientIds }, date: dateColFilter },
        _sum: { amount: true },
      }),
    ]);
    const chargesByClient = new Map(todaysInvoicesByClient.map((r) => [r.clientId, r._sum.total]));
    const paymentsByClient = new Map(todaysPaymentsByClient.map((r) => [r.clientId, r._sum.amount]));

    return Promise.all(clients.map(async (c) => {
      const [opening, closing] = await Promise.all([
        this.clientBalanceService.computeBalance(c.id, undefined, openingAsOf),
        this.clientBalanceService.computeBalance(c.id, undefined, closingAsOf),
      ]);
      return {
        clientId: c.id, clientName: c.name, currency: c.currency,
        openingBalance: opening.toFixed(2),
        todaysCharges: new Decimal(chargesByClient.get(c.id)?.toString() ?? '0').toFixed(2),
        todaysPayments: new Decimal(paymentsByClient.get(c.id)?.toString() ?? '0').toFixed(2),
        closingBalance: closing.toFixed(2),
      };
    }));
  }

  /** Groups a day's StockExit rows by (exitType, charcoalType, grade) — pure in-memory fold over an already date-bounded, single-day result set. */
  private groupStockMovement(
    exits: Array<{
      exitType: string; quantity: number | null; kgQuantity: Prisma.Decimal | null;
      lot: { charcoalType: string; grade: string } | null;
      packedStock: { lot: { charcoalType: string; grade: string } } | null;
    }>,
  ) {
    const byKey = new Map<string, { exitType: string; charcoalType: string; grade: string; bags: number; kg: Decimal }>();
    for (const e of exits) {
      const lot = e.lot ?? e.packedStock?.lot ?? null;
      const charcoalType = lot?.charcoalType ?? 'Unknown';
      const grade = lot?.grade ?? 'Unknown';
      const key = `${e.exitType}::${charcoalType}::${grade}`;
      const entry = byKey.get(key) ?? { exitType: e.exitType, charcoalType, grade, bags: 0, kg: new Decimal(0) };
      entry.bags += e.quantity ?? 0;
      entry.kg = entry.kg.plus(e.kgQuantity?.toString() ?? '0');
      byKey.set(key, entry);
    }
    return [...byKey.values()].map((v) => ({ ...v, kg: v.kg.toFixed(3) }));
  }

  /**
   * Per-receiver reconciliation for `date`, built entirely from AccountEntry —
   * the same ledger LedgerWriteService is the sole writer of. "Active" =
   * anyone with at least one entry dated today. `outstandingAsOfEndOfDay` is
   * deliberately NOT the live UserAccount.balance column (that's a running
   * total that only equals "end of THIS day" when the report day is today) —
   * it's the cumulative sum of this same ledger up to and including `date`.
   */
  private async getDailyEmployeeSummary(
    entriesToday: Array<{ accountId: string; amount: Prisma.Decimal; type: string; account: { userId: string; user: { id: string; name: string } } }>,
    dateColFilter: { gte: Date; lte: Date },
  ) {
    if (entriesToday.length === 0) return [];

    const byAccount = new Map<string, { receiver: { id: string; name: string }; received: Decimal; handedOver: Decimal }>();
    for (const e of entriesToday) {
      const entry = byAccount.get(e.accountId) ?? { receiver: e.account.user, received: new Decimal(0), handedOver: new Decimal(0) };
      const amt = new Decimal(e.amount.toString());
      if (e.type === 'handover') entry.handedOver = entry.handedOver.plus(amt.abs());
      else entry.received = entry.received.plus(amt);
      byAccount.set(e.accountId, entry);
    }

    const accountIds = [...byAccount.keys()];
    const cumulative = await this.prisma.accountEntry.groupBy({
      by: ['accountId'],
      where: { accountId: { in: accountIds }, date: { lte: dateColFilter.lte } },
      _sum: { amount: true },
    });
    const outstandingByAccount = new Map(cumulative.map((c) => [c.accountId, c._sum.amount]));

    return accountIds.map((accountId) => {
      const entry = byAccount.get(accountId)!;
      return {
        receiver: entry.receiver,
        receivedToday: entry.received.toFixed(2),
        handedOverToday: entry.handedOver.toFixed(2),
        outstandingAsOfEndOfDay: new Decimal(outstandingByAccount.get(accountId)?.toString() ?? '0').toFixed(2),
      };
    });
  }

  /** Only conditions reliably derivable from existing data — never a new business rule. */
  private async getDailyExceptions(
    date: string,
    businessFilter: { gte: Date; lt: Date },
    handedOverTotal: Decimal,
    cashHandovers: Array<{ id: string; difference: Prisma.Decimal; receiver: { id: string; name: string } | null; receiverName: string }>,
    payments: Array<{ id: string; method: string; receiverId: string | null; client: { id: string; name: string } }>,
    onAccount: { onAccountCount: number },
    deliveredOrderExits: Array<{ order: { id: string; displayId: string | null } | null }>,
  ) {
    const exceptions: Array<{ type: string; description: string; referenceId?: string }> = [];

    const unpaidInvoices = await this.prisma.invoice.findMany({
      where: { issuedAt: businessFilter, status: { in: ['issued', 'partially_paid'] } },
      select: { id: true, displayId: true, total: true, paidAmount: true, client: { select: { name: true } } },
    });
    for (const inv of unpaidInvoices) {
      const remaining = new Decimal(inv.total.toString()).minus(inv.paidAmount.toString());
      exceptions.push({
        type: 'unpaid_or_partial_invoice',
        description: `${inv.displayId ?? inv.id} — ${inv.client.name} — ${remaining.toFixed(2)} outstanding`,
        referenceId: inv.id,
      });
    }

    for (const h of cashHandovers) {
      const diff = new Decimal(h.difference.toString());
      if (!diff.isZero()) {
        exceptions.push({
          type: 'cash_handover_difference',
          description: `${h.receiver?.name ?? h.receiverName} — handover difference of ${diff.toFixed(2)}`,
          referenceId: h.id,
        });
      }
    }

    for (const p of payments) {
      if (['cash', 'whish', 'omt'].includes(p.method) && !p.receiverId) {
        exceptions.push({
          type: 'payment_missing_receiver',
          description: `Payment for ${p.client.name} (${p.method}) has no receiver on record`,
          referenceId: p.id,
        });
      }
    }

    if (onAccount.onAccountCount > 0) {
      exceptions.push({
        type: 'on_account_walk_in_sales',
        description: `${onAccount.onAccountCount} registered-client walk-in sale(s) today with no payment recorded yet`,
      });
    }

    const deliveredOrderIds = deliveredOrderExits.map((e) => e.order?.id).filter((id): id is string => !!id);
    if (deliveredOrderIds.length > 0) {
      const invoicedOrderIds = new Set(
        (await this.prisma.invoice.findMany({
          where: { orderId: { in: deliveredOrderIds }, status: { not: 'cancelled' } },
          select: { orderId: true },
        })).map((i) => i.orderId),
      );
      for (const e of deliveredOrderExits) {
        if (e.order && !invoicedOrderIds.has(e.order.id)) {
          exceptions.push({
            type: 'delivered_without_invoice',
            description: `Order ${e.order.displayId ?? e.order.id} was delivered today but has no invoice yet`,
            referenceId: e.order.id,
          });
        }
      }
    }

    // Cancellation is only ever recorded as a status flip (InvoicesService.cancel()) —
    // there is no dedicated cancelledAt column, so Invoice.updatedAt is the only
    // available day signal (same "no exact timestamp" limitation this report already
    // accepts for delivery-day via StockExit.date). Cancelling never reverses cash or
    // ledger entries — those simply stop accruing — so this is reported as a factual
    // status change, not a financial reversal.
    const cancelledInvoices = await this.prisma.invoice.findMany({
      where: { status: 'cancelled', updatedAt: businessFilter },
      select: { id: true, displayId: true, total: true, client: { select: { name: true } } },
    });
    for (const inv of cancelledInvoices) {
      exceptions.push({
        type: 'invoice_cancelled',
        description: `${inv.displayId ?? inv.id} — ${inv.client.name} — cancelled (${new Decimal(inv.total.toString()).toFixed(2)})`,
        referenceId: inv.id,
      });
    }

    // Same limitation as above — ShipmentsService.logReturn() has no dedicated
    // returnedAt column, only the auto-touched updatedAt. A return restores
    // physical PackedStock quantity only; it never touches the Invoice, so this
    // is never shown as a financial reversal.
    const returnedShipments = await this.prisma.shipment.findMany({
      where: { status: 'returned', updatedAt: businessFilter },
      select: { id: true, order: { select: { id: true, displayId: true, client: { select: { name: true } } } } },
    });
    for (const s of returnedShipments) {
      exceptions.push({
        type: 'shipment_returned',
        description: `Order ${s.order.displayId ?? s.order.id} — ${s.order.client.name} — shipment returned`,
        referenceId: s.order.id,
      });
    }

    return exceptions;
  }
}
