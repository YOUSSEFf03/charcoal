import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieve a paginated list of suppliers with optional name filtering.
   *
   * @param page - Page number (1-indexed)
   * @param limit - Number of items per page
   * @param search - Optional supplier name filter (case-insensitive substring match)
   * @returns Paginated supplier list with data, total count, page, and limit
   */
  async findAll(page: number, limit: number, search?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.SupplierWhereInput = search
      ? { name: { contains: search, mode: 'insensitive' } }
      : {};

    const [data, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Retrieve a supplier by ID with associated containers.
   *
   * @param id - Supplier UUID
   * @returns Supplier object with containers ordered by creation date
   * @throws NotFoundException - If supplier with given ID does not exist
   */
  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: { containers: { orderBy: { createdAt: 'desc' } } },
    });
    if (!supplier) {
      throw new NotFoundException({
        error: 'Supplier not found',
        code: 'NOT_FOUND',
      });
    }
    return supplier;
  }

  /**
   * Create a new supplier with the provided data.
   *
   * @param dto - Supplier creation data
   * @returns Newly created Supplier object
   */
  async create(dto: CreateSupplierDto) {
    return this.prisma.supplier.create({
      data: {
        name: dto.name,
        country: dto.country,
        ...(dto.contactPersons !== undefined
          ? { contactPersons: dto.contactPersons as Prisma.InputJsonValue }
          : {}),
        ...(dto.charcoalTypes !== undefined
          ? { charcoalTypes: dto.charcoalTypes as Prisma.InputJsonValue }
          : {}),
        ...(dto.bankDetails !== undefined
          ? { bankDetails: dto.bankDetails as Prisma.InputJsonValue }
          : {}),
        paymentTerms: dto.paymentTerms,
        leadTimeDays: dto.leadTimeDays,
        notes: dto.notes,
      },
    });
  }

  /**
   * Update an existing supplier with partial or complete data.
   *
   * @param id - Supplier UUID
   * @param dto - Partial update data
   * @returns Updated Supplier object
   * @throws NotFoundException - If supplier with given ID does not exist
   */
  async update(id: string, dto: UpdateSupplierDto) {
    await this.findOne(id);

    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.country !== undefined ? { country: dto.country } : {}),
        ...(dto.contactPersons !== undefined
          ? { contactPersons: dto.contactPersons as Prisma.InputJsonValue }
          : {}),
        ...(dto.charcoalTypes !== undefined
          ? { charcoalTypes: dto.charcoalTypes as Prisma.InputJsonValue }
          : {}),
        ...(dto.bankDetails !== undefined
          ? { bankDetails: dto.bankDetails as Prisma.InputJsonValue }
          : {}),
        ...(dto.paymentTerms !== undefined
          ? { paymentTerms: dto.paymentTerms }
          : {}),
        ...(dto.leadTimeDays !== undefined
          ? { leadTimeDays: dto.leadTimeDays }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }

  /**
   * Delete a supplier by ID.
   *
   * @param id - Supplier UUID
   * @returns void
   * @throws NotFoundException - If supplier with given ID does not exist
   * @throws ConflictException - If supplier has linked containers or stock lots
   */
  async remove(id: string): Promise<void> {
    await this.findOne(id);

    const [containerCount, lotCount] = await Promise.all([
      this.prisma.container.count({ where: { supplierId: id } }),
      this.prisma.stockLot.count({ where: { supplierId: id } }),
    ]);
    if (containerCount > 0 || lotCount > 0) {
      throw new ConflictException({
        error: 'Supplier has linked records',
        code: 'CONFLICT',
      });
    }
    await this.prisma.supplier.delete({ where: { id } });
  }
}
