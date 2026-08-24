import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceCalculatorService } from './invoice-calculator.service';
import { SettingsService } from '../settings/settings.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceLineDto } from './dto/invoice-line.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: InvoiceCalculatorService,
    private readonly settings: SettingsService,
  ) {}

  /*
   * Invoice State Machine
   * ─────────────────────────────────────────────────────
   *
   *                 POST /:id/issue
   *  [draft] ──────────────────────────► [issued]
   *    │                                    │
   *    │  DELETE /:id                       │  POST /payments (0 < paid < total)
   *    ▼  (owner only)                      ▼
   * (deleted)                        [partially_paid]
   *                                         │
   *                                         │  POST /payments (paid >= total)
   *                                         ▼
   *                                      [paid]  ◄── POST /payments (paid >= total)
   *                                                   from issued state also
   *
   *  POST /:id/cancel (owner only) transitions any non-paid/non-cancelled → [cancelled],
   *    UNLESS a payment has already been applied to it (PAYMENT_EXISTS) or it's an
   *    ORDER invoice whose order already has a delivered shipment (DELIVERED_ORDER) —
   *    see InvoiceCalculatorService.validateCancellable().
   *  PATCH /:id only allowed in [draft] state.
   * ─────────────────────────────────────────────────────
   */

  /**
   * Return a paginated list of invoices with optional filters.
   *
   * @param page - 1-indexed page number
   * @param limit - Items per page
   * @param clientId - Optional client filter
   * @param status - Optional status filter
   * @param dateFrom - Optional ISO date string lower bound (createdAt)
   * @param dateTo - Optional ISO date string upper bound (createdAt)
   */
  async findAll(
    page: number,
    limit: number,
    clientId?: string,
    status?: string,
    dateFrom?: string,
    dateTo?: string,
    search?: string,
    sortBy?: string,
    sortOrder?: string,
  ) {
    const skip = (page - 1) * limit;

    // Allow-listed, not a raw pass-through of the query string, so an
    // unrecognized/misspelled sortBy can never reach Prisma's orderBy — it
    // just falls back to the existing default. Only columns with an
    // unambiguous "greater/smaller" ordering are offered; "Due" is a
    // computed value (total − paidAmount), not a stored column, so it's
    // intentionally not sortable here rather than misleadingly approximated.
    const direction: Prisma.SortOrder = sortOrder === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.InvoiceOrderByWithRelationInput =
      sortBy === 'amount' ? { total: direction } :
      sortBy === 'paid' ? { paidAmount: direction } :
      sortBy === 'status' ? { status: direction } :
      sortBy === 'date' ? { issuedAt: direction } :
      { createdAt: 'desc' };

    // 'overdue' is a virtual status: unpaid invoices whose dueDate has passed.
    const isOverdue = status === 'overdue';

    const where: Prisma.InvoiceWhereInput = {
      ...(clientId ? { clientId } : {}),
      // Matches by client name OR invoice number (displayId, e.g. "SI-0042") —
      // the Invoices page's search box is the primary way a user finds a
      // specific invoice, and searching by the number printed on the
      // physical/PDF invoice is at least as common a lookup as by client
      // name. displayId already carries a unique index (schema.prisma), so
      // an exact/prefix match is cheap; `contains` still works for a partial
      // number without needing a new index at this table's realistic size
      // (paginated 20/page, filtered by clientId/status/date first).
      ...(search
        ? {
            OR: [
              { client: { name: { contains: search, mode: 'insensitive' } } },
              { displayId: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(isOverdue
        ? {
            status: { in: ['issued', 'partially_paid'] as InvoiceStatus[] },
            dueDate: { lt: new Date() },
          }
        : status
        ? { status: status as InvoiceStatus }
        : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          client: { select: { id: true, name: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Return a single invoice with client, order source, payments, allocations,
   * and loggedBy details — the authoritative data for both the Invoice Detail
   * page and the print/PDF view (InvoicePrint.tsx), which both read this same
   * endpoint so they can never disagree.
   *
   * `payments` (Payment.invoiceId = this invoice) only shows payments directly
   * linked at creation time. `allocations` is the complete picture — it also
   * includes amounts FIFO-allocated here from a client-level payment created
   * with invoiceId null (see PaymentAllocationService) — so it's the field to
   * use for "what has actually been applied to this invoice."
   *
   * `client` is an explicit select (not `client: true`) — deliberately
   * excludes the client's own computed balance/isOverdue (those are only
   * ever computed by ClientsService, never here) and any other client field
   * this page doesn't display, rather than silently returning a client shape
   * wider than what's documented on the response type.
   *
   * @param id - Invoice UUID
   * @throws NotFoundException if not found
   */
  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        client: {
          select: { id: true, name: true, type: true, currency: true, phones: true },
        },
        // Source reference for an ORDER invoice (null for WAREHOUSE_SALE — see
        // Invoice.source). Minimal projection — just enough to link back to
        // the order, not the full order/shipment graph.
        order: { select: { id: true, displayId: true, status: true } },
        payments: {
          include: { loggedBy: { select: { id: true, name: true } } },
        },
        allocations: {
          include: {
            payment: {
              select: { id: true, displayId: true, clientId: true, date: true, method: true, invoiceId: true },
            },
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException({ error: 'Invoice not found', code: 'NOT_FOUND' });
    }

    // total/paidAmount are non-nullable Decimal columns — always present on a real
    // Prisma row. The guard exists only because findOne() is also called
    // internally by update()/cancel() purely for status/client checks, against
    // test doubles that don't necessarily populate every column.
    return {
      ...invoice,
      ...(invoice.total != null && invoice.paidAmount != null
        ? { balanceDue: new Decimal(invoice.total).minus(invoice.paidAmount).toFixed(2) }
        : {}),
    };
  }

  /**
   * Create a new invoice in draft status.
   *
   * @param dto - Invoice creation data
   * @throws NotFoundException if client or order not found
   */
  async create(dto: CreateInvoiceDto) {
    const client = await this.prisma.client.findUnique({
      where: { id: dto.clientId },
    });
    if (!client) {
      throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });
    }

    // Every downstream balance/ledger calculation (ClientBalanceService, Payments,
    // getClientLedger, getArSummary) assumes an invoice's currency always matches
    // its client's currency — Payment.amount is always stored in the client's
    // currency (PaymentsService), so a mismatched invoice currency would compare
    // unlike units when paidAmount/status is recomputed. Reject rather than
    // silently store it (mirrors the same guard in OrdersService.create/update).
    if (dto.currency !== client.currency) {
      throw new BadRequestException({
        message: `Invoice currency (${dto.currency}) must match the client's currency (${client.currency})`,
        error: `Invoice currency (${dto.currency}) must match the client's currency (${client.currency})`,
        code: 'CONSTRAINT_VIOLATION',
      });
    }

    if (dto.orderId) {
      const order = await this.prisma.clientOrder.findUnique({
        where: { id: dto.orderId },
      });
      if (!order) {
        throw new NotFoundException({ error: 'Order not found', code: 'NOT_FOUND' });
      }
    }

    const { lines: enrichedLines, subtotal } = this.calculator.computeLines(dto.lines);
    const total = this.calculator.computeTotal(subtotal);

    return this.prisma.invoice.create({
      data: {
        clientId: dto.clientId,
        ...(dto.orderId ? { orderId: dto.orderId } : {}),
        lines: enrichedLines as unknown as Prisma.InputJsonValue,
        subtotal,
        total,
        currency: dto.currency,
        // Source is determined by whether the invoice is linked to an order.
        // Never rely on the DB default — set it explicitly on every create path.
        source: dto.orderId ? 'ORDER' : 'WAREHOUSE_SALE',
        status: 'draft',
        paidAmount: '0',
        ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Update a draft invoice. Throws if status is not 'draft'.
   *
   * @param id - Invoice UUID
   * @param dto - Partial update data
   * @throws BadRequestException if invoice is not in draft status
   * @throws NotFoundException if invoice not found
   */
  async update(id: string, dto: UpdateInvoiceDto) {
    const invoice = await this.findOne(id);

    if (invoice.status !== 'draft') {
      throw new BadRequestException({
        message: 'Only draft invoices can be updated',
        error: 'Only draft invoices can be updated',
        code: 'CONSTRAINT_VIOLATION',
      });
    }

    let linesData: Prisma.InputJsonValue | undefined;
    let subtotal: string | undefined;
    let total: string | undefined;

    if (dto.lines) {
      const computed = this.calculator.computeLines(dto.lines);
      linesData = computed.lines as unknown as Prisma.InputJsonValue;
      subtotal = computed.subtotal;
      total = this.calculator.computeTotal(subtotal);
    }

    // Same invariant enforced at create() — an invoice's currency must always
    // match its client's currency (see create()'s comment). Changing either
    // field independently could otherwise desync them.
    if (dto.clientId !== undefined || dto.currency !== undefined) {
      const effectiveClient = dto.clientId !== undefined
        ? await this.prisma.client.findUnique({ where: { id: dto.clientId } })
        : invoice.client;
      if (!effectiveClient) {
        throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });
      }
      const effectiveCurrency = dto.currency ?? invoice.currency;
      if (effectiveCurrency !== effectiveClient.currency) {
        throw new BadRequestException({
          message: `Invoice currency (${effectiveCurrency}) must match the client's currency (${effectiveClient.currency})`,
          error: `Invoice currency (${effectiveCurrency}) must match the client's currency (${effectiveClient.currency})`,
          code: 'CONSTRAINT_VIOLATION',
        });
      }
    }

    return this.prisma.invoice.update({
      where: { id },
      data: {
        ...(dto.clientId !== undefined ? { clientId: dto.clientId } : {}),
        ...(dto.orderId !== undefined ? { orderId: dto.orderId } : {}),
        ...(linesData !== undefined ? { lines: linesData } : {}),
        ...(subtotal !== undefined ? { subtotal } : {}),
        ...(total !== undefined ? { total } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.dueDate !== undefined
          ? { dueDate: new Date(dto.dueDate) }
          : {}),
      },
    });
  }

  /**
   * Delete a draft invoice.
   *
   * @param id - Invoice UUID
   * @throws BadRequestException if invoice is not in draft status
   * @throws NotFoundException if invoice not found
   */
  async remove(id: string): Promise<void> {
    const invoice = await this.findOne(id);

    if (invoice.status !== 'draft') {
      throw new BadRequestException({
        message: 'Only draft invoices can be deleted',
        error: 'Only draft invoices can be deleted',
        code: 'CONSTRAINT_VIOLATION',
      });
    }

    await this.prisma.invoice.delete({ where: { id } });
  }

  /**
   * Transition invoice from draft → issued.
   *
   * @param id - Invoice UUID
   * @throws BadRequestException if invoice is not in draft status
   * @throws NotFoundException if invoice not found
   */
  async issue(id: string) {
    // BUG-J (P5): resolve the LBP-per-USD rate at issue time and snapshot it on the
    // invoice so P&L converts this invoice's LBP revenue at the rate in effect now,
    // never a later global rate. Resolved before the tx — settings are not mutated here.
    const rate = await this.settings.getExchangeRate();

    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id } });
      if (!invoice) {
        throw new NotFoundException({ error: 'Invoice not found', code: 'NOT_FOUND' });
      }

      this.calculator.validateIssuable(invoice);

      return tx.invoice.update({
        where: { id },
        data: {
          status: 'issued',
          issuedAt: new Date(),
          exchangeRateSnapshot: rate.toString(),
        },
      });
    });
  }

  /**
   * Create a draft invoice from a delivered order.
   *
   * Derives line items directly from the order record (not from shipment bags),
   * so it works for both shipment-flow deliveries and owner mark-delivered
   * overrides. The invoice is always created in draft status — the owner issues
   * it manually after reviewing price and exchange rate.
   *
   * Idempotent: if a non-cancelled invoice already exists for the order, the
   * existing record is returned without creating a duplicate.
   *
   * @param orderId - ClientOrder UUID
   * @param tx - optional Prisma transaction client (pass when calling from within $transaction)
   * @param autoIssue - when true, immediately transitions the invoice to 'issued' and
   *   snapshots the current exchange rate. Use for automatic delivery triggers
   *   (markDelivered, confirmDelivery). Leave false for manual/historical generation.
   * @throws NotFoundException if the order does not exist
   * @throws BadRequestException if the order is not in delivered status
   */
  async createFromOrder(orderId: string, tx?: Prisma.TransactionClient, autoIssue = false) {
    // PrismaService extends PrismaClient which is a structural superset of
    // TransactionClient. The cast is safe — both expose identical CRUD methods.
    const db = (tx ?? this.prisma) as Prisma.TransactionClient;

    // Resolve the exchange rate once before entering the write path so the same
    // rate applies to both the fresh-create path and the idempotency-update path.
    const rate = autoIssue ? await this.settings.getExchangeRate() : null;

    const order = await db.clientOrder.findUnique({
      where: { id: orderId },
      include: { bagType: true },
    });
    if (!order) {
      throw new NotFoundException({ error: 'Order not found', code: 'NOT_FOUND' });
    }
    if (order.status !== 'delivered') {
      throw new BadRequestException({
        error: 'Invoice can only be generated for delivered orders',
        code: 'CONSTRAINT_VIOLATION',
      });
    }

    // Application-level idempotency guard: return existing active invoice.
    // The DB partial unique index (invoices_orderId_unique_active) is the
    // backstop that catches any race that slips past this check.
    const existing = await db.invoice.findFirst({
      where: { orderId, status: { not: 'cancelled' } },
    });
    if (existing) {
      // Issue an existing draft when autoIssue is requested (e.g. re-delivery attempt
      // after a prior run that created the draft but crashed before issuing).
      // Non-draft invoices (already issued, partially_paid, paid) are returned as-is.
      if (rate !== null && existing.status === 'draft') {
        return db.invoice.update({
          where: { id: existing.id },
          data: { status: 'issued', issuedAt: new Date(), exchangeRateSnapshot: rate.toString() },
        });
      }
      return existing;
    }

    // Build one invoice line from the order fields.
    // BAG order (bagTypeId set): qty = round(totalKg / nominalKg), price per bag.
    // KG  order (bagTypeId null): kgQuantity = totalKgRequested, price per kg.
    let line: InvoiceLineDto;
    if (order.bagTypeId && order.bagType) {
      const qty = Math.round(
        parseFloat(order.totalKgRequested.toString()) /
          parseFloat(order.bagType.nominalKg.toString()),
      );
      line = {
        saleUnit: 'BAG',
        bagTypeId: order.bagTypeId,
        bagTypeName: order.bagType.name,
        qty,
        pricePerBag: order.pricePerBag.toString(),
      };
    } else {
      line = {
        saleUnit: 'KG',
        kgQuantity: order.totalKgRequested.toString(),
        description: `${order.charcoalType} Grade ${order.grade}`,
        pricePerKg: order.pricePerBag.toString(),
      };
    }

    const { lines: enrichedLines, subtotal } = this.calculator.computeLines([line]);
    const total = this.calculator.computeTotal(subtotal);

    // Create invoice in its final state — issued immediately when autoIssue is true,
    // draft otherwise. Single write; no separate update needed for the happy path.
    try {
      return await db.invoice.create({
        data: {
          clientId: order.clientId,
          orderId,
          lines: enrichedLines as unknown as Prisma.InputJsonValue,
          subtotal,
          total,
          currency: order.currency,
          source: 'ORDER',
          status: rate !== null ? 'issued' : 'draft',
          ...(rate !== null ? { issuedAt: new Date(), exchangeRateSnapshot: rate.toString() } : {}),
          paidAmount: '0',
        },
      });
    } catch (e) {
      // Expected race: a concurrent createFromOrder() call for the same order
      // (e.g. two near-simultaneous delivery confirmations) can pass the
      // `existing` check above at the same time — only one create() wins, the
      // other hits invoices_orderId_unique_active (P2002). Return the winner's
      // invoice instead of surfacing a raw constraint violation as a 500; if no
      // matching invoice actually exists, this wasn't that race — rethrow.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const winner = await db.invoice.findFirst({
          where: { orderId, status: { not: 'cancelled' } },
        });
        if (winner) {
          return winner;
        }
      }
      throw e;
    }
  }

  /**
   * Transition invoice to cancelled (owner only, guarded at controller level).
   *
   * Rejects (see InvoiceCalculatorService.validateCancellable() for the exact
   * codes) when: the invoice is paid/already cancelled; a payment has already
   * been applied to it (PAYMENT_EXISTS — this project has no payment-reversal
   * mechanism, so cancelling would strand real money against a voided
   * document); or it's an ORDER invoice whose order already has a delivered
   * shipment (DELIVERED_ORDER — physical inventory already left; the
   * sanctioned reversal is ShipmentsService.logReturn(), which cancellation
   * must never bypass or auto-trigger).
   *
   * @param id - Invoice UUID
   * @throws BadRequestException if invoice is paid/cancelled (INVALID_TRANSITION),
   *   has an existing payment allocation (PAYMENT_EXISTS), or is an ORDER
   *   invoice with a delivered shipment (DELIVERED_ORDER)
   * @throws NotFoundException if invoice not found
   */
  async cancel(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id } });
      if (!invoice) {
        throw new NotFoundException({ error: 'Invoice not found', code: 'NOT_FOUND' });
      }

      // PAYMENT_EXISTS check — PaymentAllocation is the authoritative record of
      // what's been applied (see PaymentAllocationService's own doc comment),
      // not the cached Invoice.paidAmount.
      const allocation = await tx.paymentAllocation.findFirst({
        where: { invoiceId: id },
        select: { id: true },
      });

      // DELIVERED_ORDER check — only meaningful for ORDER-sourced invoices.
      // Reads ClientOrder.status directly rather than looking for a delivered
      // Shipment row: OrdersService.markDelivered() sets this status the same
      // way regardless of whether the order was delivered via the shipment
      // path OR directly (drainPackedStockDirect, no Shipment ever created) —
      // the old Shipment-only check was always false for a directly-delivered
      // order, letting its invoice be cancelled even though stock had already
      // physically left, after which a brand-new invoice could later be
      // generated for the same already-consumed stock (createFromOrder()'s
      // idempotency check only looks at active invoices, not physical stock).
      let hasDeliveredOrder = false;
      if (invoice.source === 'ORDER' && invoice.orderId) {
        const order = await tx.clientOrder.findUnique({
          where: { id: invoice.orderId },
          select: { status: true },
        });
        hasDeliveredOrder = !!order &&
          ['delivered', 'partially_delivered', 'invoiced', 'paid'].includes(order.status);
      }

      this.calculator.validateCancellable({
        status: invoice.status,
        hasPayments: !!allocation,
        hasDeliveredOrder,
      });

      return tx.invoice.update({
        where: { id },
        data: { status: 'cancelled' },
      });
    });
  }
}
