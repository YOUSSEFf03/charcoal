import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBagPurchaseDto } from './dto/create-bag-purchase.dto';

@Injectable()
export class BagPurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieve a paginated list of bag purchases with optional bag type filtering.
   *
   * @param page - Page number (1-indexed)
   * @param limit - Number of items per page
   * @param bagTypeId - Optional filter by bag type UUID
   * @returns Paginated bag purchase list with bagType included, data, total count, page, and limit
   */
  async findAll(page: number, limit: number, bagTypeId?: string) {
    const skip = (page - 1) * limit;
    const where = bagTypeId ? { bagTypeId } : {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.bagPurchase.findMany({
        where,
        skip,
        take: limit,
        include: { bagType: true },
        orderBy: { date: 'desc' },
      }),
      this.prisma.bagPurchase.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Retrieve a bag purchase by ID with associated bag type data.
   *
   * @param id - Bag purchase UUID
   * @returns BagPurchase object with bagType included
   * @throws NotFoundException - If bag purchase with given ID does not exist
   */
  async findOne(id: string) {
    const purchase = await this.prisma.bagPurchase.findUnique({
      where: { id },
      include: { bagType: true },
    });
    if (!purchase) {
      throw new NotFoundException({
        error: 'Bag purchase not found',
        code: 'NOT_FOUND',
      });
    }
    return purchase;
  }

  /**
   * Create a new bag purchase record with user and bag type validation.
   *
   * totalCost is always computed server-side as quantity × unitCost — never
   * accepted from the client. Same principle as InvoiceCalculatorService
   * .computeLines() (qty × price, never a client-supplied line/invoice
   * total): trusting an independently-submitted total invites drift from the
   * two inputs that actually determine it, and the current BagPurchases.tsx
   * UI has no discount/adjustment concept that would ever make the two
   * legitimately differ.
   *
   * @param dto - Bag purchase creation data including bagTypeId, quantity, unitCost, date, and notes
   * @param clerkUserId - Clerk user ID of the authenticated user creating the record
   * @returns Newly created BagPurchase object with bagType included
   * @throws NotFoundException - If clerkUserId has no matching database user or if bagTypeId does not exist
   */
  async create(dto: CreateBagPurchaseDto, clerkUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId: clerkUserId },
    });
    if (!user) {
      throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    }

    const bagType = await this.prisma.bagType.findUnique({
      where: { id: dto.bagTypeId },
    });
    if (!bagType) {
      throw new NotFoundException({
        error: 'Bag type not found',
        code: 'NOT_FOUND',
      });
    }

    const totalCost = new Decimal(dto.quantity).mul(dto.unitCost).toFixed(2);

    return this.prisma.bagPurchase.create({
      data: {
        bagTypeId: dto.bagTypeId,
        quantity: dto.quantity,
        unitCost: dto.unitCost,
        totalCost,
        // BUG-L (P5): capture cost currency so P&L can convert LBP bag purchases.
        // Defaults USD (column default) when omitted.
        ...(dto.currency ? { currency: dto.currency } : {}),
        date: new Date(dto.date),
        notes: dto.notes,
        addedById: user.id,
      },
      include: { bagType: true },
    });
  }
}
