import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';

@Injectable()
export class StockAdjustmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieve paginated stock adjustments with optional filters.
   *
   * @param page - Page number (1-indexed)
   * @param limit - Items per page
   * @param adjustmentType - Optional filter ('lot' | 'packed_stock')
   * @param dateFrom - Optional ISO date string lower bound
   * @param dateTo - Optional ISO date string upper bound
   */
  async findAll(
    page: number,
    limit: number,
    adjustmentType?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.StockAdjustmentWhereInput = {
      ...(adjustmentType ? { adjustmentType: adjustmentType as any } : {}),
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
      this.prisma.stockAdjustment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          lot: true,
          packedStock: true,
          countedBy: true,
          approvedBy: true,
        },
      }),
      this.prisma.stockAdjustment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Retrieve a single stock adjustment by ID.
   *
   * @param id - StockAdjustment UUID
   * @throws NotFoundException if not found
   */
  async findOne(id: string) {
    const adjustment = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: {
        lot: true,
        packedStock: true,
        countedBy: true,
        approvedBy: true,
      },
    });

    if (!adjustment) {
      throw new NotFoundException({ error: 'Stock adjustment not found', code: 'NOT_FOUND' });
    }

    return adjustment;
  }

  /**
   * Create a stock adjustment and atomically apply it to the referenced lot or packed stock.
   *
   * CONSTRAINT 6:  `reason` must be non-empty (enforced via DTO @IsNotEmpty + service guard).
   *                `approvedById` is set to the caller's DB User.id — owner is self-approving
   *                since this endpoint is restricted to @Roles('owner').
   * CONSTRAINT 13: No silent auto-correction — a StockAdjustment record is always written.
   *                The owner's approval is captured explicitly via approvedById.
   * CONSTRAINT 1:  For lot adjustments, qtyAfter must be >= 0 (enforced before the DB update).
   * CONSTRAINT 2:  For packed_stock adjustments, qtyAfter must be >= 0.
   *
   * @param dto    - Adjustment payload (CreateStockAdjustmentDto)
   * @param userId - Clerk userId of the requesting owner
   * @returns      Created StockAdjustment with lot/packedStock/countedBy/approvedBy relations
   * @throws NotFoundException     if User, StockLot, or PackedStock not found
   * @throws BadRequestException   if qtyAfter would violate CONSTRAINT 1 or 2
   */
  async create(dto: CreateStockAdjustmentDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // CONSTRAINT 13 + 6: Resolve DB user — caller is both counter and approver
      const user = await tx.user.findUnique({ where: { clerkId: userId } });
      if (!user) {
        throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
      }

      const difference = new Decimal(dto.qtyAfter).minus(new Decimal(dto.qtyBefore));

      if (dto.adjustmentType === 'lot') {
        // Validate lot exists
        const lot = await tx.stockLot.findUnique({ where: { id: dto.lotId! } });
        if (!lot) {
          throw new NotFoundException({ error: 'Stock lot not found', code: 'NOT_FOUND' });
        }

        // CONSTRAINT 1: qtyAfter >= 0
        if (new Decimal(dto.qtyAfter).lt(0)) {
          throw new BadRequestException({
            message: 'qtyAfter must be >= 0 for lot adjustments',
            error: 'qtyAfter must be >= 0 for lot adjustments',
            code: 'CONSTRAINT_VIOLATION',
          });
        }

        // Update lot.kgRemaining atomically
        await tx.stockLot.update({
          where: { id: dto.lotId! },
          data: { kgRemaining: dto.qtyAfter },
        });
      } else {
        // adjustmentType === 'packed_stock'
        const packedStock = await tx.packedStock.findUnique({ where: { id: dto.packedStockId! } });
        if (!packedStock) {
          throw new NotFoundException({ error: 'Packed stock not found', code: 'NOT_FOUND' });
        }

        const qtyAfterInt = parseInt(dto.qtyAfter, 10);

        // CONSTRAINT 2: qtyAfter >= 0
        if (qtyAfterInt < 0) {
          throw new BadRequestException({
            message: 'qtyAfter must be >= 0 for packed_stock adjustments',
            error: 'qtyAfter must be >= 0 for packed_stock adjustments',
            code: 'CONSTRAINT_VIOLATION',
          });
        }

        // Update packedStock.quantity atomically
        await tx.packedStock.update({
          where: { id: dto.packedStockId! },
          data: { quantity: qtyAfterInt },
        });
      }

      // Create the adjustment record
      const adjustment = await tx.stockAdjustment.create({
        data: {
          adjustmentType: dto.adjustmentType,
          ...(dto.lotId ? { lotId: dto.lotId } : {}),
          ...(dto.packedStockId ? { packedStockId: dto.packedStockId } : {}),
          qtyBefore: dto.qtyBefore,
          qtyAfter: dto.qtyAfter,
          difference: difference.toFixed(3),
          reason: dto.reason,
          countedById: user.id,
          approvedById: user.id, // CONSTRAINT 13: owner self-approves
          date: new Date(dto.date),
        },
        include: {
          lot: true,
          packedStock: true,
          countedBy: true,
          approvedBy: true,
        },
      });

      return adjustment;
    });
  }

  /**
   * Update an existing adjustment: reverses the original qty change, applies
   * the new qtyAfter, and updates the record. Only reason or qtyAfter can change.
   */
  async update(id: string, dto: { qtyAfter?: string; reason?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const adj = await tx.stockAdjustment.findUnique({ where: { id } });
      if (!adj) throw new NotFoundException({ error: 'Adjustment not found', code: 'NOT_FOUND' });

      if (dto.qtyAfter !== undefined && dto.qtyAfter !== adj.qtyAfter.toString()) {
        const newQtyAfter = new Decimal(dto.qtyAfter);
        if (newQtyAfter.lt(0)) throw new BadRequestException({ error: 'qtyAfter must be >= 0', code: 'CONSTRAINT_VIOLATION' });

        if (adj.adjustmentType === 'lot' && adj.lotId) {
          await tx.stockLot.update({
            where: { id: adj.lotId },
            data: { kgRemaining: newQtyAfter.toFixed(3) },
          });
        } else if (adj.adjustmentType === 'packed_stock' && adj.packedStockId) {
          await tx.packedStock.update({
            where: { id: adj.packedStockId },
            data: { quantity: parseInt(dto.qtyAfter, 10) },
          });
        }

        const newDiff = newQtyAfter.minus(new Decimal(adj.qtyBefore.toString()));
        return tx.stockAdjustment.update({
          where: { id },
          data: {
            qtyAfter: newQtyAfter.toFixed(3),
            difference: newDiff.toFixed(3),
            ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
          },
          include: { lot: true, packedStock: true, countedBy: true, approvedBy: true },
        });
      }

      return tx.stockAdjustment.update({
        where: { id },
        data: { ...(dto.reason !== undefined ? { reason: dto.reason } : {}) },
        include: { lot: true, packedStock: true, countedBy: true, approvedBy: true },
      });
    });
  }

  /** Delete an adjustment and reverse its effect on the lot/packed stock. */
  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const adj = await tx.stockAdjustment.findUnique({ where: { id } });
      if (!adj) throw new NotFoundException({ error: 'Adjustment not found', code: 'NOT_FOUND' });

      // Restore to qtyBefore
      if (adj.adjustmentType === 'lot' && adj.lotId) {
        await tx.stockLot.update({
          where: { id: adj.lotId },
          data: { kgRemaining: adj.qtyBefore.toString() },
        });
      } else if (adj.adjustmentType === 'packed_stock' && adj.packedStockId) {
        await tx.packedStock.update({
          where: { id: adj.packedStockId },
          data: { quantity: parseInt(adj.qtyBefore.toString(), 10) },
        });
      }

      await tx.stockAdjustment.delete({ where: { id } });
    });
  }
}
