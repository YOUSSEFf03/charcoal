import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceCalculatorService } from '../invoices/invoice-calculator.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { creditAccount } from '../cash-handovers/cash-handovers.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: InvoiceCalculatorService,
  ) {}

  /**
   * Return a paginated list of payments with optional filters.
   *
   * @param page - 1-indexed page number
   * @param limit - Items per page
   * @param clientId - Optional client filter
   * @param invoiceId - Optional invoice filter
   * @param dateFrom - Optional ISO date string lower bound
   * @param dateTo - Optional ISO date string upper bound
   */
  async findAll(
    page: number,
    limit: number,
    clientId?: string,
    invoiceId?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentWhereInput = {
      ...(clientId ? { clientId } : {}),
      ...(invoiceId ? { invoiceId } : {}),
      ...(dateFrom || dateTo
        ? {
            date: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          client: { select: { id: true, name: true } },
          loggedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Return a single payment with client, invoice and loggedBy details.
   *
   * @param id - Payment UUID
   * @throws NotFoundException if not found
   */
  async findOne(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        client: true,
        invoice: true,
        loggedBy: { select: { id: true, name: true } },
      },
    });

    if (!payment) {
      throw new NotFoundException({ error: 'Payment not found', code: 'NOT_FOUND' });
    }

    return payment;
  }

  /**
   * Create a payment and, if invoiceId is given, atomically update invoice paidAmount + status.
   *
   * Step 1: Resolve internal User from Clerk userId (loggedById source — CONSTRAINT 5 pattern)
   * Step 2: Validate client exists
   * Step 3: Validate amount > 0
   * Step 4: If invoiceId — validate invoice status is issued or partially_paid; validate client match
   * Step 5: Create payment record with loggedById = user.id (NEVER from dto)
   * Step 6: If invoiceId — call recomputeStatus (aggregate-based) and update invoice
   * CONSTRAINT 15: Client.balance is NEVER written — always computed by ClientBalanceService
   *
   * @param dto - Payment creation payload (no loggedById)
   * @param clerkUserId - Clerk user sub from @CurrentUser
   */
  async create(dto: CreatePaymentDto, clerkUserId: string) {
    // Resolve internal User from Clerk sub (outside transaction — throws 404 if not found)
    const user = await this.prisma.user.findUnique({
      where: { clerkId: clerkUserId },
    });
    if (!user) {
      throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    }

    return this.prisma.$transaction(async (tx) => {
      // Validate client exists
      const client = await tx.client.findUnique({ where: { id: dto.clientId } });
      if (!client) {
        throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });
      }

      // Validate amount > 0
      if (!new Decimal(dto.amount).gt(0)) {
        throw new BadRequestException({
          message: 'Payment amount must be greater than zero',
          error: 'Payment amount must be greater than zero',
          code: 'CONSTRAINT_VIOLATION',
        });
      }

      // Validate invoice if provided
      if (dto.invoiceId) {
        const invoice = await tx.invoice.findUnique({ where: { id: dto.invoiceId } });
        if (!invoice) {
          throw new NotFoundException({ error: 'Invoice not found', code: 'NOT_FOUND' });
        }

        // Guard: invoice must be issued or partially_paid
        if (invoice.status !== 'issued' && invoice.status !== 'partially_paid') {
          throw new BadRequestException({
            message: 'Payment can only be applied to issued or partially_paid invoices',
            error: 'Payment can only be applied to issued or partially_paid invoices',
            code: 'INVALID_STATE',
          });
        }

        // Guard: invoice must belong to the same client
        if (invoice.clientId !== dto.clientId) {
          throw new BadRequestException({
            message: 'Invoice does not belong to the specified client',
            error: 'Invoice does not belong to the specified client',
            code: 'CONSTRAINT_VIOLATION',
          });
        }
      }

      // Resolve receiver: if a receiverId is provided, look up the name for the string field too
      let receiverFields: { receiverId?: string; receiverName?: string } = {};
      if (dto.receiverId) {
        const receiver = await tx.user.findUnique({ where: { id: dto.receiverId }, select: { name: true } });
        receiverFields = { receiverId: dto.receiverId, receiverName: receiver?.name };
      } else if (dto.receiverName) {
        receiverFields = { receiverName: dto.receiverName };
      }

      // Create the payment record
      const payment = await tx.payment.create({
        data: {
          clientId: dto.clientId,
          ...(dto.invoiceId ? { invoiceId: dto.invoiceId } : {}),
          amount: dto.amount,
          currency: dto.currency,
          method: dto.method,
          date: dto.date ? new Date(dto.date) : new Date(),
          loggedById: user.id,
          ...(dto.notes ? { notes: dto.notes } : {}),
          ...receiverFields,
        },
      });

      // Credit the receiver's account ledger when a receiver is assigned
      if (receiverFields.receiverId) {
        const client = await tx.client.findUnique({ where: { id: dto.clientId }, select: { name: true } });
        await creditAccount(
          tx, receiverFields.receiverId,
          new Decimal(dto.amount),
          'payment_received',
          payment.id,
          `Payment — ${client?.name ?? dto.clientId}`,
          payment.date,
        );
      }

      // Recompute invoice status if this payment is linked to an invoice
      if (dto.invoiceId) {
        const { paidAmount, status } = await this.calculator.recomputeStatus(
          dto.invoiceId,
          tx,
        );
        await tx.invoice.update({
          where: { id: dto.invoiceId },
          data: { paidAmount, status },
        });
      }

      // CONSTRAINT 15: do NOT touch any Client field

      return payment;
    });
  }
}
