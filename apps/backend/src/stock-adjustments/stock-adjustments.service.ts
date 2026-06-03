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
    status?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.StockAdjustmentWhereInput = {
      ...(adjustmentType ? { adjustmentType: adjustmentType as any } : {}),
      // BUG-H: lets the reconciliation view query pending approvals (?status=pending).
      ...(status ? { status: status as any } : {}),
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
   * Resolve qtyBefore from the LIVE row, validate qtyAfter, and apply the atomic delta
   * to the referenced lot / packed stock. Returns the server-resolved qtyBefore so the
   * caller can persist a truthful audit trail.
   *
   * BUG-F (P4): qtyBefore is read from the live value inside the tx — never the client.
   * BUG-G (P4): stock mutates by an atomic { increment } delta, never an absolute set.
   * BUG-E (P2): a packed_stock adjustment may not drive quantity below reservedQuantity.
   *
   * @param mutate - when false, validate + resolve qtyBefore but do NOT touch stock
   *                 (used to record a PENDING adjustment — BUG-H).
   */
  private async resolveAndApply(
    tx: Prisma.TransactionClient,
    adjustmentType: 'lot' | 'packed_stock',
    refId: string,
    qtyAfter: string,
    mutate: boolean,
  ): Promise<Decimal> {
    let liveQtyBefore: Decimal;

    if (adjustmentType === 'lot') {
      const lot = await tx.stockLot.findUnique({ where: { id: refId } });
      if (!lot) throw new NotFoundException({ error: 'Stock lot not found', code: 'NOT_FOUND' });

      if (new Decimal(qtyAfter).lt(0)) {
        throw new BadRequestException({
          message: 'qtyAfter must be >= 0 for lot adjustments',
          error: 'qtyAfter must be >= 0 for lot adjustments',
          code: 'CONSTRAINT_VIOLATION',
        });
      }

      liveQtyBefore = new Decimal(lot.kgRemaining.toString());
      if (mutate) {
        const difference = new Decimal(qtyAfter).minus(liveQtyBefore);
        // Pass a Decimal-precision string (matches the consume-lots convention) — never a
        // JS number — so fractional kg deltas are not subject to float drift.
        await tx.stockLot.update({
          where: { id: refId },
          data: { kgRemaining: { increment: difference.toFixed(3) } },
        });
      }
    } else {
      const packedStock = await tx.packedStock.findUnique({ where: { id: refId } });
      if (!packedStock) throw new NotFoundException({ error: 'Packed stock not found', code: 'NOT_FOUND' });

      const qtyAfterInt = parseInt(qtyAfter, 10);
      if (qtyAfterInt < 0) {
        throw new BadRequestException({
          message: 'qtyAfter must be >= 0 for packed_stock adjustments',
          error: 'qtyAfter must be >= 0 for packed_stock adjustments',
          code: 'CONSTRAINT_VIOLATION',
        });
      }

      // BUG-E (P2): an adjustment must not strand reservations.
      if (qtyAfterInt < packedStock.reservedQuantity) {
        throw new BadRequestException({
          error: `qtyAfter ${qtyAfterInt} is below reserved ${packedStock.reservedQuantity} for this packed stock`,
          code: 'CONSTRAINT_VIOLATION',
        });
      }

      liveQtyBefore = new Decimal(packedStock.quantity);
      if (mutate) {
        const difference = new Decimal(qtyAfterInt).minus(liveQtyBefore);
        await tx.packedStock.update({
          where: { id: refId },
          data: { quantity: { increment: difference.toNumber() } },
        });
      }
    }

    return liveQtyBefore;
  }

  /**
   * Create a stock adjustment.
   *
   * BUG-H (workflow): two-step approval.
   *   - An OWNER caller self-approves: the delta is applied immediately, status = 'approved',
   *     countedById = approvedById = caller (CONSTRAINT 13 legacy behaviour preserved).
   *   - A NON-OWNER caller (e.g. a worker/accountant counting stock) submits a PENDING
   *     adjustment: NO stock change yet, status = 'pending', approvedById = null. An owner
   *     must later approve() it for the delta to apply, and the approver must differ from
   *     the counter.
   *
   * BUG-F (P4): qtyBefore is resolved server-side from the live row, never from the client.
   * BUG-G (P4): the stock change is an atomic delta, never an absolute set.
   *
   * @param dto    - Adjustment payload (CreateStockAdjustmentDto)
   * @param userId - Clerk userId of the requesting user
   */
  async create(dto: CreateStockAdjustmentDto, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) {
      throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    }

    const isOwner = user.role === 'owner';
    const refId = (dto.adjustmentType === 'lot' ? dto.lotId : dto.packedStockId)!;

    return this.prisma.$transaction(async (tx) => {
      // Validate + resolve live qtyBefore; only mutate stock when the owner self-approves.
      const liveQtyBefore = await this.resolveAndApply(
        tx,
        dto.adjustmentType,
        refId,
        dto.qtyAfter,
        /* mutate */ isOwner,
      );

      const difference = new Decimal(dto.qtyAfter).minus(liveQtyBefore);

      return tx.stockAdjustment.create({
        data: {
          adjustmentType: dto.adjustmentType,
          ...(dto.lotId ? { lotId: dto.lotId } : {}),
          ...(dto.packedStockId ? { packedStockId: dto.packedStockId } : {}),
          qtyBefore: liveQtyBefore.toFixed(3),
          qtyAfter: dto.qtyAfter,
          difference: difference.toFixed(3),
          reason: dto.reason,
          status: isOwner ? 'approved' : 'pending',
          countedById: user.id,
          approvedById: isOwner ? user.id : null, // owner self-approves; counter awaits approval
          date: new Date(dto.date),
        },
        include: { lot: true, packedStock: true, countedBy: true, approvedBy: true },
      });
    });
  }

  /**
   * BUG-H: approve a PENDING adjustment — owner only. Applies the atomic delta NOW
   * (qtyBefore is re-resolved from the live value at approval time, BUG-F/P4), records
   * the approver, and flips status to 'approved'. The approver MUST differ from the counter.
   */
  async approve(id: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });

    return this.prisma.$transaction(async (tx) => {
      const adj = await tx.stockAdjustment.findUnique({ where: { id } });
      if (!adj) throw new NotFoundException({ error: 'Adjustment not found', code: 'NOT_FOUND' });

      if (adj.status !== 'pending') {
        throw new BadRequestException({
          error: `Only a pending adjustment can be approved (current status: ${adj.status})`,
          code: 'CONSTRAINT_VIOLATION',
        });
      }
      if (adj.countedById === user.id) {
        throw new BadRequestException({
          error: 'Approver must differ from the counter who submitted the adjustment',
          code: 'CONSTRAINT_VIOLATION',
        });
      }

      const refId = (adj.adjustmentType === 'lot' ? adj.lotId : adj.packedStockId)!;
      // Re-resolve live qtyBefore at APPROVAL time and apply the atomic delta now.
      const liveQtyBefore = await this.resolveAndApply(
        tx,
        adj.adjustmentType,
        refId,
        adj.qtyAfter.toString(),
        /* mutate */ true,
      );
      const difference = new Decimal(adj.qtyAfter.toString()).minus(liveQtyBefore);

      return tx.stockAdjustment.update({
        where: { id },
        data: {
          status: 'approved',
          approvedById: user.id,
          qtyBefore: liveQtyBefore.toFixed(3),
          difference: difference.toFixed(3),
        },
        include: { lot: true, packedStock: true, countedBy: true, approvedBy: true },
      });
    });
  }

  /**
   * BUG-H: reject a PENDING adjustment — owner only. Discards it with NO stock change.
   */
  async reject(id: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });

    const adj = await this.prisma.stockAdjustment.findUnique({ where: { id } });
    if (!adj) throw new NotFoundException({ error: 'Adjustment not found', code: 'NOT_FOUND' });
    if (adj.status !== 'pending') {
      throw new BadRequestException({
        error: `Only a pending adjustment can be rejected (current status: ${adj.status})`,
        code: 'CONSTRAINT_VIOLATION',
      });
    }

    return this.prisma.stockAdjustment.update({
      where: { id },
      data: { status: 'rejected', approvedById: user.id },
      include: { lot: true, packedStock: true, countedBy: true, approvedBy: true },
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

        // BUG-G (P4): editing qtyAfter changes stock by the DELTA between the new and old
        // qtyAfter (newQtyAfter − oldQtyAfter), applied atomically against the LIVE value.
        // An absolute `set = newQtyAfter` would clobber any sale/exit since the original
        // adjustment. qtyBefore is immutable — the original difference simply grows/shrinks.
        const editDelta = newQtyAfter.minus(new Decimal(adj.qtyAfter.toString()));

        // BUG-H: only an APPROVED adjustment has already moved stock; editing it adjusts
        // stock by the delta. A PENDING adjustment never touched stock, so editing its
        // target only rewrites the record — no stock mutation until it is approved.
        if (adj.status === 'approved') {
          if (adj.adjustmentType === 'lot' && adj.lotId) {
            await tx.stockLot.update({
              where: { id: adj.lotId },
              data: { kgRemaining: { increment: editDelta.toFixed(3) } },
            });
          } else if (adj.adjustmentType === 'packed_stock' && adj.packedStockId) {
            await tx.packedStock.update({
              where: { id: adj.packedStockId },
              data: { quantity: { increment: editDelta.toNumber() } },
            });
          }
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

      // BUG-G (P4): reverse by applying the INVERSE of this adjustment's own delta
      // (its `difference`) atomically against the LIVE value — never an absolute restore
      // to a stale qtyBefore snapshot. Deleting after a later sale must undo only THIS
      // adjustment's effect, leaving the later activity intact.
      const inverseDelta = new Decimal(adj.difference.toString()).negated();

      // BUG-H: only an APPROVED adjustment moved stock and therefore needs reversing.
      // A pending/rejected adjustment never applied a delta — deleting it must NOT touch stock.
      if (adj.status === 'approved') {
        if (adj.adjustmentType === 'lot' && adj.lotId) {
          await tx.stockLot.update({
            where: { id: adj.lotId },
            data: { kgRemaining: { increment: inverseDelta.toFixed(3) } },
          });
        } else if (adj.adjustmentType === 'packed_stock' && adj.packedStockId) {
          await tx.packedStock.update({
            where: { id: adj.packedStockId },
            data: { quantity: { increment: inverseDelta.toNumber() } },
          });
        }
      }

      await tx.stockAdjustment.delete({ where: { id } });
    });
  }
}
