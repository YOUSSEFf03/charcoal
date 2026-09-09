import {
  BadRequestException,
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
          location: { select: { id: true, name: true } },
        },
      }),
      this.prisma.clientOrder.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Statuses that still require delivery action — i.e. NOT
   * ['delivered','invoiced','paid']. Mirrors the exact condition
   * OrderDetail.tsx already uses to decide whether to show its "Mark as
   * delivered" button, and the exact inverse of the `hasDeliveredOrder` set
   * InvoicesService.cancel() checks (['delivered','partially_delivered',
   * 'invoiced','paid']) — both independently confirm this is the real
   * "delivery not yet complete" boundary already recognized elsewhere in the
   * codebase, not a frontend invention.
   *
   * 'confirmed' is included for schema-correctness (a real OrderStatus enum
   * value meaning "further along than draft, still not delivered") even
   * though nothing in the current codebase ever writes it — CreateOrderDto/
   * UpdateOrderDto have no `status` field, so every order is created
   * 'draft' and moves directly to 'delivered' via markDelivered(). 'draft'
   * is therefore the real, everyday "awaiting delivery" state today, not
   * merely an unsubmitted/editable draft — see markDelivered()'s doc
   * comment: "New Order → Mark Delivered directly, with no shipment/
   * delivery-address step in between."
   */
  private static readonly DELIVERY_QUEUE_STATUSES: OrderStatus[] = [
    'draft',
    'confirmed',
    'partially_delivered',
  ];

  /**
   * Return a paginated "delivery queue" — orders that still require delivery
   * action (see DELIVERY_QUEUE_STATUSES) — with its OWN pagination/search/
   * filter/sort, entirely independent of findAll()'s order-history listing.
   * A minimal select (no shipments/invoices/bagLines) keeps this fast: it's
   * an operational queue, polled/refreshed far more often than the history
   * list.
   *
   * Sorting: no backend "priority" field exists (deliberately not invented —
   * see the ticket this implements). Default is `createdAt` ascending —
   * oldest-waiting-first, the standard FIFO operational-queue default absent
   * any richer signal. Every order returned already "requires attention" by
   * virtue of the status filter alone, so there is no further tier to sort
   * by first. `status`/`client`/`weight` sorts are offered as explicit,
   * user-chosen alternatives, never assumed.
   *
   * @param page - 1-indexed page
   * @param limit - Items per page (small — this renders as cards, not table rows)
   * @param search - Case-insensitive client-name search (same pattern as findAll())
   * @param driverId - Optional: only orders assigned to this driver
   * @param status - Optional: narrows to one of DELIVERY_QUEUE_STATUSES; any
   *   other value is ignored (same "unrecognized falls back to default"
   *   convention as findAll()'s sortBy) rather than erroring — a status
   *   outside this set could never appear in the queue anyway.
   * @param sortBy - 'createdAt' (default) | 'client' | 'weight' | 'status'
   * @param sortOrder - 'asc' (default) | 'desc'
   */
  async findDeliveryQueue(
    page: number,
    limit: number,
    search?: string,
    driverId?: string,
    status?: OrderStatus,
    sortBy?: string,
    sortOrder?: string,
  ) {
    const skip = (page - 1) * limit;
    const statusFilter =
      status && OrdersService.DELIVERY_QUEUE_STATUSES.includes(status)
        ? [status]
        : OrdersService.DELIVERY_QUEUE_STATUSES;

    const where: Prisma.ClientOrderWhereInput = {
      status: { in: statusFilter },
      ...(driverId ? { driverId } : {}),
      ...(search ? { client: { name: { contains: search, mode: 'insensitive' } } } : {}),
    };

    const direction: Prisma.SortOrder = sortOrder === 'desc' ? 'desc' : 'asc';
    const orderBy: Prisma.ClientOrderOrderByWithRelationInput =
      sortBy === 'client' ? { client: { name: direction } } :
      sortBy === 'weight' ? { totalKgRequested: direction } :
      sortBy === 'status' ? { status: direction } :
      { createdAt: direction };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.clientOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          displayId: true,
          clientId: true,
          client: { select: { id: true, name: true } },
          charcoalType: true,
          grade: true,
          totalKgRequested: true,
          bagTypeId: true,
          bagType: { select: { id: true, name: true, nominalKg: true } },
          status: true,
          createdAt: true,
          driverId: true,
          driver: { select: { id: true, name: true } },
          locationId: true,
          location: { select: { id: true, name: true } },
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
        location: { select: { id: true, name: true } },
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

    // Every downstream balance/ledger calculation (ClientBalanceService, Payments,
    // getClientLedger, getArSummary) assumes an order's currency — and therefore
    // its eventual invoice's currency — always matches the client's own currency;
    // Payment.amount is always stored in the client's currency (PaymentsService),
    // so a mismatched order/invoice currency would compare unlike units when its
    // paidAmount/status is recomputed. Reject rather than silently store it.
    if (dto.currency !== client.currency) {
      throw new BadRequestException({
        message: `Order currency (${dto.currency}) must match the client's currency (${client.currency})`,
        error: `Order currency (${dto.currency}) must match the client's currency (${client.currency})`,
        code: 'CONSTRAINT_VIOLATION',
      });
    }

    // Multiple-locations audit, 2026-08-31 (creation requirement, 2026-09):
    // once a client is enabled for multiple locations, every NEW normal order
    // must be tied to one of that client's own active locations — never
    // silently created with no branch. Single-location clients are unaffected
    // (locationId stays optional, exactly as before). This requirement is
    // creation-only by explicit product decision — see update()'s own
    // comment for why editing an existing order never re-triggers it.
    if (client.multiLocationEnabled && !dto.locationId) {
      throw new BadRequestException({
        error: 'Location is required for clients with multiple locations enabled',
        code: 'CONSTRAINT_VIOLATION',
      });
    }
    // A selected location must actually belong to THIS client and be active —
    // never silently attach another client's branch, or one the owner
    // already deactivated.
    if (dto.locationId) {
      await this.validateLocation(dto.clientId, dto.locationId);
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
          ...(dto.locationId ? { locationId: dto.locationId } : {}),
        },
        include: {
          client: { select: { id: true, name: true } },
          orderBagLines: true,
          location: { select: { id: true, name: true } },
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

    // Same invariant enforced at create() — an order's currency must always
    // match its client's currency (see create()'s comment). Only relevant here
    // while still draft (clientId/currency locked otherwise, guarded above):
    // changing either field independently could otherwise desync them.
    if (dto.clientId !== undefined || dto.currency !== undefined) {
      const effectiveClient = dto.clientId !== undefined
        ? await this.prisma.client.findUnique({ where: { id: dto.clientId } })
        : order.client;
      if (!effectiveClient) {
        throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });
      }
      const effectiveCurrency = dto.currency ?? order.currency;
      if (effectiveCurrency !== effectiveClient.currency) {
        throw new BadRequestException({
          message: `Order currency (${effectiveCurrency}) must match the client's currency (${effectiveClient.currency})`,
          error: `Order currency (${effectiveCurrency}) must match the client's currency (${effectiveClient.currency})`,
          code: 'CONSTRAINT_VIOLATION',
        });
      }
    }

    // Multiple-locations audit, 2026-08-31: locationId is editable in any
    // status (informational provenance, like notes/driverId/supplierName —
    // never financially significant) — but a non-null value must still
    // belong to the order's EFFECTIVE client (the new one if clientId is
    // also being changed, otherwise the order's existing one) and be active.
    if (dto.locationId) {
      const effectiveClientId = dto.clientId ?? order.clientId;
      await this.validateLocation(effectiveClientId, dto.locationId);
    }

    // Update-time requirement (explicit product decision, 2026-09): unlike
    // create(), enabling multi-location for a client NEVER retroactively
    // requires a location on its existing orders — an order that has always
    // had locationId: null (historical, or created before the client
    // switched on multi-location) stays editable and stays null forever,
    // unless the user explicitly assigns a real location themselves. This is
    // the direct continuation of the earlier rule: "Existing orders keep
    // locationId = NULL; no fabrication anywhere."
    //
    // The ONE thing blocked here: an order that already HAS a location
    // cannot have it explicitly cleared back to null while its client is
    // still multi-location-enabled — that would silently regress an order
    // that once had real branch provenance. Changing it to a DIFFERENT valid
    // active location (handled by validateLocation() above) remains allowed.
    if (dto.locationId === null && order.locationId) {
      const effectiveClient = dto.clientId !== undefined
        ? await this.prisma.client.findUnique({ where: { id: dto.clientId } })
        : order.client;
      if (effectiveClient?.multiLocationEnabled) {
        throw new BadRequestException({
          error: 'Location cannot be cleared for a multi-location client\'s order — assign a different active location instead',
          code: 'CONSTRAINT_VIOLATION',
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
        ...(dto.locationId !== undefined ? { locationId: dto.locationId } : {}),
      },
    });
  }

  /**
   * Multiple-locations audit, 2026-08-31: a location must belong to the
   * SAME client the order is for (never another client's branch) and be
   * active (never a deactivated one, which would silently attach a "dead"
   * branch to a brand-new order). Never validates anything about the
   * client's balance/ledger — location is pure provenance, see
   * ClientLocation's schema.prisma doc comment.
   */
  private async validateLocation(clientId: string, locationId: string) {
    const location = await this.prisma.clientLocation.findUnique({ where: { id: locationId } });
    if (!location || location.clientId !== clientId) {
      throw new NotFoundException({ error: 'Location not found for this client', code: 'NOT_FOUND' });
    }
    if (!location.isActive) {
      throw new BadRequestException({
        error: `Location "${location.name}" is deactivated and cannot be assigned to a new order`,
        code: 'CONSTRAINT_VIOLATION',
      });
    }
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
   * Idempotent, including under concurrency: an order that is already
   * delivered/invoiced/paid short-circuits before opening a transaction at
   * all (the common sequential-repeat-call case). But two requests can also
   * arrive close enough together that BOTH read that same pre-commit status
   * and pass this outer check — a double click that outran the frontend's
   * pending-state disable, or a retried request. For that race window, the
   * transaction itself opens by locking the order row (`SELECT ... FOR
   * UPDATE`) before reading anything else, then re-checks status against
   * that fresh, lock-protected read: the second transaction blocks behind
   * the first, and once unblocked sees the now-delivered status and returns
   * without draining or crediting anything a second time. This is what
   * actually prevents a double deduction — the outer check alone cannot,
   * since two concurrent callers can both observe "not yet delivered".
   *
   * The stock deduction and the order-status write happen inside that same
   * transaction — insufficient stock rolls everything back (no partial
   * deduction, order status unchanged), and the invoice below is only ever
   * reached once the transaction has committed.
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

    // Fast-path idempotent no-op — already delivered (or further along).
    // Only an optimization for the ordinary sequential repeat call (skips
    // opening a transaction); it does NOT by itself make concurrent calls
    // safe — see the lock+recheck inside the transaction below, which is
    // what actually closes that race.
    if (['delivered', 'invoiced', 'paid'].includes(order.status)) {
      return order;
    }

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
      // Lock the order row FIRST, before reading anything else — for every
      // path, not just the direct-deduction branch. Two concurrent
      // markDelivered() calls for the same order both pass the outer
      // idempotency check above (both read the same pre-commit status), so
      // without this lock both could proceed to drain stock / advance status.
      // The second call now blocks here until the first commits; the
      // re-check immediately below then sees the now-'delivered' status
      // (fresh, lock-protected read) and returns without draining a second
      // time. This also covers the direct-deduction branch's pre-existing
      // reason for this same lock: totalKgRequested/bagTypeId are read fresh
      // here too, closing the race with a concurrent PATCH /orders/:id
      // (update() itself takes no lock, so this side must serialize against it).
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "client_orders" WHERE id = ${id} FOR UPDATE`);
      const freshOrder = await tx.clientOrder.findUnique({
        where: { id },
        include: { bagType: true, shipments: { select: { id: true, status: true } } },
      });
      if (!freshOrder) {
        throw new NotFoundException({ error: 'Order not found', code: 'NOT_FOUND' });
      }
      if (['delivered', 'invoiced', 'paid'].includes(freshOrder.status)) {
        // A concurrent call already delivered this order while this one was
        // blocked on the lock above — nothing left to (re-)drain. Scalar-only
        // re-fetch so the response shape matches the normal path below
        // (tx.clientOrder.update() also returns scalar columns only) — no
        // second response format for the racing-caller case.
        return tx.clientOrder.findUnique({ where: { id } });
      }

      const activeShipments = freshOrder.shipments.filter(s => s.status !== 'cancelled');

      if (activeShipments.length > 0) {
        // Legacy/shipment-bearing path — unchanged.
        for (const activeShipment of activeShipments) {
          if (activeShipment.status === 'delivered') continue;

          // Re-fetch inside the transaction with reservations + their packed-stock
          // rows — the query above doesn't carry these (it only needs id/status to
          // pick the branch and skip cancelled/already-delivered shipments).
          const shipment = await tx.shipment.findUnique({
            where: { id: activeShipment.id },
            include: { reservations: { include: { packedStock: true } } },
          });
          if (!shipment) continue; // defense in depth — existed a moment ago on the order

          await this.shipments.drainShipment(tx, shipment, user.id);
        }
      } else if (freshOrder.bagTypeId && freshOrder.bagType) {
        // Normal path — no shipment. Quantity is derived directly from
        // totalKgRequested/bagTypeId, both already read fresh (and
        // lock-protected, see above) by the query above.
        // Same formula InvoicesService.createFromOrder() uses to build the
        // invoice line — keeps the invoice and the physical deduction in
        // agreement on bag count.
        const qty = Math.round(
          parseFloat(freshOrder.totalKgRequested.toString()) /
            parseFloat(freshOrder.bagType.nominalKg.toString()),
        );
        await this.shipments.drainPackedStockDirect(tx, freshOrder.bagTypeId, qty, id, user.id);
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
    // createFromOrder() is idempotent and race-safe on its own (see its doc
    // comment) — safe to call again even when the branch above short-circuited
    // because a concurrent request already delivered this order.
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
