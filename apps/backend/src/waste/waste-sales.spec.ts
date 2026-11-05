import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { drawFromWastePool, returnSaleToWastePool } from '../common/inventory/waste-pool';
import { WalkInSalesService, computeSaleFingerprint } from '../walk-in-sales/walk-in-sales.service';
import { StockExitsService, computeStockExitFingerprint } from '../stock-exits/stock-exits.service';
import { InvoicesService } from '../invoices/invoices.service';
import { WasteService } from './waste.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceCalculatorService } from '../invoices/invoice-calculator.service';
import { PaymentAllocationService } from '../invoices/payment-allocation.service';
import { SettingsService } from '../settings/settings.service';
import { LedgerWriteService } from '../ledger/ledger-write.service';
import { UsersService } from '../users/users.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fn(): any { return jest.fn(); }

/**
 * Waste pool — selling (Phase 3) and disposal. Mocked-tx unit tests, same approach
 * and caveat as waste-pool.spec.ts: they prove the pool is locked before it is read,
 * the pool and ledger move together by the same kg, insufficient stock is rejected,
 * and each sale path links its exit / invoice. Real concurrency needs Postgres.
 */

/** Minimal tx with a waste pool holding `kgOnHand`; records call order. */
function poolTx(kgOnHand: string) {
  const order: string[] = [];
  const tx: any = {
    $queryRaw: fn().mockImplementation(async () => { order.push('lock'); return []; }),
    wasteStock: {
      findUnique: fn().mockImplementation(async () => { order.push('read'); return { id: 'singleton', kgOnHand: { toString: () => kgOnHand } }; }),
      update: fn().mockResolvedValue({}),
      upsert: fn().mockResolvedValue({}),
    },
    wasteEntry: { create: fn().mockImplementation(async (a: any) => ({ id: 'we-1', ...a.data })) },
  };
  return { tx, order };
}

describe('drawFromWastePool', () => {
  it('locks before reading, decrements the pool and writes the matching NEGATIVE entry', async () => {
    const { tx, order } = poolTx('100.000');
    await drawFromWastePool(tx, {
      type: 'sale', kg: new Decimal('40'), date: new Date('2026-11-05'), createdById: 'u1',
      stockExitId: 'exit-1', invoiceId: 'inv-1', note: 'Sold to Acme',
    });
    expect(order).toEqual(['lock', 'read']);
    expect(tx.wasteStock.update).toHaveBeenCalledWith({ where: { id: 'singleton' }, data: { kgOnHand: '60.000' } });
    expect(tx.wasteEntry.create).toHaveBeenCalledWith({
      data: {
        type: 'sale', kg: '-40.000', date: new Date('2026-11-05'), createdById: 'u1',
        stockExitId: 'exit-1', invoiceId: 'inv-1', note: 'Sold to Acme',
      },
    });
  });

  it('allows drawing the pool down to exactly zero', async () => {
    const { tx } = poolTx('25.500');
    await drawFromWastePool(tx, { type: 'disposal', kg: new Decimal('25.5'), date: new Date(), createdById: 'u1' });
    expect(tx.wasteStock.update).toHaveBeenCalledWith({ where: { id: 'singleton' }, data: { kgOnHand: '0.000' } });
  });

  it('rejects WASTE_POOL_INSUFFICIENT and writes nothing when the pool is short', async () => {
    const { tx } = poolTx('10.000');
    await expect(
      drawFromWastePool(tx, { type: 'sale', kg: new Decimal('10.001'), date: new Date(), createdById: 'u1' }),
    ).rejects.toMatchObject({ response: { code: 'WASTE_POOL_INSUFFICIENT' } });
    expect(tx.wasteStock.update).not.toHaveBeenCalled();
    expect(tx.wasteEntry.create).not.toHaveBeenCalled();
  });

  it('rejects a zero or negative kg before touching the pool (it would ADD waste)', async () => {
    const { tx } = poolTx('10.000');
    await expect(
      drawFromWastePool(tx, { type: 'sale', kg: new Decimal('0'), date: new Date(), createdById: 'u1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      drawFromWastePool(tx, { type: 'sale', kg: new Decimal('-5'), date: new Date(), createdById: 'u1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('returnSaleToWastePool', () => {
  it('adds the kg back with a POSITIVE, unlinked sale entry (original entry kept)', async () => {
    const { tx } = poolTx('0');
    await returnSaleToWastePool(tx, { kg: new Decimal('40'), date: new Date('2026-11-05'), createdById: 'u1', note: 'cancelled' });
    expect(tx.wasteStock.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { kgOnHand: { increment: '40.000' } } }));
    expect(tx.wasteEntry.create).toHaveBeenCalledWith({
      data: { type: 'sale', kg: '40.000', date: new Date('2026-11-05'), createdById: 'u1', note: 'cancelled' },
    });
  });
});

describe('WalkInSalesService — waste lines (registered client)', () => {
  let service: WalkInSalesService;
  const mockPrisma: any = { user: { findUnique: fn() }, client: { findUnique: fn() }, invoice: { findFirst: fn() }, $transaction: fn() };
  const calculator: any = {
    computeLines: (lines: any[]) => {
      let subtotal = 0;
      const enriched = lines.map((l) => {
        const lineTotal = l.saleUnit === 'KG' ? parseFloat(l.kgQuantity) * parseFloat(l.pricePerKg) : parseFloat(l.pricePerBag) * l.qty;
        subtotal += lineTotal;
        return { ...l, lineTotal: lineTotal.toFixed(2) };
      });
      return { lines: enriched, subtotal: subtotal.toFixed(2) };
    },
    computeTotal: (s: string) => parseFloat(s).toFixed(2),
  };
  const settings: any = { getExchangeRate: fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        WalkInSalesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InvoiceCalculatorService, useValue: calculator },
        { provide: PaymentAllocationService, useValue: { allocateDirect: fn().mockResolvedValue(undefined) } },
        { provide: SettingsService, useValue: settings },
        { provide: LedgerWriteService, useValue: { creditAccount: fn() } },
        { provide: UsersService, useValue: { validateCashCapable: fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(WalkInSalesService);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkId: 'clerk-1' });
    mockPrisma.client.findUnique.mockResolvedValue({ id: 'client-1', name: 'Acme', currency: 'USD' });
    settings.getExchangeRate.mockResolvedValue(89500);
  });

  function saleTx(kgOnHand: string) {
    const { tx } = poolTx(kgOnHand);
    Object.assign(tx, {
      stockExit: { create: fn().mockResolvedValue({ id: 'exit-w' }) },
      invoice: {
        create: fn().mockImplementation(async (a: any) => ({ id: 'inv-1', ...a.data })),
        findUnique: fn().mockResolvedValue({ id: 'inv-1', payments: [] }),
      },
      payment: { create: fn() },
      user: { findUnique: fn() },
    });
    return tx;
  }

  const wasteDto = (over: any = {}) => ({
    clientId: 'client-1', date: '2026-11-05', method: 'cash', recipient: 'Acme',
    wasteLines: [{ kgQuantity: '120.000', pricePerKg: '0.40', currency: 'USD' }],
    ...over,
  }) as any;

  it('a waste-only sale invoices a "Waste" KG line, creates one lot-less exit and draws the pool', async () => {
    const tx = saleTx('500.000');
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.create(wasteDto(), 'clerk-1');

    const inv = tx.invoice.create.mock.calls[0][0].data;
    expect(inv.total).toBe('48.00');
    expect(inv.lines).toEqual([expect.objectContaining({
      saleUnit: 'KG', kgQuantity: '120.000', description: 'Waste charcoal', pricePerKg: '0.40',
      charcoalType: 'Waste', grade: 'Mixed',
    })]);
    const exit = tx.stockExit.create.mock.calls[0][0].data;
    expect(exit).toMatchObject({ kgQuantity: '120.000', exitType: 'walk_in', invoiceId: 'inv-1', amount: null });
    expect(exit.lotId).toBeUndefined();
    expect(tx.wasteStock.update).toHaveBeenCalledWith({ where: { id: 'singleton' }, data: { kgOnHand: '380.000' } });
    expect(tx.wasteEntry.create.mock.calls[0][0].data).toMatchObject({
      type: 'sale', kg: '-120.000', stockExitId: 'exit-w', invoiceId: 'inv-1',
    });
  });

  it('several waste lines collapse into ONE exit / ONE pool draw; prices stay per line', async () => {
    const tx = saleTx('500.000');
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    await service.create(wasteDto({ wasteLines: [
      { kgQuantity: '100', pricePerKg: '0.40', currency: 'USD', description: 'Dust' },
      { kgQuantity: '50', pricePerKg: '0.60', currency: 'USD' },
    ] }), 'clerk-1');
    expect(tx.invoice.create.mock.calls[0][0].data.total).toBe('70.00');
    expect(tx.stockExit.create).toHaveBeenCalledTimes(1);
    expect(tx.stockExit.create.mock.calls[0][0].data.kgQuantity).toBe('150.000');
    expect(tx.wasteEntry.create).toHaveBeenCalledTimes(1);
    expect(tx.invoice.create.mock.calls[0][0].data.lines[0].description).toBe('Dust');
  });

  it('converts an LBP waste price into the client currency like other lines', async () => {
    const tx = saleTx('500.000');
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    await service.create(wasteDto({ wasteLines: [{ kgQuantity: '10', pricePerKg: '89500', currency: 'LBP' }] }), 'clerk-1');
    expect(tx.invoice.create.mock.calls[0][0].data.lines[0].pricePerKg).toBe('1.00');
  });

  it('rejects when the pool is short (the whole transaction rolls back)', async () => {
    const tx = saleTx('100.000');
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    await expect(service.create(wasteDto(), 'clerk-1')).rejects.toMatchObject({ response: { code: 'WASTE_POOL_INSUFFICIENT' } });
    expect(tx.wasteStock.update).not.toHaveBeenCalled();
  });

  it('rejects a non-positive waste kg before opening the transaction', async () => {
    await expect(service.create(wasteDto({ wasteLines: [{ kgQuantity: '0', pricePerKg: '1', currency: 'USD' }] }), 'clerk-1'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('fingerprint: unchanged for sales without waste, different once waste is added', () => {
    const base: any = { clientId: 'c', date: '2026-11-05', method: 'cash', kgLines: [] };
    expect(computeSaleFingerprint(base)).toBe(computeSaleFingerprint({ ...base, wasteLines: [] }));
    expect(computeSaleFingerprint(base)).not.toBe(
      computeSaleFingerprint({ ...base, wasteLines: [{ kgQuantity: '1', pricePerKg: '1', currency: 'USD' }] }),
    );
  });
});

describe('StockExitsService — anonymous waste sale (fromWastePool)', () => {
  let service: StockExitsService;
  const mockPrisma: any = { user: { findUnique: fn() }, stockExit: { findFirst: fn() }, $transaction: fn() };
  const ledger: any = { creditAccount: fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        StockExitsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerWriteService, useValue: ledger },
        { provide: UsersService, useValue: { validateCashCapable: fn().mockResolvedValue(undefined) } },
        { provide: SettingsService, useValue: { getExchangeRate: fn() } },
      ],
    }).compile();
    service = module.get(StockExitsService);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'Owner' });
  });

  const dto = (over: any = {}) => ({
    fromWastePool: true, kgQuantity: 30, exitType: 'walk_in', date: '2026-11-05',
    amount: 12, currency: 'USD', recipient: 'Bakery', collectedById: 'u2', ...over,
  }) as any;

  it('creates a lot-less exit, draws the pool with a linked entry, and credits the collector', async () => {
    const { tx } = poolTx('50.000');
    tx.stockExit = { create: fn().mockResolvedValue({ id: 'exit-a' }) };
    tx.stockLot = { update: fn() };
    tx.packedStock = { update: fn() };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.create(dto(), 'clerk-1', 'owner');

    const data = tx.stockExit.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kgQuantity: '30.000', amount: '12.00', exitType: 'walk_in' });
    expect(data.lotId).toBeUndefined();
    expect(tx.stockLot.update).not.toHaveBeenCalled();
    expect(tx.packedStock.update).not.toHaveBeenCalled();
    expect(tx.wasteStock.update).toHaveBeenCalledWith({ where: { id: 'singleton' }, data: { kgOnHand: '20.000' } });
    expect(tx.wasteEntry.create.mock.calls[0][0].data).toMatchObject({ type: 'sale', kg: '-30.000', stockExitId: 'exit-a' });
    expect(ledger.creditAccount).toHaveBeenCalledTimes(1);
  });

  it('rejects mixing waste mode with a lot, or a non-sale exit type', async () => {
    const { tx } = poolTx('50.000');
    tx.stockExit = { create: fn() };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    await expect(service.create(dto({ lotId: 'lot-1' }), 'clerk-1', 'owner')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(dto({ exitType: 'gift' }), 'clerk-1', 'owner')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.stockExit.create).not.toHaveBeenCalled();
  });

  it('fingerprint: unchanged for normal exits, different for a waste exit', () => {
    const base: any = { exitType: 'walk_in', date: '2026-11-05', kgQuantity: 30 };
    expect(computeStockExitFingerprint(base)).toBe(computeStockExitFingerprint({ ...base, fromWastePool: false }));
    expect(computeStockExitFingerprint(base)).not.toBe(computeStockExitFingerprint({ ...base, fromWastePool: true }));
  });
});

describe('InvoicesService.cancel — waste sale', () => {
  it('puts the sold waste back into the pool instead of touching a lot', async () => {
    const { tx } = poolTx('0');
    Object.assign(tx, {
      invoice: {
        findUnique: fn().mockResolvedValue({ id: 'inv-1', displayId: 'SI-0001', status: 'issued', source: 'WAREHOUSE_SALE', orderId: null }),
        update: fn().mockResolvedValue({ id: 'inv-1', status: 'cancelled' }),
      },
      paymentAllocation: { findFirst: fn().mockResolvedValue(null) },
      stockExit: {
        findMany: fn().mockResolvedValue([
          { id: 'exit-w', lotId: null, packedStockId: null, kgQuantity: '120.000', date: new Date('2026-11-05'),
            wasteEntry: { kg: { toString: () => '-120.000' }, createdById: 'u1' } },
        ]),
      },
      stockLot: { update: fn() },
      packedStock: { update: fn() },
    });
    const prisma: any = { $transaction: fn().mockImplementation(async (cb: any) => cb(tx)) };
    const module = await Test.createTestingModule({
      providers: [
        InvoicesService,
        InvoiceCalculatorService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: { getExchangeRate: fn() } },
      ],
    }).compile();

    await module.get(InvoicesService).cancel('inv-1');

    expect(tx.wasteStock.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { kgOnHand: { increment: '120.000' } } }));
    expect(tx.wasteEntry.create.mock.calls[0][0].data).toMatchObject({ type: 'sale', kg: '120.000' });
    expect(tx.wasteEntry.create.mock.calls[0][0].data.note).toContain('SI-0001');
    expect(tx.stockLot.update).not.toHaveBeenCalled();
    expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: 'cancelled' } });
  });
});

describe('WasteService.createDisposal', () => {
  it('writes a negative disposal entry for the given kg, attributed to the caller', async () => {
    const { tx } = poolTx('80.000');
    const prisma: any = {
      user: { findUnique: fn().mockResolvedValue({ id: 'u1' }) },
      $transaction: fn().mockImplementation(async (cb: any) => cb(tx)),
    };
    const module = await Test.createTestingModule({ providers: [WasteService, { provide: PrismaService, useValue: prisma }] }).compile();
    await module.get(WasteService).createDisposal({ kg: '35.5', date: '2026-11-05', note: '  Wet dust  ' }, 'clerk-1');
    expect(tx.wasteStock.update).toHaveBeenCalledWith({ where: { id: 'singleton' }, data: { kgOnHand: '44.500' } });
    expect(tx.wasteEntry.create.mock.calls[0][0].data).toMatchObject({ type: 'disposal', kg: '-35.500', createdById: 'u1', note: 'Wet dust' });
  });
});
