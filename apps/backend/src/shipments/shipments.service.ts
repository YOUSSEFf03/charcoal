import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentAllocationService } from '../invoices/payment-allocation.service';
import { LedgerWriteService } from '../ledger/ledger-write.service';
import { UsersService } from '../users/users.service';
import { PackedStockService, PACKED_STOCK_FIFO_ORDER_BY } from '../packed-stock/packed-stock.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ConfirmDeliveryDto } from './dto/confirm-delivery.dto';
import { LogReturnDto } from './dto/log-return.dto';
import { UpdateActualWeightDto } from './dto/update-actual-weight.dto';
import { ClerkUser } from '../auth/clerk.strategy';

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly paymentAllocationService: PaymentAllocationService,
    private readonly ledgerWriteService: LedgerWriteService,
    private readonly usersService: UsersService,
    private readonly packedStockService: PackedStockService,
  ) {}

  /**
   * Return a paginated list of shipments.
   */
  async findAll(
    page: number,
    limit: number,
    orderId?: string,
    status?: ShipmentStatus,
    tripId?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.ShipmentWhereInput = {
      ...(orderId ? { orderId } : {}),
      ...(status ? { status } : {}),
      ...(tripId ? { tripId } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.shipment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          bags: { include: { bagType: true } },
          order: { include: { client: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Return a single shipment with full details.
   *
   * @param id - Shipment UUID
   * @throws NotFoundException
   */
  async findOne(id: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        bags: { include: { bagType: true } },
        order: { include: { client: true } },
        trip: true,
      },
    });
    if (!shipment) {
      throw new NotFoundException({ error: 'Shipment not found', code: 'NOT_FOUND' });
    }
    return shipment;
  }

  /**
   * Create a shipment and RESERVE packed stock for it, pinned to the shipment (BUG-I / P1).
   *
   * The original fix (BUG-2) only kept an unkeyed `reservedQuantity` counter per
   * packed-stock row, so a release could free a DIFFERENT shipment's reservation on a
   * shared bag-type row. We now record a keyed {@link ShipmentReservation} row per
   * (shipment, packedStock) chunk so every reservation belongs to exactly one shipment.
   *
   *   For each bag line, walk packed-stock rows FIFO ({@link PACKED_STOCK_FIFO_ORDER_BY} —
   *   the same deterministic oldest-batch-first tiebreak chain as
   *   PackedStockService.getFifoDraw(); see that method's doc comment for the full
   *   rationale) and validate each row against its FREE quantity
   *   (`quantity − reservedQuantity`). For each chunk taken we upsert a
   *   ShipmentReservation row AND increment the row's denormalized
   *   `reservedQuantity` cache in lockstep (cache always equals Σ of the row's
   *   reservations). If the full line cannot be reserved the whole transaction rolls back.
   *   Reservation does NOT decrement `quantity` — physical bags leave only at delivery;
   *   cancel/return releases this shipment's reservation rows.
   *
   * ── Deterministic ordering (forensic audit, 2026-08-29) ──────────────────
   * This walk used to order by `createdAt asc` alone — the same nondeterministic-tie
   * defect proven and fixed in PackedStockService.getFifoDraw() (sibling PackedStock
   * rows from one packing session's createMany() batch share one client-computed
   * createdAt, so `createdAt asc` alone leaves their relative order SQL-unspecified,
   * resolved in practice by incidental physical tuple layout). This method draws from
   * PackedStock exactly like getFifoDraw()'s callers do, so it carried the identical
   * risk of an ambiguous choice between same-createdAt lots with different
   * charcoalType/grade/costPerKg/dateReceived. Fixed by reusing the same
   * {@link PACKED_STOCK_FIFO_ORDER_BY} tiebreak chain rather than inventing a
   * separate rule.
   *
   * The reservation walk uses the same FIFO order as {@link confirmDelivery} and
   * {@link cancelShipment} so reserve, drain, and release stay consistent.
   *
   * @param dto - Shipment creation data
   * @param userId - Clerk user ID (unused in creation but kept for symmetry)
   * @constraint 4 Σ reserved per bag type never exceeds packed stock (enforced atomically per row)
   */
  async createShipment(dto: CreateShipmentDto, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Create the shipment first so reservation rows can reference its id.
      const shipment = await tx.shipment.create({
        data: {
          orderId: dto.orderId,
          address: dto.address,
          nominalKg: dto.nominalKg,
          ...(dto.tripId ? { tripId: dto.tripId } : {}),
          ...(dto.notes ? { notes: dto.notes } : {}),
          bags: {
            create: dto.bags.map((b) => ({
              bagTypeId: b.bagTypeId,
              quantity: b.quantity,
            })),
          },
        },
      });

      // Lock every PackedStock row that could be drawn from for ANY bag type
      // in this shipment, in ONE statement sorted ascending by id, BEFORE any
      // read — same FOR UPDATE pattern as stock-exits.service.ts, extended to
      // the full candidate set (rather than locking rows one bagType/one FIFO
      // step at a time) so a concurrent reservation, sale, or stock consumer
      // touching an overlapping row always acquires locks in the same
      // deterministic order and cannot deadlock against this transaction.
      // Once held, a concurrent writer on the same row is forced to wait
      // until this transaction commits or rolls back, so the FIFO walk below
      // always reads true, current free quantity.
      const bagTypeIds = [...new Set(dto.bags.map((b) => b.bagTypeId))];
      if (bagTypeIds.length > 0) {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "packed_stocks" WHERE "bagTypeId" IN (${Prisma.join(bagTypeIds)}) ORDER BY id FOR UPDATE`,
        );
      }

      // Reserve each bag line FIFO, pinning each chunk to this shipment.
      for (const bag of dto.bags) {
        let remaining = bag.quantity;

        const stocks = await tx.packedStock.findMany({
          where: { bagTypeId: bag.bagTypeId },
          orderBy: PACKED_STOCK_FIFO_ORDER_BY,
        });

        for (const stock of stocks) {
          if (remaining <= 0) break;
          const free = stock.quantity - stock.reservedQuantity;
          if (free <= 0) continue;
          const take = Math.min(free, remaining);

          // Keyed reservation row for (shipment, packedStock). Two bag lines of the same
          // shipment that land on the same row accumulate into one reservation.
          await tx.shipmentReservation.upsert({
            where: {
              shipmentId_packedStockId: {
                shipmentId: shipment.id,
                packedStockId: stock.id,
              },
            },
            create: {
              shipmentId: shipment.id,
              packedStockId: stock.id,
              quantity: take,
            },
            update: { quantity: { increment: take } },
          });

          // Keep the denormalized cache in lockstep with the keyed rows.
          await tx.packedStock.update({
            where: { id: stock.id },
            data: { reservedQuantity: { increment: take } },
          });
          remaining -= take;
        }

        if (remaining > 0) {
          throw new BadRequestException({
            message: `Insufficient packed stock for bagTypeId ${bag.bagTypeId}`,
            error: `Insufficient packed stock for bagTypeId ${bag.bagTypeId}`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
      }

      return tx.shipment.findUnique({
        where: { id: shipment.id },
        include: {
          bags: { include: { bagType: true } },
        },
      });
    });
  }

  /**
   * Update the actual weight of a shipment.
   *
   * Ownership: same rule as confirmDelivery()/logReturn() — a caller with role
   * 'driver' may only touch a shipment whose order is assigned to them
   * (ClientOrder.driverId). This endpoint is @Roles('driver', 'owner'); without
   * this check any authenticated driver could overwrite another driver's
   * shipment weight.
   */
  async updateActualWeight(id: string, dto: UpdateActualWeightDto, currentUser: ClerkUser) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: { order: { select: { driverId: true } } },
    });
    if (!shipment) {
      throw new NotFoundException({ error: 'Shipment not found', code: 'NOT_FOUND' });
    }
    await this.assertDriverOwnsShipmentOrder(
      this.prisma as unknown as Prisma.TransactionClient, shipment.order.driverId, currentUser,
    );

    return this.prisma.shipment.update({
      where: { id },
      data: { actualKg: dto.actualKg },
    });
  }

  /**
   * Shared ownership guard for driver-facing shipment actions
   * (confirmDelivery/logReturn/updateActualWeight, all @Roles('driver', 'owner')).
   * A caller with role 'driver' may only act on a shipment whose order is
   * assigned to them (ClientOrder.driverId === their own User.id); any other
   * role passes through unchecked.
   */
  private async assertDriverOwnsShipmentOrder(
    db: Prisma.TransactionClient,
    orderDriverId: string | null,
    currentUser: ClerkUser,
  ): Promise<void> {
    if (currentUser.role !== 'driver') return;
    const caller = await db.user.findUnique({ where: { clerkId: currentUser.userId } });
    if (!caller || orderDriverId !== caller.id) {
      throw new ForbiddenException({ error: 'Access denied to this shipment', code: 'FORBIDDEN' });
    }
  }

  /**
   * Drain a shipment's reserved packed stock and mark it delivered — the one
   * code path that turns a {@link ShipmentReservation} into a real physical
   * stock movement. Shared by {@link confirmDelivery} (single shipment,
   * driver/owner-confirmed) and OrdersService.markDelivered() (owner override,
   * all of an order's active shipments at once) so both produce byte-identical
   * PackedStock/StockExit side effects — there is exactly one place that
   * decrements PackedStock.quantity for an order.
   *
   * Caller supplies the already-fetched shipment (with
   * `reservations.packedStock` included) and owns the transaction — this
   * method performs no reads of its own, only writes.
   *
   * Idempotent guard: a shipment that is already 'delivered', or is
   * 'cancelled'/'returned', is a no-op — safe to call without the caller
   * pre-filtering, and prevents double-draining the same shipment.
   *
   * Step 1: For each ShipmentReservation — drain PackedStock FIFO (packedStock.createdAt asc)
   * Step 2: CONSTRAINT 2 — guard against negative packed stock per drain
   * Step 3: Create StockExit per drain chunk with exitType='order' (CONSTRAINT 5: loggedById from userId)
   * Step 4: Update shipment status to 'delivered', set deliveredAt
   *
   * @param tx - Prisma transaction client the caller is already inside
   * @param shipment - Shipment with `reservations.packedStock` included
   * @param userId - Internal User.id to stamp as StockExit.loggedById (CONSTRAINT 5)
   * @param notes - Optional shipment notes to persist alongside the delivered status
   * @constraint 2 guard against negative packed stock per drain
   * @constraint 5 loggedById is always the resolved internal user id, never from a DTO
   */
  async drainShipment(
    tx: Prisma.TransactionClient,
    shipment: {
      id: string;
      orderId: string;
      status: ShipmentStatus;
      reservations: Array<{
        id: string;
        packedStockId: string;
        quantity: number;
        packedStock: { quantity: number; bagTypeId: string; createdAt: Date };
      }>;
    },
    userId: string,
    notes?: string,
  ): Promise<void> {
    // Already delivered (double-confirm) or terminal-without-delivery (cancelled/
    // returned) — nothing physical to drain, and re-draining would double-decrement
    // stock the reservation rows no longer even reference (they're already gone).
    if (shipment.status === 'delivered' || shipment.status === 'cancelled' || shipment.status === 'returned') {
      return;
    }

    // BUG-I (P1): drain the EXACT rows this shipment reserved, never bags another
    // pending shipment reserved. Delivery consumes this shipment's own reservation
    // rows (and the matching physical quantity) — proportional cross-shipment release
    // is gone. Process reservations FIFO (the same packed-stock createdAt order used
    // to reserve) for deterministic, per-shipment-keyed draining.
    const reservations = [...shipment.reservations].sort(
      (a, b) => a.packedStock.createdAt.getTime() - b.packedStock.createdAt.getTime(),
    );

    for (const reservation of reservations) {
      const take = reservation.quantity;
      if (take <= 0) continue;

      // CONSTRAINT 2: guard against going negative. The reserved quantity can never
      // exceed the row's physical quantity (Σ reservations ≤ quantity invariant), so
      // this is a defensive check.
      if (reservation.packedStock.quantity - take < 0) {
        throw new BadRequestException({
          error: `Packed stock would go negative for stock id ${reservation.packedStockId}`,
          code: 'CONSTRAINT_VIOLATION',
        });
      }

      // Consume the physical bags AND release ONLY this shipment's reservation on this
      // row: decrement quantity by `take` and the denormalized reservedQuantity cache
      // by the same amount (this shipment's exact hold). Other shipments' reservations
      // on the same row are untouched.
      await tx.packedStock.update({
        where: { id: reservation.packedStockId },
        data: {
          quantity: { decrement: take },
          reservedQuantity: { decrement: take },
        },
      });

      // Remove the consumed reservation row — its bags have physically left.
      await tx.shipmentReservation.delete({ where: { id: reservation.id } });

      // CONSTRAINT 5: loggedById comes from the resolved internal user id, NEVER from a DTO
      await tx.stockExit.create({
        data: {
          packedStockId: reservation.packedStockId,
          bagTypeId: reservation.packedStock.bagTypeId,
          quantity: take,
          exitType: 'order',
          orderId: shipment.orderId,
          loggedById: userId,
          date: new Date(),
        },
      });
    }

    // Mark shipment as delivered
    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: 'delivered',
        deliveredAt: new Date(),
        ...(notes ? { notes } : {}),
      },
    });
  }

  /**
   * Directly drain PackedStock for one order bag line — no Shipment or
   * ShipmentReservation involved. This is the shipment-independent
   * counterpart to {@link drainShipment}: used by
   * OrdersService.markDelivered() for orders that have no shipment, which is
   * now the normal case — shipments are no longer required to mark an order
   * delivered.
   *
   * Reuses PackedStockService.getFifoDraw() for the draw plan (same
   * deterministic oldest-batch-first order — see that method's doc comment
   * for the full ordering/tiebreak rule — and same `quantity −
   * reservedQuantity` free-stock rule as every other consumer of packed
   * stock in this codebase — StockExitsService, WalkInSalesService,
   * ShipmentsService.createShipment())
   * rather than re-implementing the FIFO walk. Only the write step — the
   * locked decrement + StockExit(exitType:'order') creation per drawn chunk —
   * is new, and it mirrors {@link drainShipment}'s per-chunk write exactly.
   *
   * Step 1: Lock every PackedStock row for this bag type BEFORE reading (same
   *         FOR UPDATE pattern as createShipment()), so the plan below reflects
   *         true, concurrency-safe free quantity — a second concurrent drain of
   *         the same bag type blocks until this transaction commits or rolls back.
   * Step 2: Get the FIFO draw plan; reject the whole operation (nothing written)
   *         if the bag type's free stock can't fully cover `quantity`.
   * Step 3: Decrement PackedStock.quantity and create one StockExit per
   *         drawn chunk (CONSTRAINT 5: loggedById from the resolved user id).
   *
   * Must run inside the caller's transaction.
   *
   * @param tx - Prisma transaction client the caller is already inside
   * @param bagTypeId - Bag type to draw from
   * @param quantity - Bags needed; a no-op when <= 0 (e.g. a KG order has no bagTypeId at all)
   * @param orderId - Order this deduction belongs to (stamped on each StockExit)
   * @param userId - Internal User.id to stamp as StockExit.loggedById (CONSTRAINT 5)
   * @throws BadRequestException (CONSTRAINT_VIOLATION) if free packed stock can't cover `quantity`
   */
  async drainPackedStockDirect(
    tx: Prisma.TransactionClient,
    bagTypeId: string,
    quantity: number,
    orderId: string,
    userId: string,
  ): Promise<void> {
    if (quantity <= 0) return;

    // Lock BEFORE reading — see doc comment above for why this is required
    // for the subsequent plan to be concurrency-safe.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "packed_stocks" WHERE "bagTypeId" = ${bagTypeId} FOR UPDATE`);

    const plan = await this.packedStockService.getFifoDraw(bagTypeId, quantity);
    if (!plan.fulfilled) {
      // Resolve the human-readable bag type name for the error message —
      // only on this (rare) failure path, so the happy path never pays for
      // an extra query. The raw bagTypeId UUID must never reach the user
      // (it was the exact text of a prior reported bug); fall back to a
      // generic label if the BagType row is somehow gone by the time we get
      // here (e.g. concurrently deleted — defense in depth, not expected).
      const bagType = await tx.bagType.findUnique({ where: { id: bagTypeId }, select: { id: true, name: true } });
      const label = bagType ? `"${bagType.name}"` : 'the requested bag type';
      throw new BadRequestException({
        error: `Insufficient packed stock for ${label} — available: ${plan.available}, requested: ${quantity}.`,
        code: 'CONSTRAINT_VIOLATION',
      });
    }

    for (const draw of plan.draws) {
      if (draw.quantity <= 0) continue;

      await tx.packedStock.update({
        where: { id: draw.packedStockId },
        data: { quantity: { decrement: draw.quantity } },
      });

      await tx.stockExit.create({
        data: {
          packedStockId: draw.packedStockId,
          bagTypeId,
          quantity: draw.quantity,
          exitType: 'order',
          orderId,
          loggedById: userId,
          date: new Date(),
        },
      });
    }
  }

  /**
   * Confirm delivery of a shipment. Drains packed stock FIFO via
   * {@link drainShipment}, updates order status, and optionally logs a payment.
   *
   * Step 1: Fetch shipment with bags and order; resolve caller's internal User
   * Step 2: Drain this shipment's reservations and mark it delivered (see {@link drainShipment})
   * Step 3: Recompute order status from all sibling shipments
   * Step 4: Optional payment creation if dto.paymentAmount && dto.paymentMethod
   *         — FIFO-allocated across the client's open invoices via
   *         PaymentAllocationService (this payment is never linked to one
   *         specific invoiceId; see that service for why unlinked payments
   *         must go through FIFO allocation rather than sitting unapplied)
   *
   * Must be fully atomic — wrapped in a single Prisma transaction.
   *
   * @param id - Shipment UUID
   * @param dto - Delivery confirmation data
   * @param currentUser - Authenticated caller from @CurrentUser (CONSTRAINT 5 + ownership)
   * @constraint 2 guard against negative packed stock per drain
   * @constraint 5 loggedById from user.id, never from DTO
   *
   * Ownership: a caller with role 'driver' may only confirm delivery for a
   * shipment whose order is assigned to them (ClientOrder.driverId). This
   * endpoint is @Roles('driver', 'owner'); without this check any
   * authenticated driver could confirm delivery — draining stock, issuing an
   * invoice, and crediting a cash ledger — for a shipment that isn't theirs.
   *
   * Concurrency: locks the shipment row (`SELECT ... FOR UPDATE`) before
   * reading it, so two near-simultaneous confirmDelivery() calls for the SAME
   * shipment (a double-tapped "Deliver" button, or a retried request) never
   * both observe `status !== 'delivered'`. Without this lock both could pass
   * that check, both attempt to drain the same reservation rows (the loser's
   * ShipmentReservation.delete then hits a raw "record not found" once
   * unblocked — surfaced as a 500), and — worse — both create a payment,
   * allocation, and ledger credit for the same delivery. The second call now
   * blocks here until the first commits, then sees the fresh `delivered`
   * status and — via {@link drainShipment}'s own no-op guard and the
   * `alreadyDelivered` check below — skips draining and Step 5 entirely.
   */
  async confirmDelivery(id: string, dto: ConfirmDeliveryDto, currentUser: ClerkUser) {
    // Resolve caller's internal user record before opening a transaction —
    // the user row is not mutated during delivery confirmation.
    const user = await this.prisma.user.findUnique({ where: { clerkId: currentUser.userId } });
    if (!user) {
      throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    }

    // Delivery FIFO drain: scales with (bag types × stock entries); 15 s covers large shipments without hanging the pool indefinitely.
    return this.prisma.$transaction(async (tx) => {
      // Step 1: Lock the shipment row BEFORE reading it (see doc comment
      // above), then fetch it with bags, order, and THIS shipment's
      // reservation rows.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "shipments" WHERE id = ${id} FOR UPDATE`);
      const shipment = await tx.shipment.findUnique({
        where: { id },
        include: {
          bags: true,
          order: true,
          reservations: { include: { packedStock: true } },
        },
      });
      if (!shipment) {
        throw new NotFoundException({ error: 'Shipment not found', code: 'NOT_FOUND' });
      }
      await this.assertDriverOwnsShipmentOrder(tx, shipment.order.driverId, currentUser);

      // Captured BEFORE draining — drainShipment() already no-ops on a
      // double-confirm (nothing left to physically drain), but that alone
      // doesn't stop Step 5 below from creating a SECOND Payment/allocation/
      // ledger-credit for the same delivery on a retried request (e.g. a
      // driver on a flaky mobile connection whose first confirm succeeded
      // server-side but whose response never arrived, then retries). This is
      // the same idempotency guarantee Step 2 (drain) and Step 4 (invoice)
      // already have, extended to Step 5 so all three agree on "already
      // handled" for the exact same shipment.
      const alreadyDelivered = shipment.status === 'delivered';

      // Step 2: Drain this shipment's reservations and mark it delivered.
      await this.drainShipment(tx, shipment, user.id, dto.notes);

      // Step 3: Recompute order status from all sibling shipments
      const siblings = await tx.shipment.findMany({
        where: { orderId: shipment.orderId },
        select: { status: true },
      });

      const allDelivered = siblings.every((s) => s.status === 'delivered');
      const anyDelivered = siblings.some((s) => s.status === 'delivered');
      let newOrderStatus: OrderStatus | null = null;
      if (allDelivered) {
        newOrderStatus = 'delivered';
      } else if (anyDelivered) {
        newOrderStatus = 'partially_delivered';
      }

      if (newOrderStatus) {
        await tx.clientOrder.update({
          where: { id: shipment.orderId },
          data: { status: newOrderStatus },
        });
      }

      // Step 4: Auto-create and immediately issue invoice when ALL shipments are
      // delivered. Runs inside the same transaction — invoice write is atomic with
      // the stock drain and order status update.
      // createFromOrder() is idempotent — safe if markDelivered() already ran.
      if (allDelivered) {
        await this.invoices.createFromOrder(shipment.orderId, tx, true);
      }

      // Step 5: Optional payment at delivery.
      // PR 10.1: cash collected on delivery is attributed to the order's assigned
      // driver (ClientOrder.driverId) — a real User, known before the transaction
      // opens, so no receiver picker is needed. Orders with no assigned driver
      // keep today's behavior: the payment is recorded, nothing is credited.
      if (!alreadyDelivered && dto.paymentAmount && dto.paymentMethod) {
        const paymentAmount = new Decimal(dto.paymentAmount);
        let receiverFields: { receiverId?: string; receiverName?: string } = {};
        if (shipment.order.driverId) {
          await this.usersService.validateCashCapable(shipment.order.driverId);
          const driver = await tx.user.findUnique({ where: { id: shipment.order.driverId }, select: { name: true } });
          receiverFields = { receiverId: shipment.order.driverId, receiverName: driver?.name };
        }

        const payment = await tx.payment.create({
          data: {
            clientId: shipment.order.clientId,
            amount: dto.paymentAmount,
            currency: shipment.order.currency,
            method: dto.paymentMethod,
            date: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
            loggedById: user.id,
            ...receiverFields,
          },
        });

        // Client-level payment (no specific invoiceId — this is COD collected at
        // delivery, not tied to one invoice) — FIFO-allocate it across the
        // client's open invoices, same as any other unlinked payment. If Step 6
        // just auto-issued an invoice for this order, it's already visible here
        // (same transaction) and is the oldest/only open invoice in the common case.
        await this.paymentAllocationService.allocateFifo(
          tx, shipment.order.clientId, payment.id, paymentAmount,
        );

        if (receiverFields.receiverId && paymentAmount.gt(0)) {
          const client = await tx.client.findUnique({ where: { id: shipment.order.clientId }, select: { name: true } });
          await this.ledgerWriteService.creditAccount(
            tx, receiverFields.receiverId, paymentAmount, 'payment_received', payment.id,
            `Delivery — ${client?.name ?? shipment.order.clientId}`,
            dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
          );
        }
      }

      return tx.shipment.findUnique({
        where: { id },
        include: { bags: { include: { bagType: true } } },
      });
    }, { timeout: 15_000, maxWait: 5_000 });
  }

  /**
   * Log a return for a shipment. Increments packed stock for each bag line
   * and marks the shipment as returned. Updates order status.
   *
   * Step 1: Fetch shipment with bags
   * Step 2: For each ShipmentBag — increment the oldest-batch PackedStock row
   *         ({@link PACKED_STOCK_FIFO_ORDER_BY} — same deterministic tiebreak
   *         chain as the reservation walk in {@link createShipment}; forensic
   *         audit 2026-08-29 — this `findFirst` used to order by `createdAt asc`
   *         alone, the same sibling-tie defect fixed elsewhere in this file)
   * Step 3: Update shipment status to 'returned'
   * Step 4: Recompute order status from sibling shipments
   *
   * Must be fully atomic — wrapped in a single Prisma transaction.
   *
   * @param id - Shipment UUID
   * @param dto - Return log data
   * @param currentUser - Authenticated caller from @CurrentUser (ownership check only)
   *
   * Ownership: same rule as confirmDelivery() — a caller with role 'driver'
   * may only log a return for a shipment whose order is assigned to them.
   */
  async logReturn(id: string, dto: LogReturnDto, currentUser: ClerkUser) {
    return this.prisma.$transaction(async (tx) => {
      // Step 1: Fetch shipment with bags
      const shipment = await tx.shipment.findUnique({
        where: { id },
        include: { bags: true, order: { select: { driverId: true } } },
      });
      if (!shipment) {
        throw new NotFoundException({ error: 'Shipment not found', code: 'NOT_FOUND' });
      }
      await this.assertDriverOwnsShipmentOrder(tx, shipment.order.driverId, currentUser);

      // Only delivered shipments may be returned; pre-delivery, use cancelShipment.
      if (shipment.status !== 'delivered') {
        throw new BadRequestException({
          message: `Cannot return shipment ${shipment.id}: status is '${shipment.status}', only 'delivered' shipments may be returned. Use cancelShipment for pre-delivery cancellations.`,
          error: `Cannot return shipment ${shipment.id}: status is '${shipment.status}', only 'delivered' shipments may be returned. Use cancelShipment for pre-delivery cancellations.`,
          code: 'INVALID_TRANSITION',
        });
      }

      // Step 2: For each ShipmentBag, return quantity to first available PackedStock.
      // BUG-I (P1): a delivered shipment already had its keyed reservation rows consumed
      // and deleted at confirmDelivery, so there is nothing to release here — the return
      // only restores physical `quantity`. reservedQuantity is intentionally untouched.
      for (const bag of shipment.bags) {
        const stock = await tx.packedStock.findFirst({
          where: { bagTypeId: bag.bagTypeId },
          orderBy: PACKED_STOCK_FIFO_ORDER_BY,
        });

        if (stock) {
          await tx.packedStock.update({
            where: { id: stock.id },
            data: { quantity: { increment: bag.quantity } },
          });
        }
      }

      // Step 3: Mark shipment as returned
      await tx.shipment.update({
        where: { id },
        data: {
          status: 'returned',
          ...(dto.notes ? { notes: dto.notes } : {}),
        },
      });

      // Step 4: Recompute order status from siblings
      const siblings = await tx.shipment.findMany({
        where: { orderId: shipment.orderId },
        select: { status: true },
      });

      const allDelivered = siblings.every((s) => s.status === 'delivered');
      const anyDelivered = siblings.some((s) => s.status === 'delivered');
      let newOrderStatus: OrderStatus | null = null;
      if (allDelivered) {
        newOrderStatus = 'delivered';
      } else if (anyDelivered) {
        newOrderStatus = 'partially_delivered';
      }

      if (newOrderStatus) {
        await tx.clientOrder.update({
          where: { id: shipment.orderId },
          data: { status: newOrderStatus },
        });
      }

      return tx.shipment.findUnique({
        where: { id },
        include: { bags: { include: { bagType: true } } },
      });
    });
  }

  /**
   * Cancel a pending shipment and RELEASE its packed-stock reservation (BUG-I / P1).
   *
   * Only a shipment that has not yet been delivered or returned can be cancelled —
   * those terminal states have already adjusted physical `quantity`, so re-releasing
   * a reservation would double-count. Cancel deletes ONLY this shipment's keyed
   * {@link ShipmentReservation} rows and decrements each affected row's denormalized
   * `reservedQuantity` cache by exactly the amount this shipment held — never another
   * shipment's reservation, and `quantity` is never touched.
   *
   * @param id - Shipment UUID
   * @throws NotFoundException if the shipment does not exist
   * @throws BadRequestException if the shipment is already delivered or returned
   */
  async cancelShipment(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findUnique({
        where: { id },
        include: { reservations: true },
      });
      if (!shipment) {
        throw new NotFoundException({ error: 'Shipment not found', code: 'NOT_FOUND' });
      }

      if (shipment.status === 'delivered' || shipment.status === 'returned') {
        throw new BadRequestException({
          message: `Cannot cancel a ${shipment.status} shipment`,
          error: `Cannot cancel a ${shipment.status} shipment`,
          code: 'INVALID_TRANSITION',
        });
      }

      // Release ONLY this shipment's reservation rows; decrement each row's cache by the
      // exact amount this shipment reserved on it. Other shipments are unaffected.
      for (const reservation of shipment.reservations) {
        if (reservation.quantity > 0) {
          await tx.packedStock.update({
            where: { id: reservation.packedStockId },
            data: { reservedQuantity: { decrement: reservation.quantity } },
          });
        }
      }
      await tx.shipmentReservation.deleteMany({ where: { shipmentId: id } });

      await tx.shipment.update({
        where: { id },
        data: { status: 'cancelled' },
      });

      return tx.shipment.findUnique({
        where: { id },
        include: { bags: { include: { bagType: true } } },
      });
    });
  }

  /**
   * Return a delivery receipt for a shipment.
   */
  async getReceipt(id: string, currentUser: ClerkUser) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        bags: { include: { bagType: true } },
        order: { include: { client: { select: { id: true, name: true } } } },
      },
    });
    if (!shipment) {
      throw new NotFoundException({ error: 'Shipment not found', code: 'NOT_FOUND' });
    }
    // Ownership: same rule as confirmDelivery()/logReturn()/updateActualWeight() —
    // a caller with role 'driver' may only view the receipt for a shipment
    // whose order is assigned to them. This endpoint is @Roles('driver',
    // 'owner', 'sales_rep'); without this check any authenticated driver could
    // read another driver's delivery — including the client's name and address.
    await this.assertDriverOwnsShipmentOrder(
      this.prisma as unknown as Prisma.TransactionClient, shipment.order.driverId, currentUser,
    );

    return {
      shipment: {
        id: shipment.id,
        address: shipment.address,
        nominalKg: shipment.nominalKg,
        actualKg: shipment.actualKg,
        status: shipment.status,
        deliveredAt: shipment.deliveredAt,
        notes: shipment.notes,
      },
      bags: shipment.bags.map((b) => ({
        bagTypeId: b.bagTypeId,
        bagTypeName: b.bagType.name,
        quantity: b.quantity,
      })),
      order: {
        clientName: shipment.order.client.name,
        address: shipment.address,
      },
    };
  }
}
