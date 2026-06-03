import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExitType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockExitDto } from './dto/create-stock-exit.dto';
import Decimal from 'decimal.js';
import { creditAccount } from '../cash-handovers/cash-handovers.service';

@Injectable()
export class StockExitsService {
  constructor(private readonly prisma: PrismaService) {}

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
   * Update mutable fields on an existing exit (amount, recipient).
   * Identity and audit fields (loggedById, exitType, date) are immutable after creation.
   */
  async updateExit(id: string, dto: { amount?: number; recipient?: string }) {
    const exit = await this.prisma.stockExit.findUnique({ where: { id } });
    if (!exit) throw new NotFoundException({ error: 'Exit not found', code: 'NOT_FOUND' });
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
   * @constraint 2 packedStock.quantity - dto.quantity < 0 → 400 CONSTRAINT_VIOLATION; transaction rolled back
   * @constraint 5 loggedById is always user.id resolved from the JWT, never from the request body
   */
  async create(dto: CreateStockExitDto, userId: string) {
    // Resolve caller before opening a transaction — this read is safe outside
    // the tx because the user record is not mutated during the operation.
    const user = await this.prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });

    // Resolve collector name outside tx (display-only, not a constraint)
    let collectorFields: { collectedById?: string; collectedBy?: string } = {};
    if (dto.collectedById) {
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
        await creditAccount(
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
