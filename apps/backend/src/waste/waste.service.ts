import { Injectable } from '@nestjs/common';
import { Prisma, WasteEntryType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { WASTE_STOCK_ID } from '../common/inventory/waste-pool';

@Injectable()
export class WasteService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Waste-pool balance + this-month activity.
   *
   * Phase 1/2 (current): the pool is fed only by packing-session variance
   * (syncPackingVarianceWasteEntry, see packing-sessions.service.ts) and corrected only
   * by waste adjustments (stock-adjustments.service.ts, adjustmentType='waste'). Selling
   * from the pool (Phase 3 — WalkInSalesService/StockExitsService) is not wired yet, so
   * soldThisMonthKg is always 0 today; the query is written against type='sale' now so
   * it needs no revisiting once that phase lands. No $ figure is returned yet — there is
   * nowhere a dollar amount is captured for a waste sale until Phase 3 exists; returning
   * an always-zero USD field now would misrepresent functionality that isn't built.
   */
  async getSummary() {
    const monthStart = startOfMonthUtc(new Date());

    const [stock, monthEntries, lastAdjustment] = await Promise.all([
      this.prisma.wasteStock.findUnique({ where: { id: WASTE_STOCK_ID } }),
      this.prisma.wasteEntry.groupBy({
        by: ['type'],
        where: { date: { gte: monthStart } },
        _sum: { kg: true },
      }),
      this.prisma.wasteEntry.findFirst({
        where: { type: 'adjustment' },
        orderBy: { date: 'desc' },
        select: { date: true },
      }),
    ]);

    const sumByType = (type: WasteEntryType) =>
      new Decimal(monthEntries.find((e) => e.type === type)?._sum.kg?.toString() ?? '0');

    return {
      kgOnHand: new Decimal(stock?.kgOnHand.toString() ?? '0').toFixed(3),
      // packing_variance entries are always stored positive (intake) — see WasteEntry's
      // doc comment in schema.prisma — so this sum is the real kg collected, no sign flip.
      collectedThisMonthKg: sumByType('packing_variance').toFixed(3),
      // sale/disposal entries are stored NEGATIVE (outflow) — negate for a human-readable
      // "kg sold" / "kg disposed" figure.
      soldThisMonthKg: sumByType('sale').negated().toFixed(3),
      disposedThisMonthKg: sumByType('disposal').negated().toFixed(3),
      lastAdjustmentDate: lastAdjustment?.date.toISOString() ?? null,
    };
  }

  /**
   * Paginated waste-pool ledger (append-only — see WasteEntry's doc comment).
   * Joins just enough to let the UI link each entry back to its source (packing
   * session, adjustment) — stockExit/invoice joins return null today since Phase 3
   * (selling from the pool) isn't wired yet, same as getSummary() above.
   */
  async getLedger(
    page: number,
    limit: number,
    type?: WasteEntryType,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.WasteEntryWhereInput = {
      ...(type ? { type } : {}),
      ...(dateFrom || dateTo
        ? {
            date: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.wasteEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          session: { select: { id: true, date: true, workerEntity: { select: { id: true, name: true } } } },
          adjustment: { select: { id: true, reason: true, status: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.wasteEntry.count({ where }),
    ]);

    return { data, total, page, limit };
  }
}

/** Calendar-month boundary in UTC — `date` is a @db.Date column (no time-of-day), so a
 *  UTC month start is the correct, timezone-independent cutoff for "this month". */
function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
