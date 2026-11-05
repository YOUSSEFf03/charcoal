import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockLotDto } from './dto/create-stock-lot.dto';
import { UpdateStockLotDto } from './dto/update-stock-lot.dto';

// GET /suppliers (contactPersons, bankDetails, paymentTerms) is owner/accountant
// only (SuppliersController) — but /stock-lots and its siblings below are also
// reachable by sales_rep/worker (and StockLot.supplier was being returned as the
// FULL Supplier record, unredacted, to every one of those roles: a real data leak
// found live — worker/sales_rep received the supplier's bank IBAN/SWIFT/account
// number verbatim). Only `id`/`name` are ever displayed from this relation
// anywhere in the app (Warehouse.tsx's Raw Lots "Supplier" column) — scoping the
// query itself to that projection is safe for every role, matches StockLot's own
// declared `supplier?: Pick<Supplier, 'id' | 'name'>` type, and needs no
// role-conditional stripping since nothing sensitive is ever fetched in the
// first place.
const SAFE_SUPPLIER_SELECT = { select: { id: true, name: true } } as const;

@Injectable()
export class StockLotsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Cost-field helpers (CONSTRAINT 12)
  // ---------------------------------------------------------------------------

  private stripCostField(lot: any): any {
    const l = { ...lot };
    delete l.costPerKg;
    return l;
  }

  private maybeStrip(data: any, role?: string): any {
    if (role === 'sales_rep' || role === 'worker') return this.stripCostField(data);
    return data;
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  /**
   * Retrieve a paginated list of stock lots with optional filters.
   *
   * @param page - Page number (1-indexed)
   * @param limit - Items per page
   * @param charcoalType - Optional filter
   * @param grade - Optional filter
   * @param supplierId - Optional filter
   * @param source - Optional filter ('container' | 'direct')
   * @param hasStock - When true, only lots with kgRemaining > 0
   * @param userRole - Role used for CONSTRAINT 12 stripping
   */
  async findAll(
    page: number,
    limit: number,
    charcoalType?: string,
    grade?: string,
    supplierId?: string,
    source?: string,
    hasStock?: boolean,
    userRole?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.StockLotWhereInput = {
      ...(charcoalType ? { charcoalType } : {}),
      ...(grade ? { grade } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(source ? { source: source as any } : {}),
      ...(hasStock ? { kgRemaining: { gt: 0 } } : {}),
    };

    const [lots, total] = await this.prisma.$transaction([
      this.prisma.stockLot.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { supplier: SAFE_SUPPLIER_SELECT },
      }),
      this.prisma.stockLot.count({ where }),
    ]);

    const data = lots.map((lot) => this.maybeStrip(lot, userRole));

    return { data, total, page, limit };
  }

  /**
   * All stock lots with kgRemaining > 0, unbounded — populates the
   * warehouse-sale KG-mode lot selector (WarehouseSales.tsx), which
   * previously relied on findAll()'s paginated limit:100 fetch and could
   * hide an older lot (received further back than the 100 most-recently-
   * received) that still had real kgRemaining, making it unselectable even
   * though it had stock.
   *
   * This is a DIFFERENT problem from the packed-stock FIFO draw fix
   * (PackedStockService.getFifoDraw()) — that one exists because a packed-
   * bag sale auto-splits ONE requested quantity across MULTIPLE PackedStock
   * batches. A KG sale always draws from exactly ONE StockLot, manually
   * chosen by the user from this list: StockLot has no reservedQuantity
   * column and no automatic multi-lot consumption logic exists anywhere in
   * this codebase (confirmed by inspecting both the anonymous and
   * registered-client KG sale paths and the StockLot schema). The fix
   * needed here is selector VISIBILITY — every lot with stock must be
   * listable — not a server-side draw/split.
   *
   * Scoped to kgRemaining > 0 — bounded by how many DISTINCT lots are
   * currently open in the warehouse, the same "safe unbounded" scale
   * profile PackedStockService.findSummary() already uses for exactly the
   * same reason (also an unbounded findMany with no pagination).
   */
  async findAvailable(userRole?: string) {
    const lots = await this.prisma.stockLot.findMany({
      where: { kgRemaining: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      include: { supplier: SAFE_SUPPLIER_SELECT },
    });
    return lots.map((lot) => this.maybeStrip(lot, userRole));
  }

  /**
   * Retrieve a single stock lot by ID.
   *
   * @param id - StockLot UUID
   * @param userRole - Role used for CONSTRAINT 12 stripping
   * @throws NotFoundException if lot does not exist
   */
  async findOne(id: string, userRole?: string) {
    const lot = await this.prisma.stockLot.findUnique({
      where: { id },
      include: { supplier: SAFE_SUPPLIER_SELECT },
    });

    if (!lot) {
      throw new NotFoundException({ error: 'Stock lot not found', code: 'NOT_FOUND' });
    }

    return this.maybeStrip(lot, userRole);
  }

  /**
   * Create a direct-source stock lot.
   * kgReceived is set equal to kgRemaining (full stock on arrival).
   *
   * @param dto - Creation payload
   * @param userId - Clerk user ID of the requester (used to validate user exists)
   * @throws NotFoundException if supplier or user does not exist
   */
  async create(dto: CreateStockLotDto, userId: string) {
    // A purchase must bring in real kg; cost may be 0 (free goods) but never negative —
    // kgReceived × costPerKg is what the supplier balance/statement charges for it.
    if (!new Decimal(dto.kgRemaining).gt(0)) {
      throw new BadRequestException({ error: 'Kg must be greater than zero', code: 'CONSTRAINT_VIOLATION' });
    }
    if (new Decimal(dto.costPerKg).lt(0)) {
      throw new BadRequestException({ error: 'Cost per kg cannot be negative', code: 'CONSTRAINT_VIOLATION' });
    }

    // Validate user exists
    const user = await this.prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) {
      throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    }

    // Validate supplier exists
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } });
    if (!supplier) {
      throw new NotFoundException({ error: 'Supplier not found', code: 'NOT_FOUND' });
    }

    return this.prisma.stockLot.create({
      data: {
        charcoalType: dto.charcoalType,
        grade: dto.grade,
        supplierId: dto.supplierId,
        kgReceived: dto.kgRemaining,
        kgRemaining: dto.kgRemaining,
        costPerKg: dto.costPerKg,
        source: 'direct',
        containerId: null,
        dateReceived: dto.dateReceived ? new Date(dto.dateReceived) : new Date(),
        notes: dto.notes,
      },
      include: { supplier: SAFE_SUPPLIER_SELECT },
    });
  }

  // ── Local (direct) purchase corrections ──────────────────────────────────
  // Only source='direct' lots: a container lot's kg/cost come from its
  // container's product lines and are corrected there. Both paths lock the lot
  // row FOR UPDATE first (same pattern as consume-lots.ts) so a concurrent
  // packing session or sale cannot draw from it between our read and write.

  /**
   * Lock a direct lot and report whether anything has drawn on it yet. `used`
   * is true once any packing session, fill job, packed stock, raw exit or stock
   * adjustment references it, or its remaining kg differs from what was bought.
   */
  private async lockDirectLot(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "stock_lots" WHERE id = ${id} FOR UPDATE`);
    const lot = await tx.stockLot.findUnique({
      where: { id },
      include: {
        _count: {
          select: { sessionLots: true, fillJobLots: true, packedStocks: true, rawExits: true, stockAdjustments: true },
        },
      },
    });
    if (!lot) {
      throw new NotFoundException({ error: 'Stock lot not found', code: 'NOT_FOUND' });
    }
    if (lot.source !== 'direct') {
      throw new BadRequestException({
        error: 'Only local purchases can be changed here; container stock is corrected on its container',
        code: 'NOT_DIRECT_LOT',
      });
    }
    const c = lot._count;
    const used =
      c.sessionLots + c.fillJobLots + c.packedStocks + c.rawExits + c.stockAdjustments > 0 ||
      !new Decimal(lot.kgRemaining.toString()).eq(new Decimal(lot.kgReceived.toString()));
    return { lot, used };
  }

  /**
   * Correct a local purchase (PATCH /stock-lots/:id, owner only).
   * - kgReceived: kgRemaining moves by the same difference; rejected if that would
   *   take it below 0 (i.e. below what was already packed/sold/used).
   * - charcoalType / grade: only while the lot is unused, because once it has been
   *   packed or sold, history already reports it under the old type.
   * - supplierId / costPerKg / dateReceived / notes: always. The supplier balance
   *   and statement are computed live from the lot, so they follow the fix.
   */
  async update(id: string, dto: UpdateStockLotDto, userRole?: string) {
    if (dto.kgReceived !== undefined && !new Decimal(dto.kgReceived).gt(0)) {
      throw new BadRequestException({ error: 'Kg must be greater than zero', code: 'CONSTRAINT_VIOLATION' });
    }
    if (dto.costPerKg !== undefined && new Decimal(dto.costPerKg).lt(0)) {
      throw new BadRequestException({ error: 'Cost per kg cannot be negative', code: 'CONSTRAINT_VIOLATION' });
    }
    if (dto.supplierId !== undefined) {
      const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier) {
        throw new NotFoundException({ error: 'Supplier not found', code: 'NOT_FOUND' });
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const { lot, used } = await this.lockDirectLot(tx, id);

      const typeChanged =
        (dto.charcoalType !== undefined && dto.charcoalType.trim() !== lot.charcoalType) ||
        (dto.grade !== undefined && dto.grade !== lot.grade);
      if (typeChanged && used) {
        throw new ConflictException({
          error: 'Type and grade can no longer be changed because this stock has already been used',
          code: 'LOT_IN_USE',
        });
      }

      const data: Prisma.StockLotUpdateInput = {};
      if (dto.kgReceived !== undefined) {
        const oldReceived = new Decimal(lot.kgReceived.toString());
        const oldRemaining = new Decimal(lot.kgRemaining.toString());
        const newReceived = new Decimal(dto.kgReceived);
        const newRemaining = oldRemaining.plus(newReceived.minus(oldReceived));
        if (newRemaining.lt(0)) {
          const usedKg = oldReceived.minus(oldRemaining);
          throw new BadRequestException({
            error: `${usedKg.toNumber()} kg of this lot is already used, so kg bought cannot be less than that`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
        data.kgReceived = newReceived.toFixed(3);
        data.kgRemaining = newRemaining.toFixed(3);
      }
      if (dto.charcoalType !== undefined) data.charcoalType = dto.charcoalType.trim();
      if (dto.grade !== undefined) data.grade = dto.grade;
      if (dto.supplierId !== undefined) data.supplier = { connect: { id: dto.supplierId } };
      if (dto.costPerKg !== undefined) data.costPerKg = dto.costPerKg;
      if (dto.dateReceived !== undefined) data.dateReceived = new Date(dto.dateReceived);
      if (dto.notes !== undefined) data.notes = dto.notes.trim() || null;

      return tx.stockLot.update({ where: { id }, data, include: { supplier: SAFE_SUPPLIER_SELECT } });
    });

    return this.maybeStrip(updated, userRole);
  }

  /**
   * Delete a local purchase entered by mistake (DELETE /stock-lots/:id, owner only).
   * Only while nothing has used it; afterwards correct it with update() or a stock
   * adjustment instead, so packing/sales history never points at a missing lot.
   */
  async remove(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const { used } = await this.lockDirectLot(tx, id);
      if (used) {
        throw new ConflictException({
          error: 'This stock has already been used (packed, sold or adjusted) and cannot be deleted. Edit it instead.',
          code: 'LOT_IN_USE',
        });
      }
      await tx.stockLot.delete({ where: { id } });
    });
    return { id, deleted: true };
  }
}
