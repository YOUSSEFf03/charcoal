import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentAllocationService } from '../invoices/payment-allocation.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { LedgerWriteService } from '../ledger/ledger-write.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentAllocationService: PaymentAllocationService,
    private readonly ledgerWriteService: LedgerWriteService,
    private readonly usersService: UsersService,
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
   * Create a payment and apply it to invoice(s) via PaymentAllocationService —
   * the Payment row itself is never rewritten; PaymentAllocation records how
   * its amount was actually applied (see that service's doc comment).
   *
   * Step 1: Resolve internal User from Clerk userId (loggedById source — CONSTRAINT 5 pattern)
   * Step 2: Validate client exists
   * Step 3: Validate amount > 0
   * Step 4: If invoiceId — lock it (FOR UPDATE), validate status is issued or
   *         partially_paid, validate client match
   * Step 5: Create payment record with loggedById = user.id (NEVER from dto)
   * Step 6: If invoiceId — allocateDirect (full amount, that one invoice);
   *         else — allocateFifo (split across the client's open invoices,
   *         oldest first)
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

      // Validate invoice if provided. Lock it first (SELECT ... FOR UPDATE) —
      // PaymentAllocationService.allocateDirect() takes the same lock later
      // in this same transaction, so this just makes sure the guard checks
      // below are read against a row no concurrent allocator can be mid-write on.
      if (dto.invoiceId) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "invoices" WHERE id = ${dto.invoiceId} FOR UPDATE`);
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
        // PR 6b: validate before any FK-constrained write (Payment.receiverId) is attempted,
        // so an invalid holder fails with a clean NotFoundException instead of a raw DB
        // foreign-key-violation error. LedgerWriteService.creditAccount()'s own validation
        // (PR 6) is unchanged and still runs later — this is additional, not a replacement.
        await this.usersService.validateCashCapable(dto.receiverId);
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
        await this.ledgerWriteService.creditAccount(
          tx, receiverFields.receiverId,
          new Decimal(dto.amount),
          'payment_received',
          payment.id,
          `Payment — ${client?.name ?? dto.clientId}`,
          payment.date,
        );
      }

      // Apply the payment to invoice(s). Rule 1 (invoiceId given): the full
      // amount goes to that one invoice. Rule 2 (no invoiceId — client-level
      // payment): FIFO-allocate across the client's open invoices, oldest
      // first; any amount past what's owed stays unapplied (client credit,
      // visible only via ClientBalanceService's live calculation).
      if (dto.invoiceId) {
        await this.paymentAllocationService.allocateDirect(
          tx, payment.id, dto.invoiceId, new Decimal(dto.amount),
        );
      } else {
        await this.paymentAllocationService.allocateFifo(
          tx, dto.clientId, payment.id, new Decimal(dto.amount),
        );
      }

      // CONSTRAINT 15: do NOT touch any Client field

      return payment;
    });
  }
}
