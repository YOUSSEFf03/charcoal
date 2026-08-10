import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

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
    search?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.ClientOrderWhereInput = {
      ...(clientId ? { clientId } : {}),
      ...(status ? { status } : {}),
      ...(search ? { client: { name: { contains: search, mode: 'insensitive' } } } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.clientOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { id: true, name: true } },
          bagType: { select: { id: true, name: true, nominalKg: true } },
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
        driver: { select: { id: true, name: true } },
        bagType: { select: { id: true, name: true, nominalKg: true } },
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
          ...(dto.driverId ? { driverId: dto.driverId } : {}),
          ...(dto.supplierName ? { supplierName: dto.supplierName } : {}),
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
   * Financially/relationally significant fields (clientId, pricePerBag,
   * currency, totalKgRequested, bagTypeId) may only be changed while the
   * order is still 'draft' — once shipments/stock exits/invoices may exist
   * against the original values, changing them would silently desync those
   * records from the order. notes/driverId/supplierName/charcoalType/grade
   * remain editable in any status.
   *
   * @param id - Order UUID
   * @param dto - Partial update data
   * @throws ConflictException if a protected field is included on a non-draft order
   */
  async update(id: string, dto: UpdateOrderDto) {
    const order = await this.findOne(id);

    if (order.status !== 'draft') {
      const lockedFields = (
        ['clientId', 'pricePerBag', 'currency', 'totalKgRequested', 'bagTypeId'] as const
      ).filter((field) => dto[field] !== undefined);

      if (lockedFields.length > 0) {
        throw new ConflictException({
          error: `Cannot modify ${lockedFields.join(', ')} once an order is no longer in draft status`,
          code: 'CONFLICT',
        });
      }
    }

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
        ...(dto.driverId !== undefined ? { driverId: dto.driverId } : {}),
        ...(dto.supplierName !== undefined ? { supplierName: dto.supplierName } : {}),
      },
    });
  }

  /**
   * Force-mark an order and all its pending shipments as delivered.
   * Intended for owner use when the driver forgets to update status.
   *
   * The shipment and order status writes are wrapped in a single transaction
   * so a failure partway through can never leave shipments marked delivered
   * while the order itself is stuck in an earlier status (or vice versa).
   *
   * After marking the order delivered, a draft invoice is automatically created
   * via createFromOrder(). createFromOrder() is idempotent — safe to call even
   * if the order was already delivered or already has an invoice.
   */
  async markDelivered(id: string) {
    await this.findOne(id);

    const now = new Date();
    const [, order] = await this.prisma.$transaction([
      this.prisma.shipment.updateMany({
        where: { orderId: id, status: { not: 'delivered' } },
        data: { status: 'delivered', deliveredAt: now },
      }),
      this.prisma.clientOrder.update({
        where: { id },
        data: { status: 'delivered' },
      }),
    ]);

    // Auto-create and immediately issue the invoice. Not wrapped in a transaction
    // with the status update — if this fails the order is still marked delivered
    // and the owner can use POST /orders/:id/invoice to generate it manually.
    await this.invoices.createFromOrder(id, undefined, true);

    return order;
  }

  /**
   * Generate (or return existing) invoice for a delivered order.
   * Delegates to createFromOrder() which is idempotent.
   *
   * @param id - ClientOrder UUID
   * @throws NotFoundException if order not found
   * @throws BadRequestException if order is not delivered
   */
  async createInvoiceForOrder(id: string) {
    return this.invoices.createFromOrder(id);
  }

  /**
   * Delete a draft order with no linked shipments.
   *
   * @param id - Order UUID
   * @throws NotFoundException if order does not exist
   * @throws ConflictException if order has shipments, is not in draft status, or
   *   (defense in depth) the delete itself hits a foreign-key constraint the
   *   checks above didn't catch — e.g. a shipment/stock-exit/invoice created in
   *   the narrow window between the checks and the delete — see the try/catch below.
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

    try {
      await this.prisma.clientOrder.delete({ where: { id } });
    } catch (e) {
      // Defense in depth: if a shipment/stock-exit/invoice/etc. was created
      // between the checks above and this delete, fail as a clean 409 instead
      // of leaking a raw Prisma error as a 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ConflictException({
          error: 'Order has linked shipments and cannot be deleted',
          code: 'CONFLICT',
        });
      }
      throw e;
    }
  }
}
