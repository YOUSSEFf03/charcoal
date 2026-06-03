import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ConfirmDeliveryDto } from './dto/confirm-delivery.dto';
import { LogReturnDto } from './dto/log-return.dto';
import { UpdateActualWeightDto } from './dto/update-actual-weight.dto';

@Injectable()
export class ShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

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
   *   For each bag line, walk packed-stock rows FIFO (createdAt asc) and validate each row
   *   against its FREE quantity (`quantity − reservedQuantity`). For each chunk taken we
   *   upsert a ShipmentReservation row AND increment the row's denormalized
   *   `reservedQuantity` cache in lockstep (cache always equals Σ of the row's
   *   reservations). If the full line cannot be reserved the whole transaction rolls back.
   *   Reservation does NOT decrement `quantity` — physical bags leave only at delivery;
   *   cancel/return releases this shipment's reservation rows.
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

      // Reserve each bag line FIFO, pinning each chunk to this shipment.
      for (const bag of dto.bags) {
        let remaining = bag.quantity;

        const stocks = await tx.packedStock.findMany({
          where: { bagTypeId: bag.bagTypeId },
          orderBy: { createdAt: 'asc' },
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
   */
  async updateActualWeight(id: string, dto: UpdateActualWeightDto) {
    await this.findOne(id);

    return this.prisma.shipment.update({
      where: { id },
      data: { actualKg: dto.actualKg },
    });
  }

  /**
   * Confirm delivery of a shipment. Drains packed stock FIFO, creates
   * StockExit records, updates order status, and optionally logs a payment.
   *
   * Step 1: Fetch shipment with bags and order; resolve caller's internal User
   * Step 2: For each ShipmentBag — drain PackedStock FIFO (orderBy createdAt asc)
   * Step 3: CONSTRAINT 2 — guard against negative packed stock per drain
   * Step 4: Create StockExit per drain chunk with exitType='order' (CONSTRAINT 5: loggedById from user.id)
   * Step 5: Update shipment status to 'delivered', set deliveredAt
   * Step 6: Recompute order status from all sibling shipments
   * Step 7: Optional payment creation if dto.paymentAmount && dto.paymentMethod
   *
   * Must be fully atomic — wrapped in a single Prisma transaction.
   *
   * @param id - Shipment UUID
   * @param dto - Delivery confirmation data
   * @param userId - Clerk user ID from @CurrentUser (CONSTRAINT 5)
   * @constraint 2 guard against negative packed stock per drain
   * @constraint 5 loggedById from user.id, never from DTO
   */
  async confirmDelivery(id: string, dto: ConfirmDeliveryDto, userId: string) {
    // Resolve caller's internal user record before opening a transaction —
    // the user row is not mutated during delivery confirmation.
    const user = await this.prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) {
      throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    }

    // Delivery FIFO drain: scales with (bag types × stock entries); 15 s covers large shipments without hanging the pool indefinitely.
    return this.prisma.$transaction(async (tx) => {
      // Step 1: Fetch shipment with bags, order, and THIS shipment's reservation rows.
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

        // CONSTRAINT 5: loggedById comes from user.id, NEVER from DTO
        await tx.stockExit.create({
          data: {
            packedStockId: reservation.packedStockId,
            bagTypeId: reservation.packedStock.bagTypeId,
            quantity: take,
            exitType: 'order',
            orderId: shipment.orderId,
            loggedById: user.id,
            date: new Date(),
          },
        });
      }

      // Step 4: Mark shipment as delivered
      await tx.shipment.update({
        where: { id },
        data: {
          status: 'delivered',
          deliveredAt: new Date(),
          ...(dto.notes ? { notes: dto.notes } : {}),
        },
      });

      // Step 5: Recompute order status from all sibling shipments
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

      // Step 6: Optional payment at delivery
      if (dto.paymentAmount && dto.paymentMethod) {
        await tx.payment.create({
          data: {
            clientId: shipment.order.clientId,
            amount: dto.paymentAmount,
            currency: shipment.order.currency,
            method: dto.paymentMethod,
            date: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
            loggedById: user.id,
          },
        });
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
   * Step 2: For each ShipmentBag — increment first available PackedStock (orderBy createdAt asc)
   * Step 3: Update shipment status to 'returned'
   * Step 4: Recompute order status from sibling shipments
   *
   * Must be fully atomic — wrapped in a single Prisma transaction.
   *
   * @param id - Shipment UUID
   * @param dto - Return log data
   * @param userId - Clerk user ID (unused in return, kept for signature consistency)
   */
  async logReturn(id: string, dto: LogReturnDto, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Step 1: Fetch shipment with bags
      const shipment = await tx.shipment.findUnique({
        where: { id },
        include: { bags: true },
      });
      if (!shipment) {
        throw new NotFoundException({ error: 'Shipment not found', code: 'NOT_FOUND' });
      }

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
          orderBy: { createdAt: 'asc' },
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
  async getReceipt(id: string) {
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
