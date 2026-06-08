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
   * Record a walk-in sale to a REGISTERED client as a single atomic operation.
   *
   * Supports two line types — packed bags and by-kg — or a mix of both in one invoice.
   *
   * BUG-3/BUG-4 (bags): every registered-client bag sale produces an issued Invoice
   * for the goods AND a Payment for what was collected, eliminating the old flow that
   * recorded a Payment with no Invoice (negative balance) and hardcoded USD.
   *
   * Phase 4 (kg): every registered-client KG sale now follows the same pattern —
   * StockExit (amount=null) + issued Invoice + optional Payment — replacing the old
   * flow that used POST /stock-exits with amount≠null (no invoice, no ledger entry).
   *
   * All writes happen inside one Prisma transaction so goods, invoice, and payment
   * can never diverge.
   *
   * Anonymous walk-ins are out of scope — they continue to use POST /stock-exits.
   *
   * @param dto    Walk-in sale payload.
   * @param userId Clerk user id of the caller — resolved to loggedById on exits/payment.
   */
  async create(dto: CreateWalkInSaleDto, userId: string) {
    const bags    = dto.bags    ?? [];
    const kgLines = dto.kgLines ?? [];

    if (bags.length === 0 && kgLines.length === 0) {
      throw new BadRequestException({
        message: 'At least one bag line or KG line is required',
        error: 'At least one bag line or KG line is required',
        code: 'VALIDATION_ERROR',
      });
    }

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

    // ── Build invoice lines for all sale types ─────────────────────────────────

    // BAG lines — same as before, converted to client currency.
    const bagInvoiceLines = bags.map((b) => {
      const priceInClientCcy = toClientCurrency(new Decimal(b.pricePerBag), b.currency);
      return {
        bagTypeId:   b.bagTypeId,
        bagTypeName: b.bagTypeName,
        qty:         b.quantity,
        pricePerBag: priceInClientCcy.toFixed(2),
      };
    });

    // KG lines — new in Phase 4, converted to client currency.
    const kgInvoiceLines = kgLines.map((k) => {
      const priceInClientCcy = toClientCurrency(new Decimal(k.pricePerKg), k.currency);
      return {
        saleUnit:    'KG' as const,
        kgQuantity:  k.kgQuantity,
        description: k.description,
        pricePerKg:  priceInClientCcy.toFixed(2),
      };
    });

    const { lines: enrichedLines, subtotal } = this.calculator.computeLines([
      ...bagInvoiceLines,
      ...kgInvoiceLines,
    ]);
    const total = this.calculator.computeTotal(subtotal);

    // Compute the payment received, converted into the client's currency.
    const receivedUsd = new Decimal(dto.receivedUsd ?? '0');
    const receivedLbp = new Decimal(dto.receivedLbp ?? '0');
    let received = new Decimal(0);
    if (receivedUsd.gt(0)) received = received.plus(toClientCurrency(receivedUsd, 'USD'));
    if (receivedLbp.gt(0)) received = received.plus(toClientCurrency(receivedLbp, 'LBP'));

    return this.prisma.$transaction(async (tx) => {
      // ── 1) Process BAG lines — drain packed stock ────────────────────────────
      for (const bag of bags) {
        const stock = await tx.packedStock.findUnique({ where: { id: bag.packedStockId } });
        if (!stock) {
          throw new NotFoundException({ error: `Packed stock not found: ${bag.packedStockId}`, code: 'NOT_FOUND' });
        }
        // BUG-E (P2): draw against FREE quantity (quantity − reservedQuantity).
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

        await tx.stockExit.create({
          data: {
            packedStockId: bag.packedStockId,
            bagTypeId:     bag.bagTypeId,
            quantity:      bag.quantity,
            exitType:      'walk_in',
            date:          new Date(dto.date),
            clientId:      dto.clientId,
            loggedById:    user.id,
            amount:        null, // null keeps invoiced sale out of P&L walk-in aggregate
            ...(dto.recipient ? { recipient: dto.recipient } : {}),
            ...(dto.notes     ? { reason:    dto.notes     } : {}),
          },
        });
      }

      // ── 2) Process KG lines — drain raw stock lots ───────────────────────────
      for (const kg of kgLines) {
        const lot = await tx.stockLot.findUnique({ where: { id: kg.lotId } });
        if (!lot) {
          throw new NotFoundException({ error: `Stock lot not found: ${kg.lotId}`, code: 'NOT_FOUND' });
        }
        const requested  = new Decimal(kg.kgQuantity);
        const available  = new Decimal(lot.kgRemaining.toString());
        if (requested.gt(available)) {
          throw new BadRequestException({
            error: `Insufficient raw stock — available: ${available.toFixed(3)} kg, requested: ${requested.toFixed(3)} kg`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
        await tx.stockLot.update({
          where: { id: kg.lotId },
          data:  { kgRemaining: available.minus(requested).toFixed(3) },
        });

        await tx.stockExit.create({
          data: {
            lotId:      kg.lotId,
            kgQuantity: requested.toFixed(3),
            exitType:   'walk_in',
            date:       new Date(dto.date),
            clientId:   dto.clientId,
            loggedById: user.id,
            amount:     null, // null keeps invoiced KG sale out of P&L walk-in aggregate
            ...(dto.recipient ? { recipient: dto.recipient } : {}),
            ...(dto.notes     ? { reason:    dto.notes     } : {}),
          },
        });
      }

      // ── 3) Create the issued invoice ─────────────────────────────────────────
      const invoice = await tx.invoice.create({
        data: {
          clientId:             dto.clientId,
          lines:                enrichedLines as any,
          subtotal,
          total,
          currency:             clientCurrency,
          source:               'WAREHOUSE_SALE',
          status:               'issued',
          issuedAt:             new Date(dto.date),
          paidAmount:           '0',
          // BUG-J (P5): snapshot the issue-time rate for stable historical P&L.
          exchangeRateSnapshot: rawRate.toString(),
        },
      });

      // ── 4) Create the payment if anything was collected ──────────────────────
      let payment: { id: string } | null = null;
      if (received.gt(0)) {
        payment = await tx.payment.create({
          data: {
            clientId:  dto.clientId,
            invoiceId: invoice.id,
            amount:    received.toFixed(2),
            currency:  clientCurrency,
            method:    dto.method,
            date:      new Date(dto.date),
            loggedById: user.id,
            ...(dto.receiverId ? { receiverId: dto.receiverId } : {}),
            ...(dto.notes      ? { notes:      dto.notes      } : {}),
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
        where:   { id: invoice.id },
        include: { client: { select: { id: true, name: true } }, payments: true },
      });
    });
  }
}
