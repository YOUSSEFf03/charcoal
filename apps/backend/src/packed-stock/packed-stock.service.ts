import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The one deterministic "oldest batch first" ordering for PackedStock, shared
 * by every caller that picks which row(s) to draw from or return bags into
 * (forensic audit, 2026-08-29 — see {@link PackedStockService.getFifoDraw}'s
 * doc comment for the full tiebreak rationale). Exported so
 * ShipmentsService.createShipment()/logReturn() — which perform the same
 * kind of PackedStock row selection but outside getFifoDraw()'s greedy-draw
 * shape — use the identical tiebreak chain instead of their own `createdAt`-
 * only order, which is vulnerable to the exact same sibling-tie
 * nondeterminism this ordering was created to fix.
 */
export const PACKED_STOCK_FIFO_ORDER_BY: Prisma.PackedStockOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { lot: { dateReceived: 'asc' } },
  { lot: { createdAt: 'asc' } },
  { id: 'asc' },
];

@Injectable()
export class PackedStockService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Cost-field helper (CONSTRAINT 12)
  // ---------------------------------------------------------------------------

  private stripLotCostPerKg(lot: any): any {
    if (!lot) return lot;
    const l = { ...lot };
    delete l.costPerKg;
    return l;
  }

  // Same fields, same roles as BagTypesService.stripCostFields() — findAll()'s
  // `include: { bagType: true }` was returning these unredacted to sales_rep/
  // worker, unlike every other path that reaches BagType cost data.
  private stripBagTypeCostFields(bagType: any): any {
    if (!bagType) return bagType;
    const b = { ...bagType };
    delete b.costPerBag;
    delete b.workerRate;
    return b;
  }

  private stripFromPackedStock(ps: any, userRole?: string): any {
    if (!ps) return ps;
    const result = { ...ps };
    if (userRole === 'sales_rep' || userRole === 'worker') {
      if (result.lot) result.lot = this.stripLotCostPerKg(result.lot);
      if (result.bagType) result.bagType = this.stripBagTypeCostFields(result.bagType);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  /**
   * Retrieve paginated packed stock entries with optional filters.
   * costPerKg is stripped from included lot for sales_rep and worker roles.
   *
   * @param page - Page number (1-indexed)
   * @param limit - Items per page
   * @param lotId - Optional filter
   * @param bagTypeId - Optional filter
   * @param userRole - Role used for CONSTRAINT 12 stripping
   */
  async findAll(
    page: number,
    limit: number,
    lotId?: string,
    bagTypeId?: string,
    userRole?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.PackedStockWhereInput = {
      ...(lotId ? { lotId } : {}),
      ...(bagTypeId ? { bagTypeId } : {}),
    };

    const [packedStocks, total] = await this.prisma.$transaction([
      this.prisma.packedStock.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          bagType: true,
          lot: true,
          // Business "packed on" date — same dateReceived-vs-createdAt convention as
          // StockLot elsewhere in this app. Free (same query, no extra round trip).
          session: { select: { date: true } },
        },
      }),
      this.prisma.packedStock.count({ where }),
    ]);

    const data = packedStocks.map((ps) => this.stripFromPackedStock(ps, userRole));

    return { data, total, page, limit };
  }

  /**
   * Compute a summary of packed stock grouped by bag type.
   * Returns total bags and total nominal kg per bag type.
   */
  async findSummary() {
    const packedStocks = await this.prisma.packedStock.findMany({
      where: { quantity: { gt: 0 } },
      include: { bagType: true },
    });

    const bagTypeTotals = new Map<
      string,
      { bagTypeName: string; nominalKg: Decimal; totalBags: number; reservedBags: number; totalNominalKg: Decimal; lotIds: Set<string> }
    >();

    for (const ps of packedStocks) {
      const nominalKg = new Decimal(ps.bagType.nominalKg.toString());
      const lineNominalKg = nominalKg.mul(ps.quantity);

      const existing = bagTypeTotals.get(ps.bagTypeId);
      if (existing) {
        existing.totalBags += ps.quantity;
        existing.reservedBags += ps.reservedQuantity;
        existing.totalNominalKg = existing.totalNominalKg.plus(lineNominalKg);
        existing.lotIds.add(ps.lotId);
      } else {
        bagTypeTotals.set(ps.bagTypeId, {
          bagTypeName: ps.bagType.name,
          nominalKg,
          totalBags: ps.quantity,
          reservedBags: ps.reservedQuantity,
          totalNominalKg: lineNominalKg,
          lotIds: new Set([ps.lotId]),
        });
      }
    }

    // BUG-E (P2): expose reserved + available so the frontend availability check draws
    // against FREE bags (quantity − reservedQuantity), not raw quantity.
    return Array.from(bagTypeTotals.entries()).map(([bagTypeId, entry]) => ({
      bagTypeId,
      bagTypeName: entry.bagTypeName,
      totalBags: entry.totalBags,
      reservedBags: entry.reservedBags,
      // Distinct source lots currently holding stock (quantity > 0) of this bag type —
      // powers the "N lots" figure on the Warehouse → Packed goods card, previously
      // hardcoded to 0 on the frontend.
      lotCount: entry.lotIds.size,
      availableBags: Math.max(0, entry.totalBags - entry.reservedBags),
      totalNominalKg: entry.totalNominalKg.toFixed(3),
    }));
  }

  /**
   * Server-side FIFO draw plan for one bag type — which PackedStock record(s)
   * (and how much from each) a sale of `quantity` bags should draw from,
   * oldest batch first.
   *
   * Replaces WarehouseSales.tsx's previous client-side computation, which
   * sorted a limit:200-capped fetch of individual PackedStock records
   * ascending by createdAt and greedily consumed free quantity (quantity −
   * reservedQuantity) until the requested amount was satisfied. A bag type
   * with more than 200 outstanding batches would silently truncate that
   * fetch and could report "insufficient stock" even when real stock existed
   * beyond the 200th record.
   *
   * This runs the EXACT same ordering/greedy-consumption rule — free =
   * quantity − reservedQuantity — unbounded, scoped to ONE bag type's
   * outstanding batches (the same "safe unbounded per-entity" scale profile
   * FillJobsService.getPriceStats() / StockExitsService.
   * getClientWarehouseSummary() already use elsewhere in this codebase; a
   * single bag type's live batch count, not the whole table).
   *
   * ── Deterministic ordering (forensic audit, 2026-08-29) ──────────────────
   * A packing session that draws from N charcoal lots creates N PackedStock
   * rows in ONE splitBagsAcrossLots() + packedStock.createMany() call (see
   * packing-sessions.service.ts). Those sibling rows share a byte-identical
   * `createdAt`: Prisma Client computes ONE default timestamp per
   * createMany() call and applies it to every row in that batch (verified
   * directly against this schema/client — two SEPARATE create() calls, even
   * inside the same transaction, do NOT tie; only rows written by the same
   * createMany() batch do), so no amount of real time between the rows'
   * logical creation changes this. Ordering by createdAt ASC alone therefore
   * leaves sibling rows in a SQL-unspecified order — resolved in practice by
   * incidental physical tuple layout, not by any business rule. Confirmed via
   * EXPLAIN ANALYZE against the real sale this audit traced (Invoice
   * SI-0649): the tie-break order matched PostgreSQL's ctid (physical heap
   * position), which can also change on a later UPDATE to either row — i.e.
   * genuinely nondeterministic over time, not merely "consistent but
   * arbitrary."
   *
   * Two tiebreakers resolve the tie with real, pre-existing business
   * meaning rather than an invented field:
   *   1. lot.dateReceived ASC — FIFO-of-raw-material. The sub-batch packed
   *      from the OLDER-received charcoal lot should leave the warehouse
   *      first; StockLot identity (type+grade+supplier) is never merged/
   *      blended (SPEC.md §4.1), and this extends that same aging
   *      discipline to the packed sub-batches split from one session.
   *   2. lot.createdAt ASC — same-day dateReceived ties (a @db.Date column;
   *      routine when two lots arrive off the same container — confirmed
   *      against real data, e.g. container 00000000-…-200000000001) resolved
   *      by when the lot was actually registered.
   * `id ASC` is the final, terminal tiebreaker — used ONLY to guarantee a
   * total order in the vanishingly unlikely case even the above ties
   * (two lots received in the same transaction); it is NOT a stand-in for
   * business meaning. splitBagsAcrossLots()'s own row-push order was
   * considered and rejected as the tiebreak: it is sorted by largest-
   * remainder fractional share (bag-rounding fairness across lots), which
   * has no relationship to consumption/selling priority.
   *
   * Read-only / advisory: does NOT decrement anything. The actual write-time
   * decrement + re-validation of each individual record's free quantity
   * still happens exactly as before, inside StockExitsService.create() /
   * WalkInSalesService.create()'s own transactions — this only computes
   * which records the caller should ask those unchanged endpoints to draw
   * from, so a concurrent sale between planning and submission is still
   * safely rejected at write time exactly as it always has been.
   */
  async getFifoDraw(
    bagTypeId: string,
    quantity: number,
  ): Promise<{
    draws: { packedStockId: string; quantity: number }[];
    fulfilled: boolean;
    requested: number;
    available: number;
  }> {
    const records = await this.prisma.packedStock.findMany({
      where: { bagTypeId },
      orderBy: PACKED_STOCK_FIFO_ORDER_BY,
      select: { id: true, quantity: true, reservedQuantity: true },
    });

    const draws: { packedStockId: string; quantity: number }[] = [];
    let remaining = quantity;
    let available = 0;

    for (const rec of records) {
      const free = Math.max(0, rec.quantity - rec.reservedQuantity);
      available += free;
      if (remaining <= 0 || free <= 0) continue;
      const take = Math.min(free, remaining);
      draws.push({ packedStockId: rec.id, quantity: take });
      remaining -= take;
    }

    return {
      draws,
      fulfilled: remaining <= 0,
      requested: quantity,
      available,
    };
  }
}
