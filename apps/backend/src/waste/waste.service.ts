import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WasteEntryType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { drawFromWastePool, WASTE_STOCK_ID } from '../common/inventory/waste-pool';
import { CreateWasteDisposalDto } from './dto/create-waste-disposal.dto';

@Injectable()
export class WasteService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Waste-pool balance + this-month activity.
   *
   * The pool is fed by packing-session variance (syncPackingVarianceWasteEntry), corrected
   * by waste adjustments (stock-adjustments.service.ts, adjustmentType='waste'), drawn by
   * waste sales (WalkInSalesService wasteLines / StockExitsService fromWastePool — both via
   * drawFromWastePool) and by disposals (createDisposal below). soldThisMonthKg is NET of
   * cancelled sales (a cancellation writes a reversing positive 'sale' entry). Sale money
   * lives on the invoice / stock exit, not here — this summary is kg only.
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
   * session, adjustment, the sale's stock exit / invoice).
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
          stockExit: { select: { id: true, recipient: true, amount: true, currency: true } },
          invoice: { select: { id: true, displayId: true, client: { select: { id: true, name: true } } } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.wasteEntry.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Record waste thrown away (not sold): one negative 'disposal' WasteEntry and the
   * matching pool decrement, atomically. Rejects WASTE_POOL_INSUFFICIENT rather than
   * driving the pool negative (see drawFromWastePool).
   */
  async createDisposal(dto: CreateWasteDisposalDto, clerkUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId: clerkUserId } });
    if (!user) throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    return this.prisma.$transaction((tx) =>
      drawFromWastePool(tx, {
        type: 'disposal',
        kg: new Decimal(dto.kg),
        date: new Date(dto.date),
        createdById: user.id,
        note: dto.note?.trim() || undefined,
      }),
    );
  }
}

/** Calendar-month boundary in UTC — `date` is a @db.Date column (no time-of-day), so a
 *  UTC month start is the correct, timezone-independent cutoff for "this month". */
function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
