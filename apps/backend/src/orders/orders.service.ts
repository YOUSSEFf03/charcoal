import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly shipments: ShipmentsService,
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
   * Mark an order delivered. Shipments are NOT required — this business's
   * workflow is New Order → Mark Delivered directly, with no
   * shipment/delivery-address step in between (shipments remain a separate,
   * optional feature for whoever still uses driver trips / DriverMobile; see
   * ShipmentsService.confirmDelivery()).
   *
   * Stock handling branches on whether the order happens to have an active
   * (non-cancelled) shipment:
   *   - Has one or more → drain them via ShipmentsService.drainShipment(),
   *     UNCHANGED from before — preserves correctness for any order that DID
   *     go through the shipment/reservation flow (legacy data, or a future
   *     caller that still creates one via POST /shipments directly).
   *   - Has none (the normal case now — nothing in the UI creates a shipment
   *     for an order anymore) → deduct PackedStock directly against the
   *     order's own line via ShipmentsService.drainPackedStockDirect(), using
   *     the EXACT same qty formula InvoicesService.createFromOrder() uses to
   *     build the invoice line (round(totalKgRequested / bagType.nominalKg)),
   *     so the invoice and the physical deduction can never disagree on how
   *     many bags this order actually contains.
   * These two paths are mutually exclusive per order, so an order can never
   * be drained twice over for the same delivery.
   *
   * KG orders (bagTypeId null) have no packed-stock line to deduct — this
   * pre-existing gap (no order-level raw-lot deduction exists anywhere in
   * this codebase, shipment-based or otherwise) is unchanged by this method.
   *
   * Idempotent: an order that is already delivered/invoiced/paid is returned
   * as-is with no further deduction or transaction — this is what prevents a
   * double deduction if Mark Delivered is clicked twice in a row.
   *
   * The stock deduction and the order-status write happen inside one
   * transaction — insufficient stock rolls everything back (no partial
   * deduction, order status unchanged), and the invoice below is only ever
   * reached once that transaction has committed.
   *
   * @param id - Order UUID
   * @param userId - Clerk user ID from @CurrentUser — resolved to the internal
   *   User.id stamped on every StockExit this creates (CONSTRAINT 5)
   * @throws NotFoundException if the order or caller user does not exist
   * @throws BadRequestException (CONSTRAINT_VIOLATION) if packed stock can't
   *   cover the order's bag line — rolls back the whole transaction
   */
  async markDelivered(id: string, userId: string) {
    const order = await this.findOne(id);

    // Idempotent no-op — already delivered (or further along); nothing to
    // (re-)drain and nothing new to invoice. Prevents a double deduction on a
    // second click.
    if (['delivered', 'invoiced', 'paid'].includes(order.status)) {
      return order;
    }

    const activeShipments = order.shipments.filter(s => s.status !== 'cancelled');

    // Resolve caller before opening a transaction — needed to stamp
    // StockExit.loggedById for whatever gets drained below (CONSTRAINT 5:
    // never from a DTO/request body).
    const user = await this.prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) {
      throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    }

    // Generous timeout — same reasoning as ShipmentsService.confirmDelivery():
    // a FIFO drain can touch several packed-stock rows.
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      if (activeShipments.length > 0) {
        // Legacy/shipment-bearing path — unchanged.
        for (const activeShipment of activeShipments) {
          if (activeShipment.status === 'delivered') continue;

          // Re-fetch inside the transaction with reservations + their packed-stock
          // rows — findOne()'s outer include doesn't carry these (it's the public
          // order-detail payload and has no reason to expose reservation internals).
          const shipment = await tx.shipment.findUnique({
            where: { id: activeShipment.id },
            include: { reservations: { include: { packedStock: true } } },
          });
          if (!shipment) continue; // defense in depth — existed a moment ago on the order

          await this.shipments.drainShipment(tx, shipment, user.id);
        }
      } else if (order.bagTypeId) {
        // Normal path — no shipment. Lock the order row BEFORE reading it —
        // unlike the shipment-based branch (whose quantity is anchored to
        // already-created ShipmentReservation rows, immune to later order
        // edits), this branch derives its deduction quantity directly from
        // totalKgRequested/bagTypeId. OrdersService.update() only blocks
        // editing those fields once status !== 'draft', and every order is
        // still 'draft' right up until this transaction commits — so without
        // this lock, a concurrent PATCH could commit a totalKgRequested/
        // bagTypeId change in the gap between this read and the status write
        // below, after which createFromOrder()'s own fresh read (post-commit)
        // would compute a different qty than what was actually deducted here.
        // update() itself takes no lock, so this side must be the one to
        // serialize against it.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "client_orders" WHERE id = ${id} FOR UPDATE`);
        const freshOrder = await tx.clientOrder.findUnique({
          where: { id },
          include: { bagType: true },
        });
        if (!freshOrder) {
          throw new NotFoundException({ error: 'Order not found', code: 'NOT_FOUND' });
        }
        if (freshOrder.bagTypeId && freshOrder.bagType) {
          // Same formula InvoicesService.createFromOrder() uses to build the
          // invoice line — keeps the invoice and the physical deduction in
          // agreement on bag count.
          const qty = Math.round(
            parseFloat(freshOrder.totalKgRequested.toString()) /
              parseFloat(freshOrder.bagType.nominalKg.toString()),
          );
          await this.shipments.drainPackedStockDirect(tx, freshOrder.bagTypeId, qty, id, user.id);
        }
      }
      // KG order (bagTypeId null) with no shipment: nothing to deduct —
      // pre-existing gap, see doc comment above.

      return tx.clientOrder.update({
        where: { id },
        data: { status: 'delivered' },
      });
    }, { timeout: 15_000, maxWait: 5_000 });

    // Auto-create and immediately issue the invoice. Not wrapped in the same
    // transaction — if this fails, the order is still marked delivered with
    // stock already correctly drained, and the owner can use
    // POST /orders/:id/invoice to generate it manually. If the stock drain
    // itself failed above, the transaction rolled back and this line is never
    // reached — the invoice can never be issued for undelivered stock.
    await this.invoices.createFromOrder(id, undefined, true);

    return updatedOrder;
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
