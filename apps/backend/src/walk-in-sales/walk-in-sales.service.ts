import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Currency } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceCalculatorService } from '../invoices/invoice-calculator.service';
import { SettingsService } from '../settings/settings.service';
import { creditAccount } from '../cash-handovers/cash-handovers.service';
import { CreateWalkInSaleDto } from './dto/create-walk-in-sale.dto';

@Injectable()
export class WalkInSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: InvoiceCalculatorService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Record a walk-in sale to a REGISTERED client as a single atomic operation
   * (BUG-3 + BUG-4). Fixes two defects the old frontend-orchestrated flow had:
   *
   *   BUG-3 (P3 — missing canonical ledger record): a registered-client walk-in used
   *   to create a Payment with NO Invoice, so the client's balance (Σinvoices − Σpayments)
   *   went negative for a sale that was never invoiced. Here every sale produces an
   *   *issued* Invoice for the goods AND a Payment for what was collected, in one tx.
   *
   *   BUG-4 (currency + missing rate): the old flow hardcoded the payment currency as USD
   *   and silently recorded $0 when the exchange rate was missing. Here the invoice and
   *   payment are always stored in the CLIENT's assigned currency, and any conversion uses
   *   the stored rate — if that rate is ≤ 0 the whole sale is rejected, never a $0 movement.
   *
   * All writes (stock exit per bag line, issued invoice, payment) happen inside one
   * Prisma transaction so the goods, the invoice, and the payment can never diverge.
   *
   * Anonymous walk-ins are out of scope here — they continue to use POST /stock-exits.
   *
   * @param dto    Walk-in sale payload.
   * @param userId Clerk user id of the caller — resolved to loggedById on exits/payment.
   */
  async create(dto: CreateWalkInSaleDto, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });

    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });

    const clientCurrency = client.currency; // authoritative — never hardcoded (BUG-4)

    // Resolve the LBP-per-USD rate once. We only NEED it when a conversion is required,
    // but resolving up front lets us reject early with a clear error (BUG-4).
    const rawRate = await this.settings.getExchangeRate();
    const rate = new Decimal(rawRate);

    // Convert an amount from its quoted currency into the client's currency.
    // Throws if a conversion is required but the rate is non-positive (BUG-4 — never $0).
    const toClientCurrency = (amount: Decimal, from: Currency): Decimal => {
      if (from === clientCurrency) return amount;
      if (rate.lte(0)) {
        throw new BadRequestException({
          message: 'Exchange rate is missing or zero — cannot record a converted amount',
          error: 'Exchange rate is missing or zero',
          code: 'RATE_UNAVAILABLE',
        });
      }
      // rate = LBP per 1 USD
      if (from === 'USD' && clientCurrency === 'LBP') return amount.mul(rate);
      if (from === 'LBP' && clientCurrency === 'USD') return amount.div(rate);
      return amount;
    };

    // Build invoice lines in the client's currency.
    const invoiceLines = dto.bags.map((b) => {
      const priceInClientCcy = toClientCurrency(new Decimal(b.pricePerBag), b.currency);
      return {
        bagTypeId: b.bagTypeId,
        bagTypeName: b.bagTypeName,
        qty: b.quantity,
        pricePerBag: priceInClientCcy.toFixed(2),
      };
    });

    const { lines: enrichedLines, subtotal } = this.calculator.computeLines(invoiceLines);
    const total = this.calculator.computeTotal(subtotal);

    // Compute the payment received, converted into the client's currency.
    const receivedUsd = new Decimal(dto.receivedUsd ?? '0');
    const receivedLbp = new Decimal(dto.receivedLbp ?? '0');
    let received = new Decimal(0);
    if (receivedUsd.gt(0)) received = received.plus(toClientCurrency(receivedUsd, 'USD'));
    if (receivedLbp.gt(0)) received = received.plus(toClientCurrency(receivedLbp, 'LBP'));

    return this.prisma.$transaction(async (tx) => {
      // 1) Drain packed stock for each bag line — atomic decrement, guard negative (P2).
      for (const bag of dto.bags) {
        const stock = await tx.packedStock.findUnique({ where: { id: bag.packedStockId } });
        if (!stock) {
          throw new NotFoundException({ error: `Packed stock not found: ${bag.packedStockId}`, code: 'NOT_FOUND' });
        }
        // BUG-E (P2): draw against FREE quantity (quantity − reservedQuantity), never raw —
        // bags reserved for a pending shipment must not be consumable by a walk-in sale.
        const freeQuantity = stock.quantity - stock.reservedQuantity;
        if (freeQuantity - bag.quantity < 0) {
          throw new BadRequestException({
            error: `Insufficient packed stock — available: ${freeQuantity}, requested: ${bag.quantity}`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
        await tx.packedStock.update({
          where: { id: bag.packedStockId },
          data: { quantity: { decrement: bag.quantity } },
        });

        // Canonical ledger record for the goods leaving stock.
        await tx.stockExit.create({
          data: {
            packedStockId: bag.packedStockId,
            bagTypeId: bag.bagTypeId,
            quantity: bag.quantity,
            exitType: 'walk_in',
            date: new Date(dto.date),
            clientId: dto.clientId,
            loggedById: user.id,
            amount: null, // null keeps invoiced walk-in out of the P&L walk-in aggregate
            ...(dto.recipient ? { recipient: dto.recipient } : {}),
            ...(dto.notes ? { reason: dto.notes } : {}),
          },
        });
      }

      // 2) Create the issued invoice for the sale (BUG-3 — the missing ledger record).
      const invoice = await tx.invoice.create({
        data: {
          clientId: dto.clientId,
          lines: enrichedLines as any,
          subtotal,
          total,
          currency: clientCurrency,
          status: 'issued',
          issuedAt: new Date(dto.date),
          paidAmount: '0',
        },
      });

      // 3) Create the payment in the CLIENT's currency (BUG-4) and link it to the invoice,
      //    only when something was actually received. A zero-received sale leaves the full
      //    invoice on the client's balance (legitimately owed) — never a $0 payment movement.
      let payment: { id: string } | null = null;
      if (received.gt(0)) {
        payment = await tx.payment.create({
          data: {
            clientId: dto.clientId,
            invoiceId: invoice.id,
            amount: received.toFixed(2),
            currency: clientCurrency,
            method: dto.method,
            date: new Date(dto.date),
            loggedById: user.id,
            ...(dto.receiverId ? { receiverId: dto.receiverId } : {}),
            ...(dto.notes ? { notes: dto.notes } : {}),
          },
        });

        // Keep invoice paidAmount/status consistent with its payments.
        const { paidAmount, status } = await this.calculator.recomputeStatus(invoice.id, tx);
        await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount, status } });

        // Credit the receiver's cash account ledger when assigned.
        if (dto.receiverId) {
          await creditAccount(
            tx, dto.receiverId, received, 'payment_received', payment.id,
            `Walk-in sale — ${client.name}`, new Date(dto.date),
          );
        }
      }

      return tx.invoice.findUnique({
        where: { id: invoice.id },
        include: { client: { select: { id: true, name: true } }, payments: true },
      });
    });
  }
}
