import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockLotDto } from './dto/create-stock-lot.dto';

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
}
