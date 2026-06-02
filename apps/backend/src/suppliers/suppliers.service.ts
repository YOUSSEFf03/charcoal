import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Currency, PaymentMethod, Prisma } from '@prisma/client';
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
      this.prisma.supplier.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.supplier.count({ where }),
    ]);

    // Batch-fetch financial totals for all suppliers on this page.
    const ids = data.map(s => s.id);

    const [spentRows, paidRows] = await Promise.all([
      ids.length > 0
        ? this.prisma.$queryRaw<{ supplierId: string; total_spent: number }[]>`
            SELECT "supplierId", COALESCE(SUM("kgReceived"::numeric * "costPerKg"::numeric), 0) AS total_spent
            FROM stock_lots
            WHERE "supplierId" = ANY(${ids}) AND "costPerKg" IS NOT NULL
            GROUP BY "supplierId"`
        : [],
      ids.length > 0
        ? this.prisma.supplierPayment.groupBy({
            by: ['supplierId'],
            where: { supplierId: { in: ids }, currency: 'USD' },
            _sum: { amount: true },
          })
        : [],
    ]);

    const spentMap  = new Map((spentRows as any[]).map(r => [r.supplierId, parseFloat(r.total_spent)]));
    const paidMap   = new Map((paidRows as any[]).map(r => [r.supplierId, parseFloat(r._sum.amount ?? '0')]));

    const enriched = data.map(s => {
      const spent       = spentMap.get(s.id) ?? 0;
      const paid        = paidMap.get(s.id)  ?? 0;
      const outstanding = spent - paid;
      return {
        ...s,
        totalSpentUsd:  spent.toFixed(2),
        totalPaidUsd:   paid.toFixed(2),
        outstandingUsd: outstanding.toFixed(2),
      };
    });

    return { data: enriched, total, page, limit };
  }

  /**
   * Retrieve a supplier by ID with associated containers.
   *
   * @param id - Supplier UUID
   * @returns Supplier object with containers ordered by creation date
   * @throws NotFoundException - If supplier with given ID does not exist
   */
  async findOne(id: string) {
    const [supplier, containerCount, lots] = await Promise.all([
      this.prisma.supplier.findUnique({
        where: { id },
        include: { containers: { orderBy: { createdAt: 'desc' } } },
      }),
      this.prisma.container.count({ where: { supplierId: id } }),
      this.prisma.stockLot.findMany({
        where: { supplierId: id },
        select: { kgReceived: true, kgRemaining: true, costPerKg: true, charcoalType: true, grade: true },
      }),
    ]);

    if (!supplier) {
      throw new NotFoundException({
        error: 'Supplier not found',
        code: 'NOT_FOUND',
      });
    }

    const activeLotCount = lots.filter(l => parseFloat(l.kgRemaining.toString()) > 0).length;

    const lotsWithCost = lots.filter(l => l.costPerKg != null);
    const totalKgReceived = lots.reduce((s, l) => s + parseFloat(l.kgReceived.toString()), 0);
    const totalKgRemaining = lots.reduce((s, l) => s + parseFloat(l.kgRemaining.toString()), 0);
    const totalSpentUsd = lotsWithCost.reduce(
      (s, l) => s + parseFloat(l.kgReceived.toString()) * parseFloat(l.costPerKg!.toString()),
      0,
    );
    const weightedKg = lotsWithCost.reduce((s, l) => s + parseFloat(l.kgReceived.toString()), 0);
    const avgPricePerKg = weightedKg > 0 ? totalSpentUsd / weightedKg : null;

    // Distinct charcoal types actually purchased (derived from real stock lots).
    const typeMap = new Map<string, { type: string; grade: string; totalKg: number; kgRemaining: number }>();
    for (const lot of lots) {
      const key = `${lot.charcoalType}__${lot.grade}`;
      const existing = typeMap.get(key);
      const kg = parseFloat(lot.kgReceived.toString());
      const rem = parseFloat(lot.kgRemaining.toString());
      if (existing) {
        existing.totalKg += kg;
        existing.kgRemaining += rem;
      } else {
        typeMap.set(key, { type: lot.charcoalType, grade: lot.grade, totalKg: kg, kgRemaining: rem });
      }
    }
    const purchasedTypes = Array.from(typeMap.values()).sort((a, b) => b.totalKg - a.totalKg);

    // Outstanding balance = total spent - total paid (USD only for now)
    const totalPaidUsd = await this.prisma.supplierPayment.aggregate({
      where: { supplierId: id, currency: 'USD' },
      _sum: { amount: true },
    });
    const paidUsd = parseFloat(totalPaidUsd._sum.amount?.toString() ?? '0');
    const outstandingUsd = totalSpentUsd - paidUsd;

    return {
      ...supplier,
      containerCount,
      activeLotCount,
      totalKgReceived: totalKgReceived.toFixed(3),
      totalKgRemaining: totalKgRemaining.toFixed(3),
      totalSpentUsd: totalSpentUsd.toFixed(2),
      totalPaidUsd: paidUsd.toFixed(2),
      outstandingUsd: outstandingUsd.toFixed(2),
      avgPricePerKg: avgPricePerKg != null ? avgPricePerKg.toFixed(4) : null,
      purchasedTypes,
    };
  }

  async findPayments(supplierId: string, page: number, limit: number) {
    await this.findOne(supplierId);
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.supplierPayment.findMany({
        where: { supplierId },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
        include: { loggedBy: { select: { id: true, name: true } }, container: { select: { id: true, number: true } } },
      }),
      this.prisma.supplierPayment.count({ where: { supplierId } }),
    ]);
    return { data, total, page, limit };
  }

  async createPayment(
    supplierId: string,
    body: { amount: string; currency: Currency; method: PaymentMethod; date: string; containerId?: string; notes?: string },
    clerkUserId: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { clerkId: clerkUserId } });
    if (!user) throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    await this.findOne(supplierId);
    return this.prisma.supplierPayment.create({
      data: {
        supplierId,
        amount: body.amount,
        currency: body.currency,
        method: body.method,
        date: new Date(body.date),
        ...(body.containerId ? { containerId: body.containerId } : {}),
        ...(body.notes ? { notes: body.notes } : {}),
        loggedById: user.id,
      },
      include: { loggedBy: { select: { id: true, name: true } } },
    });
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
