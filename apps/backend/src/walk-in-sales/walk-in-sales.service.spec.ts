import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WalkInSalesService } from './walk-in-sales.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceCalculatorService } from '../invoices/invoice-calculator.service';
import { SettingsService } from '../settings/settings.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }

/**
 * BUG-3 (P3 — missing canonical ledger record) + BUG-4 (currency / missing rate).
 * A walk-in sale to a registered client must, in ONE transaction, create the stock exit,
 * an *issued* invoice, and a payment in the CLIENT's currency — never a payment with no
 * invoice, never a $0 movement from a missing rate.
 */
describe('WalkInSalesService (BUG-3 + BUG-4)', () => {
  let service: WalkInSalesService;

  const mockPrisma = { user: { findUnique: fn() }, client: { findUnique: fn() }, $transaction: fn() } as any;
  // Real-ish calculator: sum qty*price.
  const calculator = {
    computeLines: (lines: any[]) => {
      let subtotal = 0;
      const enriched = lines.map((l) => {
        const lineTotal = parseFloat(l.pricePerBag) * l.qty;
        subtotal += lineTotal;
        return { ...l, pricePerBag: parseFloat(l.pricePerBag).toFixed(2), lineTotal: lineTotal.toFixed(2) };
      });
      return { lines: enriched, subtotal: subtotal.toFixed(2) };
    },
    computeTotal: (s: string) => parseFloat(s).toFixed(2),
    recomputeStatus: fn(),
  } as any;
  const settings = { getExchangeRate: fn() } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalkInSalesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InvoiceCalculatorService, useValue: calculator },
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();
    service = module.get<WalkInSalesService>(WalkInSalesService);
  });

  const clerkId = 'clerk-1';
  const clientId = 'client-1';
  const bagTypeId = 'bag-1';
  const packedStockId = 'ps-1';

  function makeTx() {
    return {
      _invoice: null as any,
      _payment: null as any,
      packedStock: {
        findUnique: fn().mockResolvedValue({ id: packedStockId, quantity: 100, reservedQuantity: 0 }),
        update: fn().mockResolvedValue({}),
      },
      stockExit: { create: fn().mockResolvedValue({ id: 'exit-1' }) },
      invoice: {
        create: fn().mockImplementation(async (args: any) => { const inv = { id: 'inv-1', ...args.data }; return inv; }),
        update: fn().mockResolvedValue({}),
        findUnique: fn().mockResolvedValue({ id: 'inv-1', payments: [] }),
      },
      payment: { create: fn().mockImplementation(async (args: any) => ({ id: 'pay-1', ...args.data })) },
      userAccount: { upsert: fn(), update: fn() },
      accountEntry: { create: fn() },
    };
  }

  function baseDto(over: Partial<any> = {}) {
    return {
      clientId,
      date: '2026-06-03',
      bags: [{ packedStockId, bagTypeId, bagTypeName: '25kg', quantity: 10, pricePerBag: '12.00', currency: 'USD' }],
      method: 'cash',
      recipient: 'Acme',
      ...over,
    } as any;
  }

  it('BUG-3: creates exit + ISSUED invoice + payment in one tx; balance = invoices − payments (≥0)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkId });
    mockPrisma.client.findUnique.mockResolvedValue({ id: clientId, name: 'Acme', currency: 'USD' });
    settings.getExchangeRate.mockResolvedValue(89550);
    calculator.recomputeStatus.mockResolvedValue({ paidAmount: '120.00', status: 'paid' });
    const tx = makeTx();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    // Sale 10 × $12 = $120; received exactly $120.
    await service.create(baseDto({ receivedUsd: '120.00' }), clerkId);

    // Stock exit written (canonical ledger record present — BUG-3 fixed).
    expect(tx.stockExit.create).toHaveBeenCalledTimes(1);
    // Invoice created as ISSUED for the full sale total.
    const invArg = tx.invoice.create.mock.calls[0][0].data;
    expect(invArg.status).toBe('issued');
    expect(invArg.total).toBe('120.00');
    // Payment created and linked to the invoice.
    const payArg = tx.payment.create.mock.calls[0][0].data;
    expect(payArg.invoiceId).toBe('inv-1');
    expect(payArg.amount).toBe('120.00');
    // Balance = invoices(120) − payments(120) = 0, never negative.
    const balance = 120 - parseFloat(payArg.amount);
    expect(balance).toBeGreaterThanOrEqual(0);
  });

  it('BUG-4: payment & invoice are stored in the CLIENT currency (LBP), not hardcoded USD', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkId });
    mockPrisma.client.findUnique.mockResolvedValue({ id: clientId, name: 'Acme', currency: 'LBP' });
    settings.getExchangeRate.mockResolvedValue(90000); // 90,000 LBP per USD
    calculator.recomputeStatus.mockResolvedValue({ paidAmount: '0.00', status: 'issued' });
    const tx = makeTx();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    // Price quoted in USD ($12); client currency is LBP → invoice line converts to 1,080,000 LBP/bag.
    await service.create(baseDto({ receivedLbp: '10800000' }), clerkId);

    const invArg = tx.invoice.create.mock.calls[0][0].data;
    expect(invArg.currency).toBe('LBP');
    // 12 USD × 90000 = 1,080,000 LBP per bag × 10 = 10,800,000 total.
    expect(invArg.total).toBe('10800000.00');

    const payArg = tx.payment.create.mock.calls[0][0].data;
    expect(payArg.currency).toBe('LBP');
    expect(payArg.amount).toBe('10800000.00');
  });

  it('BUG-4: rejects the sale when a conversion is required but the rate is zero (no $0 movement)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkId });
    mockPrisma.client.findUnique.mockResolvedValue({ id: clientId, name: 'Acme', currency: 'LBP' });
    settings.getExchangeRate.mockResolvedValue(0); // missing / zero rate
    const tx = makeTx();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    // USD-priced line into an LBP client requires conversion → must reject, write nothing.
    await expect(service.create(baseDto({ receivedUsd: '50' }), clerkId)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.invoice.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('zero received: issued invoice is created but NO payment movement (balance = full invoice, owed)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkId });
    mockPrisma.client.findUnique.mockResolvedValue({ id: clientId, name: 'Acme', currency: 'USD' });
    settings.getExchangeRate.mockResolvedValue(89550);
    const tx = makeTx();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.create(baseDto({}), clerkId); // nothing received

    expect(tx.invoice.create).toHaveBeenCalledTimes(1);
    expect(tx.invoice.create.mock.calls[0][0].data.status).toBe('issued');
    expect(tx.payment.create).not.toHaveBeenCalled(); // no $0 payment
  });

  // ── TEST A1 ─────────────────────────────────────────────────────────────────
  // Verifies the null-amount invariant: a walk-in exit linked to an invoice
  // must have amount=null so it is excluded from the walk-in P&L aggregate
  // (which only sums non-null amounts for anonymous exits).
  it('A1: WalkInSalesService.create sets amount=null on the created StockExit', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkId });
    mockPrisma.client.findUnique.mockResolvedValue({ id: clientId, name: 'Acme', currency: 'USD' });
    settings.getExchangeRate.mockResolvedValue(89550);
    calculator.recomputeStatus.mockResolvedValue({ paidAmount: '120.00', status: 'paid' });
    const tx = makeTx();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.create(baseDto({ receivedUsd: '120.00' }), clerkId);

    expect(tx.stockExit.create).toHaveBeenCalledTimes(1);
    const stockExitData = tx.stockExit.create.mock.calls[0][0].data;
    // Must be exactly null — not undefined and not a numeric value.
    // undefined would be a missing field (accidental), a number would break
    // the P&L filter (amount: { not: null }) and double-count revenue.
    expect(stockExitData.amount).toBeNull();
    expect(stockExitData.amount).not.toBeUndefined();
    expect(typeof stockExitData.amount).not.toBe('number');
    expect(typeof stockExitData.amount).not.toBe('string');
  });

  it('throws NOT_FOUND when the client does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkId });
    mockPrisma.client.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto({}), clerkId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when packed stock would go negative', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkId });
    mockPrisma.client.findUnique.mockResolvedValue({ id: clientId, name: 'Acme', currency: 'USD' });
    settings.getExchangeRate.mockResolvedValue(89550);
    const tx = makeTx();
    tx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 3, reservedQuantity: 0 }); // only 3, need 10
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await expect(service.create(baseDto({}), clerkId)).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── BUG-E (P2): reserved-stock protection ────────────────────────────────────
  // A walk-in sale must draw against FREE quantity (quantity − reservedQuantity).
  // Here 100 bags exist but 95 are reserved for a pending shipment → only 5 free;
  // a request for 10 must be rejected and write nothing, even though raw quantity ≥ 10.
  it('BUG-E: cannot consume bags reserved for a pending shipment (draws free quantity only)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkId });
    mockPrisma.client.findUnique.mockResolvedValue({ id: clientId, name: 'Acme', currency: 'USD' });
    settings.getExchangeRate.mockResolvedValue(89550);
    const tx = makeTx();
    tx.packedStock.findUnique.mockResolvedValue({ id: packedStockId, quantity: 100, reservedQuantity: 95 });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await expect(service.create(baseDto({}), clerkId)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.packedStock.update).not.toHaveBeenCalled();
    expect(tx.stockExit.create).not.toHaveBeenCalled();
  });
});
