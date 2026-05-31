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
      { bagTypeName: string; nominalKg: Decimal; totalBags: number; totalNominalKg: Decimal }
    >();

    for (const ps of packedStocks) {
      const nominalKg = new Decimal(ps.bagType.nominalKg.toString());
      const lineNominalKg = nominalKg.mul(ps.quantity);

      const existing = bagTypeTotals.get(ps.bagTypeId);
      if (existing) {
        existing.totalBags += ps.quantity;
        existing.totalNominalKg = existing.totalNominalKg.plus(lineNominalKg);
      } else {
        bagTypeTotals.set(ps.bagTypeId, {
          bagTypeName: ps.bagType.name,
          nominalKg,
          totalBags: ps.quantity,
          totalNominalKg: lineNominalKg,
        });
      }
    }

    return Array.from(bagTypeTotals.entries()).map(([bagTypeId, entry]) => ({
      bagTypeId,
      bagTypeName: entry.bagTypeName,
      totalBags: entry.totalBags,
      totalNominalKg: entry.totalNominalKg.toFixed(3),
    }));
  }
}
