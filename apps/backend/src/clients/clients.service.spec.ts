import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientBalanceService } from './client-balance.service';
import { PrismaService } from '../prisma/prisma.service';
import Decimal from 'decimal.js';

// ---------------------------------------------------------------------------
// Shared mock factory helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('ClientsService — deactivatePhone()', () => {
  let service: ClientsService;

  const mockPrisma = {
    client: {
      findUnique: fn(),
      update: fn(),
      findMany: fn(),
      count: fn(),
    },
    clientOrder: { findMany: fn(), count: fn() },
    invoice: { findMany: fn(), count: fn() },
    payment: { findMany: fn(), count: fn() },
    $transaction: fn(),
  };

  // Minimal ClientBalanceService stub — not the focus of this suite
  const mockBalanceService = {
    computeBalance: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ClientBalanceService, useValue: mockBalanceService },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
  });

  // =========================================================================
  // Test 1: phone found → sets isActive=false; phone record is NOT removed
  // CONSTRAINT 14: phones are NEVER deleted, only deactivated
  // =========================================================================

  it('sets isActive=false for the matching phone (CONSTRAINT 14: phone is never deleted)', async () => {
    const clientId = 'client-uuid-1';
    const phoneNumber = '+1234567890';

    const existingPhones = [
      { number: '+1234567890', label: 'mobile', isActive: true, dateAdded: '2024-01-01' },
      { number: '+0987654321', label: 'office', isActive: true, dateAdded: '2024-01-02' },
    ];

    mockPrisma.client.findUnique.mockResolvedValue({
      id: clientId,
      phones: existingPhones,
    });
    mockPrisma.client.update.mockResolvedValue({
      id: clientId,
      phones: [
        { number: '+1234567890', label: 'mobile', isActive: false, dateAdded: '2024-01-01' },
        { number: '+0987654321', label: 'office', isActive: true, dateAdded: '2024-01-02' },
      ],
    });

    await service.deactivatePhone(clientId, { phoneNumber });

    expect(mockPrisma.client.update).toHaveBeenCalledTimes(1);

    // The phones array passed to update must still contain BOTH entries (no deletion)
    const updateCall = mockPrisma.client.update.mock.calls[0][0];
    const updatedPhones = updateCall.data.phones as typeof existingPhones;

    expect(updatedPhones).toHaveLength(2);

    // The target phone must be deactivated, not removed
    const target = updatedPhones.find((p) => p.number === phoneNumber);
    expect(target).toBeDefined();
    expect(target!.isActive).toBe(false);

    // Other phones must be untouched
    const other = updatedPhones.find((p) => p.number === '+0987654321');
    expect(other).toBeDefined();
    expect(other!.isActive).toBe(true);
  });

  // =========================================================================
  // Test 2: phone number not in array → throws NotFoundException
  // =========================================================================

  it('throws NotFoundException when the phone number does not exist in the client phones array', async () => {
    const clientId = 'client-uuid-1';

    mockPrisma.client.findUnique.mockResolvedValue({
      id: clientId,
      phones: [
        { number: '+1111111111', label: 'mobile', isActive: true, dateAdded: '2024-01-01' },
      ],
    });

    await expect(
      service.deactivatePhone(clientId, { phoneNumber: '+9999999999' }),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.deactivatePhone(clientId, { phoneNumber: '+9999999999' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_FOUND' }),
    });

    // update must NEVER be called when the phone is missing
    expect(mockPrisma.client.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ClientBalanceService tests
// ---------------------------------------------------------------------------

describe('ClientBalanceService — computeBalance()', () => {
  let balanceService: ClientBalanceService;

  const mockPrisma = {
    invoice: { findMany: fn() },
    stockExit: { findMany: fn() },
    payment: { findMany: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: no client_bags_fill pickups — every pre-existing test below
    // (all normal-client scenarios) is unaffected unless it explicitly
    // overrides this.
    mockPrisma.stockExit.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientBalanceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    balanceService = module.get<ClientBalanceService>(ClientBalanceService);
  });

  // =========================================================================
  // Test 3: invoices [100, 200], payments [50] → balance = 250.00
  // CONSTRAINT 15: balance is computed from accounting documents only, never stored.
  // Formula: Σ invoice.total (non-cancelled, non-draft) − Σ payment.amount
  // =========================================================================

  it('returns 250.00 for invoices [100, 200] and payments [50] (CONSTRAINT 15: computed on-the-fly)', async () => {
    const clientId = 'client-uuid-balance-1';

    mockPrisma.invoice.findMany.mockResolvedValue([
      { total: { toString: () => '100' } },
      { total: { toString: () => '200' } },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([
      { amount: { toString: () => '50' } },
    ]);

    const result = await balanceService.computeBalance(clientId);

    expect(result).toBeInstanceOf(Decimal);
    expect(result.toFixed(2)).toBe('250.00');

    // CONSTRAINT 15: must query invoices (with status filter) and payments
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId,
          status: { notIn: ['draft', 'cancelled'] },
        }),
      }),
    );
    expect(mockPrisma.payment.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId } }),
    );
  });

  // =========================================================================
  // Test 4: zero invoices and zero payments → balance = 0.00
  // =========================================================================

  it('returns 0.00 when there are no invoices and no payments', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.payment.findMany.mockResolvedValue([]);

    const result = await balanceService.computeBalance('client-uuid-zero');

    expect(result).toBeInstanceOf(Decimal);
    expect(result.toFixed(2)).toBe('0.00');
    expect(result.equals(0)).toBe(true);
  });

  // =========================================================================
  // Phase 6: accounting-correctness tests
  // =========================================================================

  it('P6: cancelled invoice does NOT contribute to balance', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      // Service filters out cancelled at the DB query level; this mock
      // simulates the DB returning only non-cancelled invoices.
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([]);

    const result = await balanceService.computeBalance('c-cancelled');

    expect(result.toFixed(2)).toBe('0.00');

    // The query must carry the status exclusion filter
    const args = mockPrisma.invoice.findMany.mock.calls[0][0];
    expect(args.where.status).toEqual({ notIn: ['draft', 'cancelled'] });
  });

  it('P6: draft invoice does NOT contribute to balance', async () => {
    // Same mechanism as cancelled — the status filter is the guard
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.payment.findMany.mockResolvedValue([]);

    await balanceService.computeBalance('c-draft');

    const args = mockPrisma.invoice.findMany.mock.calls[0][0];
    expect(args.where.status).toEqual({ notIn: ['draft', 'cancelled'] });
  });

  it('P6: normal-client stock exits (walk-in amounts) do NOT affect balance — computeBalance() queries stockExit but scopes it to exitType=client_bags_fill, so a walk-in-shaped mock response (irrelevant here) never reaches the sum', async () => {
    // This client has an invoice and no client_bags_fill rows — the default
    // beforeEach mock (stockExit.findMany → []) already models "no fill
    // pickups for this client", the normal-client case.
    mockPrisma.invoice.findMany.mockResolvedValue([
      { total: { toString: () => '100' } },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([]);

    const result = await balanceService.computeBalance('c-exit');

    // Balance is solely from the invoice; no exit amount added
    expect(result.toFixed(2)).toBe('100.00');
  });

  // =========================================================================
  // Fill Client statement feature: computeBalance() now also includes
  // exitType='client_bags_fill' StockExit.amount (fill-client pickup debit —
  // the only debit source for a client type that never receives Invoices).
  // =========================================================================

  it('Fill client: a client_bags_fill pickup with an amount DOES contribute to balance', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.stockExit.findMany.mockResolvedValue([
      { amount: { toString: () => '200.00' } },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([]);

    const result = await balanceService.computeBalance('fc-1');

    expect(result.toFixed(2)).toBe('200.00');
    expect(mockPrisma.stockExit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'fc-1', exitType: 'client_bags_fill', amount: { not: null } },
      }),
    );
  });

  it('Fill client: multiple pickups sum, then a payment reduces the balance', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.stockExit.findMany.mockResolvedValue([
      { amount: { toString: () => '200.00' } },
      { amount: { toString: () => '100.00' } },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([
      { amount: { toString: () => '100.00' } },
    ]);

    const result = await balanceService.computeBalance('fc-2');

    // 200 + 100 − 100 = 200
    expect(result.toFixed(2)).toBe('200.00');
  });

  it('Fill client: fully paid off (pickups == payments) → balance is 0.00', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.stockExit.findMany.mockResolvedValue([
      { amount: { toString: () => '150.00' } },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([
      { amount: { toString: () => '150.00' } },
    ]);

    const result = await balanceService.computeBalance('fc-3');

    expect(result.toFixed(2)).toBe('0.00');
  });

  it('the stockExit query always filters amount NOT NULL — excludes FillJobsService\'s amount-less client_bags_fill rows (raw charcoal consumption, not a charge)', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    await balanceService.computeBalance('fc-4');

    const args = mockPrisma.stockExit.findMany.mock.calls[0][0];
    expect(args.where.amount).toEqual({ not: null });
    expect(args.where.exitType).toBe('client_bags_fill');
  });

  it('P6: balance = issued invoice total minus payment (standard AR flow)', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { total: { toString: () => '500.00' } },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([
      { amount: { toString: () => '200.00' } },
    ]);

    const result = await balanceService.computeBalance('c-ar');

    expect(result.toFixed(2)).toBe('300.00');
  });

  it('P6: balance is negative (credit) when payments exceed invoices', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { total: { toString: () => '100.00' } },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([
      { amount: { toString: () => '150.00' } },
    ]);

    const result = await balanceService.computeBalance('c-credit');

    expect(result.toFixed(2)).toBe('-50.00');
    expect(result.lt(0)).toBe(true);
  });

  it('P6: multiple issued + partially_paid invoices sum correctly', async () => {
    // issued=300, partially_paid=200 → invoiceSum=500; payment=100 → balance=400
    mockPrisma.invoice.findMany.mockResolvedValue([
      { total: { toString: () => '300.00' } },
      { total: { toString: () => '200.00' } },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([
      { amount: { toString: () => '100.00' } },
    ]);

    const result = await balanceService.computeBalance('c-multi');

    expect(result.toFixed(2)).toBe('400.00');
  });
});

// ---------------------------------------------------------------------------
// findAll() — real-column sorts (Prisma orderBy, real pagination) vs.
// computed-field sorts (balance/totalInvoiced/totalCollected/orderCount,
// which need every matching client fetched+computed before an in-memory
// sort+slice, same as the pre-existing hasBalance branch already did).
// ---------------------------------------------------------------------------
describe('ClientsService — findAll()', () => {
  let service: ClientsService;

  const mockPrisma = {
    client: { findMany: fn(), count: fn() },
    invoice: { aggregate: fn() },
    payment: { aggregate: fn() },
    clientOrder: { count: fn() },
    $transaction: fn(),
  };

  const mockBalanceService = { computeBalance: fn() };

  function client(id: string, overrides: Record<string, unknown> = {}) {
    return { id, name: id, lastOrderDate: null, createdAt: new Date(), ...overrides };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: any) => Promise.all(ops));
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { total: null } });
    mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
    mockPrisma.clientOrder.count.mockResolvedValue(0);
    mockBalanceService.computeBalance.mockResolvedValue(new Decimal(0));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ClientBalanceService, useValue: mockBalanceService },
      ],
    }).compile();
    service = module.get<ClientsService>(ClientsService);
  });

  it('default (no sortBy): orders by createdAt desc via real Prisma pagination, not a full fetch', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('a')]);
    mockPrisma.client.count.mockResolvedValue(1);

    await service.findAll(1, 20);

    expect(mockPrisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20, orderBy: { createdAt: 'desc' } }),
    );
  });

  it('sortBy=name is a real-column sort — real pagination, no full fetch', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('a')]);
    mockPrisma.client.count.mockResolvedValue(1);

    await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, 'name', 'asc');

    expect(mockPrisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20, orderBy: { name: 'asc' } }),
    );
  });

  it('each returned client carries totalInvoiced/totalCollected/orderCount from the accrual-basis aggregates', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('a')]);
    mockPrisma.client.count.mockResolvedValue(1);
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { total: { toString: () => '500.00' } } });
    mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: { toString: () => '300.00' } } });
    mockPrisma.clientOrder.count.mockResolvedValue(4);

    const result = await service.findAll(1, 20);

    expect(result.data[0]).toMatchObject({ totalInvoiced: '500.00', totalCollected: '300.00', orderCount: 4 });
    // Same accrual exclusion rule as ClientBalanceService.computeBalance().
    expect(mockPrisma.invoice.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { notIn: ['draft', 'cancelled'] } }) }),
    );
  });

  it('a client with no invoices/payments/orders gets "0"/"0"/0, not null or a crash', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('a')]);
    mockPrisma.client.count.mockResolvedValue(1);

    const result = await service.findAll(1, 20);

    expect(result.data[0]).toMatchObject({ totalInvoiced: '0', totalCollected: '0', orderCount: 0 });
  });

  it('sortBy=totalInvoiced triggers the full-fetch-then-sort path (no skip/take on the initial client query)', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('a'), client('b')]);

    await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, 'totalInvoiced', 'desc');

    const call = mockPrisma.client.findMany.mock.calls[0][0];
    expect(call.skip).toBeUndefined();
    expect(call.take).toBeUndefined();
  });

  it('sortBy=totalInvoiced actually orders clients by their computed total, descending', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('low'), client('high')]);
    mockPrisma.invoice.aggregate
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '100.00' } } }) // 'low'
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '900.00' } } }); // 'high'

    const result = await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, 'totalInvoiced', 'desc');

    expect(result.data.map((c: any) => c.id)).toEqual(['high', 'low']);
  });

  it('sortBy=totalInvoiced with sortOrder=asc reverses the order', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('low'), client('high')]);
    mockPrisma.invoice.aggregate
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '100.00' } } })
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '900.00' } } });

    const result = await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, 'totalInvoiced', 'asc');

    expect(result.data.map((c: any) => c.id)).toEqual(['low', 'high']);
  });

  it('sortBy=orderCount sorts by order count, not by any invoice/payment amount', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('few'), client('many')]);
    mockPrisma.clientOrder.count.mockResolvedValueOnce(1).mockResolvedValueOnce(9);

    const result = await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, 'orderCount', 'desc');

    expect(result.data.map((c: any) => c.id)).toEqual(['many', 'few']);
  });

  it('hasBalance filter still works (pre-existing behavior, unaffected by the new sort branch)', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('a'), client('b')]);
    mockBalanceService.computeBalance
      .mockResolvedValueOnce(new Decimal(50))  // 'a' — has balance
      .mockResolvedValueOnce(new Decimal(0));  // 'b' — clear

    const result = await service.findAll(1, 20, undefined, undefined, undefined, undefined, true);

    expect(result.data.map((c: any) => c.id)).toEqual(['a']);
    expect(result.total).toBe(1);
  });

  it('an unrecognized sortBy falls back to the default real-column path (createdAt desc, real pagination)', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('a')]);
    mockPrisma.client.count.mockResolvedValue(1);

    await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, 'notARealField' as any);

    expect(mockPrisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20, orderBy: { createdAt: 'desc' } }),
    );
  });

  it('isActive filter is passed straight into the Prisma where clause (real column, real pagination)', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('a')]);
    mockPrisma.client.count.mockResolvedValue(1);

    await service.findAll(1, 20, undefined, undefined, true);

    expect(mockPrisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
    );
  });

  it('isActive=false is distinguished from "not set" (falsy but defined)', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('a')]);
    mockPrisma.client.count.mockResolvedValue(1);

    await service.findAll(1, 20, undefined, undefined, false);

    expect(mockPrisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: false }) }),
    );
  });

  it('minTotalInvoiced alone triggers the full-fetch-then-filter path (totalInvoiced is not a stored column)', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('a')]);

    await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 500);

    const call = mockPrisma.client.findMany.mock.calls[0][0];
    expect(call.skip).toBeUndefined();
    expect(call.take).toBeUndefined();
  });

  it('minTotalInvoiced/maxTotalInvoiced filters clients by their computed totalInvoiced range', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('low'), client('mid'), client('high')]);
    mockPrisma.invoice.aggregate
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '50.00' } } })   // 'low'
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '500.00' } } })  // 'mid'
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '5000.00' } } }); // 'high'

    const result = await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 100, 1000);

    expect(result.data.map((c: any) => c.id)).toEqual(['mid']);
    expect(result.total).toBe(1);
  });

  it('minTotalInvoiced with no maxTotalInvoiced is an open-ended lower bound', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('low'), client('high')]);
    mockPrisma.invoice.aggregate
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '50.00' } } })
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '5000.00' } } });

    const result = await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 100);

    expect(result.data.map((c: any) => c.id)).toEqual(['high']);
  });

  it('a sales-range filter that matches no client returns an empty page with total 0, not an error', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('a')]);
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { total: { toString: () => '10.00' } } });

    const result = await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 9999);

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('type filter combines correctly with sortBy=totalInvoiced (filter narrows, then sort orders the narrowed set)', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('low'), client('high')]);
    mockPrisma.invoice.aggregate
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '100.00' } } })
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '900.00' } } });

    const result = await service.findAll(1, 20, undefined, 'restaurant' as any, undefined, undefined, undefined, 'totalInvoiced', 'desc');

    expect(mockPrisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: 'restaurant' }) }),
    );
    expect(result.data.map((c: any) => c.id)).toEqual(['high', 'low']);
  });

  it('hasBalance and a sales-range filter combine (AND, not OR)', async () => {
    mockPrisma.client.findMany.mockResolvedValue([client('a'), client('b')]);
    mockBalanceService.computeBalance
      .mockResolvedValueOnce(new Decimal(50))  // 'a' — has balance
      .mockResolvedValueOnce(new Decimal(50)); // 'b' — has balance
    mockPrisma.invoice.aggregate
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '50.00' } } })   // 'a' — below min
      .mockResolvedValueOnce({ _sum: { total: { toString: () => '500.00' } } }); // 'b' — above min

    const result = await service.findAll(1, 20, undefined, undefined, undefined, undefined, true, undefined, undefined, 100);

    expect(result.data.map((c: any) => c.id)).toEqual(['b']);
  });
});
