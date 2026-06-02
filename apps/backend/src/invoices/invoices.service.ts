import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceCalculatorService } from './invoice-calculator.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: InvoiceCalculatorService,
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
   *  POST /:id/cancel (owner only) transitions any non-paid/non-cancelled → [cancelled]
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
  ) {
    const skip = (page - 1) * limit;

    // 'overdue' is a virtual status: unpaid invoices whose dueDate has passed.
    const isOverdue = status === 'overdue';

    const where: Prisma.InvoiceWhereInput = {
      ...(clientId ? { clientId } : {}),
      ...(search ? { client: { name: { contains: search, mode: 'insensitive' } } } : {}),
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
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { id: true, name: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Return a single invoice with client, payments, and loggedBy details.
   *
   * @param id - Invoice UUID
   * @throws NotFoundException if not found
   */
  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        client: true,
        payments: {
          include: { loggedBy: { select: { id: true, name: true } } },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException({ error: 'Invoice not found', code: 'NOT_FOUND' });
    }

    return invoice;
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
        },
      });
    });
  }

  /**
   * Transition invoice to cancelled (owner only, guarded at controller level).
   *
   * @param id - Invoice UUID
   * @throws BadRequestException if invoice is paid or already cancelled
   * @throws NotFoundException if invoice not found
   */
  async cancel(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id } });
      if (!invoice) {
        throw new NotFoundException({ error: 'Invoice not found', code: 'NOT_FOUND' });
      }

      this.calculator.validateCancellable(invoice);

      return tx.invoice.update({
        where: { id },
        data: { status: 'cancelled' },
      });
    });
  }
}
