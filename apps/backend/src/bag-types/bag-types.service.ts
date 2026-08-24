import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBagTypeDto } from './dto/create-bag-type.dto';
import { UpdateBagTypeDto } from './dto/update-bag-type.dto';

@Injectable()
export class BagTypesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Cost-field helper (CONSTRAINT 12)
  // ---------------------------------------------------------------------------

  private stripCostFields(bagType: any): any {
    const b = { ...bagType };
    delete b.costPerBag;
    delete b.workerRate;
    return b;
  }

  private maybeStrip(data: any, role?: string): any {
    if (role === 'sales_rep' || role === 'worker') return this.stripCostFields(data);
    return data;
  }

  // Neither CreateBagTypeDto nor UpdateBagTypeDto had any decorator-level bound
  // on these decimal-string fields (unlike CreateBagPurchaseDto.quantity's
  // @Min(1) or FillJob's @Min(0.001) kg fields) — a zero/negative nominalKg
  // would silently corrupt every downstream kg computation that treats a bag
  // type as its base unit (order lines, shipment weights, yield %); negative
  // cost/rate fields are equally nonsensical. Zero is allowed for
  // costPerBag/workerRate (free bags / unpaid packing are legitimate), only
  // nominalKg must be strictly positive since it's a physical unit of measure.
  private validatePositiveFields(dto: { nominalKg?: string; costPerBag?: string; workerRate?: string }): void {
    if (dto.nominalKg !== undefined && !new Decimal(dto.nominalKg).gt(0)) {
      throw new BadRequestException({
        error: 'nominalKg must be greater than zero',
        code: 'CONSTRAINT_VIOLATION',
      });
    }
    if (dto.costPerBag !== undefined && new Decimal(dto.costPerBag).lt(0)) {
      throw new BadRequestException({
        error: 'costPerBag cannot be negative',
        code: 'CONSTRAINT_VIOLATION',
      });
    }
    if (dto.workerRate !== undefined && new Decimal(dto.workerRate).lt(0)) {
      throw new BadRequestException({
        error: 'workerRate cannot be negative',
        code: 'CONSTRAINT_VIOLATION',
      });
    }
  }

  /**
   * Retrieve a paginated list of bag types.
   *
   * @param page - Page number (1-indexed)
   * @param limit - Number of items per page
   * @param userRole - Role used for CONSTRAINT 12 stripping (costPerBag/workerRate
   *   hidden from sales_rep/worker — see StockLotsService/PackedStockService for
   *   the same pattern applied to their own cost fields)
   * @returns Paginated bag type list with data, total count, page, and limit
   */
  async findAll(page: number, limit: number, userRole?: string) {
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.bagType.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.bagType.count(),
    ]);
    return { data: data.map((bagType) => this.maybeStrip(bagType, userRole)), total, page, limit };
  }

  /**
   * Retrieve a bag type by ID.
   *
   * @param id - Bag type UUID
   * @param userRole - Role used for CONSTRAINT 12 stripping (see findAll())
   * @returns BagType object
   * @throws NotFoundException - If bag type with given ID does not exist
   */
  async findOne(id: string, userRole?: string) {
    const bagType = await this.prisma.bagType.findUnique({ where: { id } });
    if (!bagType) {
      throw new NotFoundException({ error: 'Bag type not found', code: 'NOT_FOUND' });
    }
    return this.maybeStrip(bagType, userRole);
  }

  /**
   * Create a new bag type with the provided data.
   *
   * @param dto - Bag type creation data
   * @returns Newly created BagType object
   */
  async create(dto: CreateBagTypeDto) {
    this.validatePositiveFields(dto);
    try {
      return await this.prisma.bagType.create({
        data: {
          name: dto.name,
          nominalKg: dto.nominalKg,
          costPerBag: dto.costPerBag,
          workerRate: dto.workerRate,
          note: dto.note,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ error: 'A bag type with this name already exists', code: 'CONFLICT' });
      }
      throw e;
    }
  }

  /**
   * Update an existing bag type with partial or complete data.
   *
   * @param id - Bag type UUID
   * @param dto - Partial update data
   * @returns Updated BagType object
   * @throws NotFoundException - If bag type with given ID does not exist
   */
  async update(id: string, dto: UpdateBagTypeDto) {
    await this.findOne(id);
    this.validatePositiveFields(dto);
    try {
      return await this.prisma.bagType.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.nominalKg !== undefined && { nominalKg: dto.nominalKg }),
          ...(dto.costPerBag !== undefined && { costPerBag: dto.costPerBag }),
          ...(dto.workerRate !== undefined && { workerRate: dto.workerRate }),
          ...(dto.note !== undefined && { note: dto.note }),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ error: 'A bag type with this name already exists', code: 'CONFLICT' });
      }
      throw e;
    }
  }

  /**
   * Delete a bag type by ID.
   *
   * @param id - Bag type UUID
   * @returns void
   * @throws NotFoundException - If bag type with given ID does not exist
   * @throws ConflictException - If bag type is referenced by packed stock, order lines,
   *   shipment bags, stock exits, client orders, or bag purchases. Also thrown (rather than
   *   letting a raw Prisma error escape) if the delete itself hits a foreign-key constraint
   *   the count check didn't anticipate — see the try/catch below.
   */
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const [packed, orderLines, shipmentBags, stockExits, clientOrders, bagPurchases] =
      await Promise.all([
        this.prisma.packedStock.count({ where: { bagTypeId: id } }),
        this.prisma.orderBagLine.count({ where: { bagTypeId: id } }),
        this.prisma.shipmentBag.count({ where: { bagTypeId: id } }),
        this.prisma.stockExit.count({ where: { bagTypeId: id } }),
        this.prisma.clientOrder.count({ where: { bagTypeId: id } }),
        this.prisma.bagPurchase.count({ where: { bagTypeId: id } }),
      ]);
    if (packed + orderLines + shipmentBags + stockExits + clientOrders + bagPurchases > 0) {
      throw new ConflictException({
        error: 'Bag type has linked records',
        code: 'CONFLICT',
      });
    }
    try {
      await this.prisma.bagType.delete({ where: { id } });
    } catch (e) {
      // Defense in depth: if some relation is added later and this guard isn't updated
      // to match, fail as a clean 409 instead of leaking a raw Prisma error as a 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ConflictException({
          error: 'Bag type has linked records',
          code: 'CONFLICT',
        });
      }
      throw e;
    }
  }
}
