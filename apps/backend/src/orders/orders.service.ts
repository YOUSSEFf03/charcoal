import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return a paginated list of orders with optional filters.
   *
   * @param page - 1-indexed page
   * @param limit - Items per page
   * @param clientId - Optional client filter
   * @param status - Optional status filter
   */
  async findAll(
    page: number,
    limit: number,
    clientId?: string,
    status?: OrderStatus,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.ClientOrderWhereInput = {
      ...(clientId ? { clientId } : {}),
      ...(status ? { status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.clientOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { id: true, name: true } },
          orderBagLines: { include: { bagType: true } },
        },
      }),
      this.prisma.clientOrder.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Return a single order with client, shipments and bag lines.
   *
   * @param id - Order UUID
   * @throws NotFoundException if not found
   */
  async findOne(id: string) {
    const order = await this.prisma.clientOrder.findUnique({
      where: { id },
      include: {
        client: true,
        shipments: { include: { bags: { include: { bagType: true } } } },
        orderBagLines: { include: { bagType: true } },
        invoices: true,
      },
    });
    if (!order) {
      throw new NotFoundException({ error: 'Order not found', code: 'NOT_FOUND' });
    }
    // Alias orderBagLines → bagLines so the frontend can use either name.
    return { ...order, bagLines: order.orderBagLines };
  }

  /**
   * Create a new client order.
   *
   * Side-effects:
   *   - updates client.lastOrderDate to today
   *   - recalculates client.avgOrderDays as the gap between the previous
   *     lastOrderDate and today (rolling single-step update)
   *
   * @param dto - Order creation data
   * @param userId - clerkId of the authenticated user (from @CurrentUser)
   */
  async create(dto: CreateOrderDto, userId: string) {
    // Resolve the internal User record from the Clerk sub
    const user = await this.prisma.user.findUnique({
      where: { clerkId: userId },
    });
    if (!user) {
      throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    }

    // Validate client exists
    const client = await this.prisma.client.findUnique({
      where: { id: dto.clientId },
    });
    if (!client) {
      throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });
    }

    // Compute avgOrderDays update
    const today = new Date();
    let newAvgOrderDays: number | null = null;
    if (client.lastOrderDate) {
      const daysDiff = Math.floor(
        (today.getTime() - client.lastOrderDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      if (client.avgOrderDays !== null && client.avgOrderDays !== undefined) {
        // Rolling average: simple mean of old avg and new gap
        const oldAvg = parseFloat(client.avgOrderDays.toString());
        newAvgOrderDays = (oldAvg + daysDiff) / 2;
      } else {
        newAvgOrderDays = daysDiff;
      }
    }

    // Create the order and update client in a transaction
    const [order] = await this.prisma.$transaction([
      this.prisma.clientOrder.create({
        data: {
          clientId: dto.clientId,
          charcoalType: dto.charcoalType,
          grade: dto.grade,
          totalKgRequested: dto.totalKgRequested,
          ...(dto.bagTypeId ? { bagTypeId: dto.bagTypeId } : {}),
          pricePerBag: dto.pricePerBag,
          currency: dto.currency,
          createdById: user.id,
          ...(dto.notes ? { notes: dto.notes } : {}),
        },
        include: {
          client: { select: { id: true, name: true } },
          orderBagLines: true,
        },
      }),
      this.prisma.client.update({
        where: { id: dto.clientId },
        data: {
          lastOrderDate: today,
          ...(newAvgOrderDays !== null
            ? { avgOrderDays: newAvgOrderDays.toFixed(2) }
            : {}),
        },
      }),
    ]);

    return order;
  }

  /**
   * Update an existing order (all fields optional).
   *
   * @param id - Order UUID
   * @param dto - Partial update data
   */
  async update(id: string, dto: UpdateOrderDto) {
    await this.findOne(id);

    return this.prisma.clientOrder.update({
      where: { id },
      data: {
        ...(dto.clientId !== undefined ? { clientId: dto.clientId } : {}),
        ...(dto.charcoalType !== undefined
          ? { charcoalType: dto.charcoalType }
          : {}),
        ...(dto.grade !== undefined ? { grade: dto.grade } : {}),
        ...(dto.totalKgRequested !== undefined
          ? { totalKgRequested: dto.totalKgRequested }
          : {}),
        ...(dto.bagTypeId !== undefined ? { bagTypeId: dto.bagTypeId } : {}),
        ...(dto.pricePerBag !== undefined
          ? { pricePerBag: dto.pricePerBag }
          : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }

  /**
   * Delete a draft order with no linked shipments.
   *
   * @param id - Order UUID
   * @throws NotFoundException if order does not exist
   * @throws ConflictException if order has shipments or is not in draft status
   */
  async remove(id: string): Promise<void> {
    const order = await this.findOne(id);

    if (order.status !== 'draft') {
      throw new ConflictException({
        error: 'Only draft orders can be deleted',
        code: 'CONFLICT',
      });
    }

    if (order.shipments && order.shipments.length > 0) {
      throw new ConflictException({
        error: 'Order has linked shipments and cannot be deleted',
        code: 'CONFLICT',
      });
    }

    await this.prisma.clientOrder.delete({ where: { id } });
  }
}
