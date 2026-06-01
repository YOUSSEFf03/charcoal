import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitPhysicalCountDto } from './dto/physical-count.dto';

interface DateRangeFilter {
  gte?: Date;
  lte?: Date;
}

/** How far back to look when neither dateFrom nor dateTo is supplied. */
export const DEFAULT_LOOKBACK_DAYS = 90;

function buildDateFilter(from?: string, to?: string): DateRangeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to   ? { lte: new Date(to)   } : {}),
  };
}

/**
 * Like buildDateFilter but always returns a filter — defaults to the last
 * DEFAULT_LOOKBACK_DAYS days when neither bound is supplied.  Prevents
 * unfiltered calls from scanning the full table history.
 */
function buildDateFilterWithDefault(from?: string, to?: string): DateRangeFilter {
  if (from || to) return buildDateFilter(from, to) ?? {};
  const gte = new Date();
  gte.setDate(gte.getDate() - DEFAULT_LOOKBACK_DAYS);
  return { gte };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * P&L report — CONSTRAINT 11: restricted to owner role.
   *
   * All six components are computed server-side (no in-memory row folds):
   *   revenue       = SQL jsonb_array_elements SUM(lineTotal)  (invoices)
   *               + aggregate SUM(amount)                      (walk-in exits)
   *   cogs          = raw SQL NUMERIC SUM with LEFT JOINs
   *   bag_cost      = aggregate SUM(totalCost)
   *   variance_cost = LATERAL SQL weighted-avg per session (varianceKg > 0 only)
   *   delivery_cost = aggregate SUM(fuelCost)
   *               + SQL jsonb_array_elements SUM(otherExpenses[].amount)
   *   gross_profit  = revenue − cogs − bag_cost − variance_cost − delivery_cost
   *
   * container expenses are NOT double-counted — they are already inside lot.costPerKg
   * All seven queries run in parallel via Promise.all.
   */
  async getProfitLoss(filters: {
    dateFrom?: string;
    dateTo?: string;
    charcoalType?: string;
    grade?: string;
    clientId?: string;
  }) {
    const dateFilter = buildDateFilterWithDefault(filters.dateFrom, filters.dateTo);

    const [
      invoiceRevenueResult,
      walkInAgg,
      cogsResult,
      bagCostAgg,
      varianceCostResult,
      fuelAgg,
      otherExpensesResult,
    ] = await Promise.all([

      // ── invoice revenue — sum JSON lineTotal in DB (no row hydration) ───────
      this.prisma.$queryRaw<[{ invoice_revenue: string }]>(Prisma.sql`
        SELECT COALESCE(SUM((line->>'lineTotal')::numeric), 0::numeric)::text AS invoice_revenue
        FROM "invoices" inv
        CROSS JOIN LATERAL jsonb_array_elements(inv."lines") AS line
        WHERE inv."status" IN ('issued', 'partially_paid', 'paid')
        ${dateFilter.gte ? Prisma.sql`AND inv."issuedAt" >= ${dateFilter.gte}` : Prisma.empty}
        ${dateFilter.lte ? Prisma.sql`AND inv."issuedAt" <= ${dateFilter.lte}` : Prisma.empty}
        ${filters.clientId ? Prisma.sql`AND inv."clientId" = ${filters.clientId}` : Prisma.empty}
      `),

      // ── walk-in revenue — DB aggregate ──────────────────────────────────────
      this.prisma.stockExit.aggregate({
        where: {
          exitType: 'walk_in',
          amount:   { not: null },
          date:     dateFilter,
          ...(filters.clientId ? { clientId: filters.clientId } : {}),
        },
        _sum: { amount: true },
      }),

      // ── COGS — raw SQL SUM (NUMERIC precision, no JS float math) ────────────
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

      // ── bag_cost — DB aggregate ──────────────────────────────────────────────
      this.prisma.bagPurchase.aggregate({
        where: { date: dateFilter },
        _sum:  { totalCost: true },
      }),

      // ── variance_cost — LATERAL SQL weighted avg per session (no row fetch) ──
      // varianceKg > 0 = real packing loss (dust, breakage); negatives excluded.
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

      // ── delivery: fuelCost — DB aggregate ───────────────────────────────────
      this.prisma.driverTrip.aggregate({
        where: { status: 'completed', completedAt: dateFilter },
        _sum:  { fuelCost: true },
      }),

      // ── delivery: otherExpenses — LATERAL SQL (no row fetch) ────────────────
      this.prisma.$queryRaw<[{ other_expenses: string }]>(Prisma.sql`
        SELECT COALESCE(SUM((exp->>'amount')::numeric), 0::numeric)::text AS other_expenses
        FROM "driver_trips" dt
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(dt."otherExpenses", '[]'::jsonb)) AS exp
        WHERE dt."status" = 'completed'
        ${dateFilter.gte ? Prisma.sql`AND dt."completedAt" >= ${dateFilter.gte}` : Prisma.empty}
        ${dateFilter.lte ? Prisma.sql`AND dt."completedAt" <= ${dateFilter.lte}` : Prisma.empty}
      `),
    ]);

    const invoiceRevenue = new Decimal(invoiceRevenueResult[0]?.invoice_revenue ?? '0');
    const walkInRevenue  = new Decimal(walkInAgg._sum.amount?.toString() ?? '0');
    const revenue        = invoiceRevenue.plus(walkInRevenue);

    const cogs         = new Decimal(cogsResult[0]?.cogs ?? '0');
    const bagCost      = new Decimal(bagCostAgg._sum.totalCost?.toString() ?? '0');
    const varianceCost = new Decimal(varianceCostResult[0]?.variance_cost ?? '0');

    const fuelCost      = new Decimal(fuelAgg._sum.fuelCost?.toString() ?? '0');
    const otherExpenses = new Decimal(otherExpensesResult[0]?.other_expenses ?? '0');
    const deliveryCost  = fuelCost.plus(otherExpenses);

    const grossProfit = revenue
      .minus(cogs)
      .minus(bagCost)
      .minus(varianceCost)
      .minus(deliveryCost);

    return {
      from: filters.dateFrom ?? null,
      to:   filters.dateTo   ?? null,
      revenue:      revenue.toFixed(2),
      cogs:         cogs.toFixed(2),
      bagCost:      bagCost.toFixed(2),
      varianceCost: varianceCost.toFixed(2),
      deliveryCost: deliveryCost.toFixed(2),
      grossProfit:  grossProfit.toFixed(2),
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

    const where: Prisma.PackingSessionWhereInput = {
      date: dateFilter,
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
      arrivalDate: dateFilter,
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

  /**
   * Client ledger — chronological invoice/payment list with running balance.
   * CONSTRAINT 15: balance always computed from records, never stored.
   * Running balance requires per-entry ordering, so in-memory fold is
   * correct here (bounded by clientId + date filter).
   */
  async getClientLedger(
    clientId: string,
    filters: { dateFrom?: string; dateTo?: string },
  ) {
    const dateFilter = buildDateFilter(filters.dateFrom, filters.dateTo);

    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });

    const [invoices, payments] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          clientId,
          status: { not: 'draft' },
          ...(dateFilter ? { issuedAt: dateFilter } : {}),
        },
        select: { id: true, issuedAt: true, createdAt: true, total: true },
        orderBy: { issuedAt: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: { clientId, ...(dateFilter ? { date: dateFilter } : {}) },
        select: { id: true, date: true, amount: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    type EntryItem =
      | { kind: 'invoice'; date: Date; id: string; total: Decimal }
      | { kind: 'payment'; date: Date; id: string; amount: Decimal };

    const items: EntryItem[] = [
      ...invoices.map((inv) => ({
        kind:  'invoice' as const,
        date:  inv.issuedAt ?? inv.createdAt,
        id:    inv.id,
        total: new Decimal(inv.total.toString()),
      })),
      ...payments.map((pmt) => ({
        kind:   'payment' as const,
        date:   pmt.date instanceof Date ? pmt.date : new Date(pmt.date),
        id:     pmt.id,
        amount: new Decimal(pmt.amount.toString()),
      })),
    ];

    items.sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningBalance = new Decimal(0);
    const entries = items.map((item) => {
      if (item.kind === 'invoice') {
        runningBalance = runningBalance.plus(item.total);
        return {
          date:           item.date,
          type:           'invoice' as const,
          reference:      item.id,
          debit:          item.total.toFixed(2),
          credit:         '0.00',
          runningBalance: runningBalance.toFixed(2),
        };
      } else {
        runningBalance = runningBalance.minus(item.amount);
        return {
          date:           item.date,
          type:           'payment' as const,
          reference:      item.id,
          debit:          '0.00',
          credit:         item.amount.toFixed(2),
          runningBalance: runningBalance.toFixed(2),
        };
      }
    });

    return { clientId, currency: client.currency, entries, balance: runningBalance.toFixed(2) };
  }

  /**
   * Worker earnings report — CONSTRAINT 11: owner only.
   *
   * Totals (totalEarned, totalPaid, totalOwed) are computed via DB aggregate.
   * Session rows are paginated; payment rows are returned fully (typically few).
   * Defaults to the last DEFAULT_LOOKBACK_DAYS days when no date filter is given.
   */
  async getWorkerEarnings(
    workerId: string,
    filters: { dateFrom?: string; dateTo?: string; page?: number; limit?: number },
  ) {
    const dateFilter = buildDateFilterWithDefault(filters.dateFrom, filters.dateTo);
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 50;
    const skip  = (page - 1) * limit;

    const worker = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });

    const sessionWhere = { workerEntityId: workerId, date: dateFilter };
    const paymentWhere = { workerId, date: dateFilter };

    const [earnedAgg, paidAgg, sessionTotal] = await Promise.all([
      this.prisma.packingSession.aggregate({ where: sessionWhere, _sum: { sessionEarnings: true } }),
      this.prisma.workerPayment.aggregate({ where: paymentWhere, _sum: { amount: true } }),
      this.prisma.packingSession.count({ where: sessionWhere }),
    ]);

    const totalEarned = new Decimal(earnedAgg._sum.sessionEarnings?.toString() ?? '0');
    const totalPaid   = new Decimal(paidAgg._sum.amount?.toString() ?? '0');
    const totalOwed   = totalEarned.minus(totalPaid);

    const [sessions, workerPayments] = await Promise.all([
      this.prisma.packingSession.findMany({
        where:   sessionWhere,
        select:  { id: true, date: true, sessionEarnings: true },
        orderBy: { date: 'asc' },
        take: limit,
        skip,
      }),
      this.prisma.workerPayment.findMany({
        where:   paymentWhere,
        select:  { id: true, date: true, amount: true, notes: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    const sessionRows = sessions.map((s) => ({
      sessionId:       s.id,
      date:            s.date,
      sessionEarnings: new Decimal(s.sessionEarnings.toString()).toFixed(2),
    }));

    const paymentRows = workerPayments.map((p) => ({
      paymentId: p.id,
      date:      p.date,
      amount:    new Decimal(p.amount.toString()).toFixed(2),
      notes:     p.notes,
    }));

    return {
      workerId,
      workerName:  worker.name,
      from: filters.dateFrom ?? null,
      to:   filters.dateTo   ?? null,
      sessions: { data: sessionRows, total: sessionTotal, page, limit },
      payments: paymentRows,
      totalEarned: totalEarned.toFixed(2),
      totalPaid:   totalPaid.toFixed(2),
      totalOwed:   totalOwed.toFixed(2),
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

          const qtyBefore  = new Decimal(ps.quantity);
          const qtyAfter   = new Decimal(item.actualQuantity);
          const difference = qtyAfter.minus(qtyBefore);

          await tx.packedStock.update({ where: { id: ps.id }, data: { quantity: item.actualQuantity } });

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
    const [invoicedAgg, collectedAgg, outstandingResult, overdueResult] = await Promise.all([
      // totalInvoiced: sum of all issued/partially_paid/paid invoice totals
      this.prisma.invoice.aggregate({
        where: { status: { notIn: ['draft', 'cancelled'] } },
        _sum: { total: true },
      }),

      // totalCollected: sum of every payment recorded
      this.prisma.payment.aggregate({
        _sum: { amount: true },
      }),

      // totalOutstanding + open count: invoices not yet fully paid or cancelled
      this.prisma.$queryRaw<[{ total_outstanding: string; open_count: string }]>(Prisma.sql`
        SELECT
          COALESCE(SUM("total" - "paidAmount"), 0)::text AS total_outstanding,
          COUNT(*)::text                                  AS open_count
        FROM "invoices"
        WHERE "status" NOT IN ('paid', 'cancelled', 'draft')
      `),

      // totalOverdue + overdue count + oldest overdue age
      this.prisma.$queryRaw<[{ total_overdue: string; overdue_count: string; oldest_days: string }]>(Prisma.sql`
        SELECT
          COALESCE(SUM("total" - "paidAmount"), 0)::text                                                  AS total_overdue,
          COUNT(*)::text                                                                                   AS overdue_count,
          COALESCE(MAX(GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - "dueDate")) / 86400))), 0)::text     AS oldest_days
        FROM "invoices"
        WHERE "status" IN ('issued', 'partially_paid')
          AND "dueDate" IS NOT NULL
          AND "dueDate" < NOW()
      `),
    ]);

    return {
      totalInvoiced:    new Decimal(invoicedAgg._sum.total?.toString()   ?? '0').toFixed(2),
      totalCollected:   new Decimal(collectedAgg._sum.amount?.toString() ?? '0').toFixed(2),
      totalOutstanding: new Decimal(outstandingResult[0]?.total_outstanding ?? '0').toFixed(2),
      totalOverdue:     new Decimal(overdueResult[0]?.total_overdue          ?? '0').toFixed(2),
      openInvoiceCount: Number(outstandingResult[0]?.open_count  ?? 0),
      overdueCount:     Number(overdueResult[0]?.overdue_count   ?? 0),
      oldestOverdueDays: Number(overdueResult[0]?.oldest_days    ?? 0),
    };
  }
}
