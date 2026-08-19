import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

  private stripFromPackedStock(ps: any, userRole?: string): any {
    if (!ps) return ps;
    const result = { ...ps };
    if (result.lot && (userRole === 'sales_rep' || userRole === 'worker')) {
      result.lot = this.stripLotCostPerKg(result.lot);
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
      { bagTypeName: string; nominalKg: Decimal; totalBags: number; reservedBags: number; totalNominalKg: Decimal }
    >();

    for (const ps of packedStocks) {
      const nominalKg = new Decimal(ps.bagType.nominalKg.toString());
      const lineNominalKg = nominalKg.mul(ps.quantity);

      const existing = bagTypeTotals.get(ps.bagTypeId);
      if (existing) {
        existing.totalBags += ps.quantity;
        existing.reservedBags += ps.reservedQuantity;
        existing.totalNominalKg = existing.totalNominalKg.plus(lineNominalKg);
      } else {
        bagTypeTotals.set(ps.bagTypeId, {
          bagTypeName: ps.bagType.name,
          nominalKg,
          totalBags: ps.quantity,
          reservedBags: ps.reservedQuantity,
          totalNominalKg: lineNominalKg,
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
   * This runs the EXACT same ordering/greedy-consumption rule — createdAt
   * ascending, free = quantity − reservedQuantity — unbounded, scoped to ONE
   * bag type's outstanding batches (the same "safe unbounded per-entity"
   * scale profile FillJobsService.getPriceStats() / StockExitsService.
   * getClientWarehouseSummary() already use elsewhere in this codebase; a
   * single bag type's live batch count, not the whole table).
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
      orderBy: { createdAt: 'asc' },
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
