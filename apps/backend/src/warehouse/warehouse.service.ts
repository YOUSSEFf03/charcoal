import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute a live warehouse snapshot.
   *
   * CONSTRAINT 12: estimatedTotalValue is omitted for sales_rep and worker roles.
   *
   * @param userRole - Role used for cost-field stripping
   */
  async getSummary(userRole?: string) {
    // Fetch all active stock lots (raw charcoal)
    const activeLots = await this.prisma.stockLot.findMany({
      where: { kgRemaining: { gt: 0 } },
    });

    // Compute totalRawKg and estimatedTotalValue (all arithmetic via decimal.js)
    let totalRawKg = new Decimal(0);
    let estimatedTotalValue = new Decimal(0);

    for (const lot of activeLots) {
      const remaining = new Decimal(lot.kgRemaining.toString());
      totalRawKg = totalRawKg.plus(remaining);
      estimatedTotalValue = estimatedTotalValue.plus(
        remaining.mul(new Decimal(lot.costPerKg.toString())),
      );
    }

    // Fetch all packed stocks with quantity > 0
    const packedStocks = await this.prisma.packedStock.findMany({
      where: { quantity: { gt: 0 } },
      include: { bagType: true },
    });

    // Compute totalPackedNominalKg and per-bagType summary
    let totalPackedNominalKg = new Decimal(0);
    const bagTypeTotals = new Map<
      string,
      { bagTypeName: string; totalBags: number; totalNominalKg: Decimal }
    >();

    for (const ps of packedStocks) {
      const nominalKg = new Decimal(ps.bagType.nominalKg.toString()).mul(ps.quantity);
      totalPackedNominalKg = totalPackedNominalKg.plus(nominalKg);

      const existing = bagTypeTotals.get(ps.bagTypeId);
      if (existing) {
        existing.totalBags += ps.quantity;
        existing.totalNominalKg = existing.totalNominalKg.plus(nominalKg);
      } else {
        bagTypeTotals.set(ps.bagTypeId, {
          bagTypeName: ps.bagType.name,
          totalBags: ps.quantity,
          totalNominalKg: nominalKg,
        });
      }
    }

    const totalSystemKg = totalRawKg.plus(totalPackedNominalKg);

    const packedSummary = Array.from(bagTypeTotals.entries()).map(
      ([bagTypeId, entry]) => ({
        bagTypeId,
        bagTypeName: entry.bagTypeName,
        totalBags: entry.totalBags,
        totalNominalKg: entry.totalNominalKg.toFixed(3),
      }),
    );

    const result: Record<string, unknown> = {
      totalRawKg: totalRawKg.toFixed(3),
      totalPackedNominalKg: totalPackedNominalKg.toFixed(3),
      totalSystemKg: totalSystemKg.toFixed(3),
      lotCount: activeLots.length,
      packedSummary,
    };

    // CONSTRAINT 12: strip estimatedTotalValue for restricted roles
    if (userRole !== 'sales_rep' && userRole !== 'worker') {
      result.estimatedTotalValue = estimatedTotalValue.toFixed(2);
    }

    return result;
  }
}
