import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockLotDto } from './dto/create-stock-lot.dto';

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
        include: { supplier: true },
      }),
      this.prisma.stockLot.count({ where }),
    ]);

    const data = lots.map((lot) => this.maybeStrip(lot, userRole));

    return { data, total, page, limit };
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
      include: { supplier: true },
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
      include: { supplier: true },
    });
  }
}
