import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
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
    $queryRaw: fn(),
  };

  // Minimal ClientBalanceService stub — not the focus of this suite
  const mockBalanceService = {
    computeBalance: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Phone writes run inside an interactive transaction (row lock); the
    // mock just hands the callback the same mock client.
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockPrisma));

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

  it('locks the client row before reading phones (no lost concurrent writes)', async () => {
    mockPrisma.client.findUnique.mockResolvedValue({ id: 'c1', phones: [] });
    mockPrisma.client.update.mockResolvedValue({ id: 'c1' });

    await service.addPhone('c1', { number: '+961 70 111111', label: 'mobile' });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = mockPrisma.$queryRaw.mock.calls[0][0] as { strings: string[] };
    expect(sql.strings.join('?')).toContain('FOR UPDATE');
  });
});

describe('ClientsService — setPhones()', () => {
  let service: ClientsService;
  const mockPrisma = {
    client: { findUnique: fn(), update: fn() },
    $transaction: fn(),
    $queryRaw: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockPrisma));
    mockPrisma.client.update.mockImplementation((args: unknown) => Promise.resolve(args));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ClientBalanceService, useValue: { computeBalance: fn() } },
      ],
    }).compile();
    service = module.get<ClientsService>(ClientsService);
  });

  const saved = () =>
    (mockPrisma.client.update.mock.calls[0][0] as { data: { phones: Array<{ number: string; label: string; isActive: boolean; dateAdded: string }> } }).data.phones;

  it('editing a number in place adds the new one and keeps the old one as inactive, in one write', async () => {
    mockPrisma.client.findUnique.mockResolvedValue({
      id: 'c1',
      phones: [{ number: '03 111111', label: 'mobile', isActive: true, dateAdded: '2026-01-01' }],
    });

    await service.setPhones('c1', { phones: [{ number: '03 222222', label: 'mobile', isActive: true }] });

    expect(mockPrisma.client.update).toHaveBeenCalledTimes(1);
    expect(saved()).toEqual([
      expect.objectContaining({ number: '03 222222', isActive: true }),
      { number: '03 111111', label: 'mobile', isActive: false, dateAdded: '2026-01-01' },
    ]);
  });

  it('keeps submitted order (primary first), updates labels, reactivates, and matches numbers by digits', async () => {
    mockPrisma.client.findUnique.mockResolvedValue({
      id: 'c1',
      phones: [
        { number: '03111111', label: 'mobile', isActive: true, dateAdded: '2026-01-01' },
        { number: '70 222 222', label: 'old', isActive: false, dateAdded: '2026-01-02' },
      ],
    });

    await service.setPhones('c1', {
      phones: [
        { number: '70  222222 ', label: 'office', isActive: true },
        { number: '03 111 111', label: 'mobile', isActive: true },
      ],
    });

    expect(saved()).toEqual([
      { number: '70 222222', label: 'office', isActive: true, dateAdded: '2026-01-02' },
      { number: '03 111 111', label: 'mobile', isActive: true, dateAdded: '2026-01-01' },
    ]);
  });

  it('rejects a number that is only a prefix like "+961 " and never writes', async () => {
    await expect(
      service.setPhones('c1', { phones: [{ number: '+961 ', label: 'mobile', isActive: true }] }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.client.update).not.toHaveBeenCalled();
  });

  it('rejects the same number listed twice', async () => {
    await expect(
      service.setPhones('c1', {
        phones: [
          { number: '03 123456', label: 'mobile', isActive: true },
          { number: '03123456', label: 'office', isActive: true },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Regression coverage for the "client edit doesn't save" bug: nameAr/address/
// creditLimit/notesEn previously had no Client columns at all — the edit
// modal would appear to save them (local state updated immediately) but they
// silently reverted to blank on the very next refetch. Migration
// add_client_profile_fields added real columns; these tests lock in that
// create()/update() actually forward them to Prisma.
// ---------------------------------------------------------------------------
describe('ClientsService — create()/update() profile fields (nameAr/address/creditLimit/notesEn)', () => {
  let service: ClientsService;

  const mockPrisma = {
    client: {
      findUnique: fn(),
      create: fn(),
      update: fn(),
    },
    user: { findUnique: fn() },
  };

  const mockBalanceService = { computeBalance: fn() };

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

  it('create() forwards nameAr/address/creditLimit/notesEn to Prisma when provided', async () => {
    mockPrisma.client.create.mockResolvedValue({ id: 'new-client' });

    await service.create({
      name: 'Acme Trading Co.',
      type: 'wholesale' as any,
      currency: 'USD' as any,
      nameAr: 'أكمي',
      address: '123 Main St',
      creditLimit: '5000.00',
      notesEn: 'VIP client',
    });

    const createCall = mockPrisma.client.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data).toMatchObject({
      nameAr: 'أكمي',
      address: '123 Main St',
      creditLimit: '5000.00',
      notesEn: 'VIP client',
    });
  });

  it('create() omits nameAr/address/creditLimit/notesEn entirely when not provided (not sent as null)', async () => {
    mockPrisma.client.create.mockResolvedValue({ id: 'new-client' });

    await service.create({ name: 'Acme Trading Co.', type: 'wholesale' as any, currency: 'USD' as any });

    const createCall = mockPrisma.client.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data).not.toHaveProperty('nameAr');
    expect(createCall.data).not.toHaveProperty('address');
    expect(createCall.data).not.toHaveProperty('creditLimit');
    expect(createCall.data).not.toHaveProperty('notesEn');
    expect(createCall.data).not.toHaveProperty('openingBalance');
  });

  it('create() writes the opening balance in the same nested create, with the caller as setBy', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'owner-1' });
    mockPrisma.client.create.mockResolvedValue({ id: 'new-client' });

    await service.create(
      {
        name: 'Cedar Grill',
        type: 'restaurant' as any,
        currency: 'USD' as any,
        openingBalance: { amount: '-75.5', date: '2026-11-01', notes: 'From old notebook' },
      },
      'clerk_owner',
    );

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { clerkId: 'clerk_owner' } });
    const createCall = mockPrisma.client.create.mock.calls[0][0] as { data: Record<string, any> };
    expect(createCall.data.openingBalance.create).toMatchObject({
      amount: '-75.50',
      notes: 'From old notebook',
      setById: 'owner-1',
    });
  });

  it('create() rejects a zero opening balance without creating the client', async () => {
    await expect(
      service.create(
        { name: 'Zero', type: 'shop' as any, currency: 'USD' as any, openingBalance: { amount: '0', date: '2026-11-01' } },
        'clerk_owner',
      ),
    ).rejects.toThrow('Opening balance cannot be zero');
    expect(mockPrisma.client.create).not.toHaveBeenCalled();
  });

  it('update() forwards nameAr/address/creditLimit/notesEn to Prisma when provided — the exact fields the Edit Client modal now sends', async () => {
    mockPrisma.client.findUnique.mockResolvedValue({ id: 'client-1' });
    mockBalanceService.computeBalance.mockResolvedValue(new Decimal(0));
    mockPrisma.client.update.mockResolvedValue({ id: 'client-1' });

    await service.update('client-1', {
      nameAr: 'أكمي',
      address: '123 Main St',
      creditLimit: '5000.00',
      notesEn: 'VIP client',
    });

    const updateCall = mockPrisma.client.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).toMatchObject({
      nameAr: 'أكمي',
      address: '123 Main St',
      creditLimit: '5000.00',
      notesEn: 'VIP client',
    });
  });

  it('update() can clear nameAr/address/creditLimit/notesEn by sending null, not just omit them', async () => {
    mockPrisma.client.findUnique.mockResolvedValue({ id: 'client-1' });
    mockBalanceService.computeBalance.mockResolvedValue(new Decimal(0));
    mockPrisma.client.update.mockResolvedValue({ id: 'client-1' });

    await service.update('client-1', {
      nameAr: null as any,
      address: null as any,
      creditLimit: null as any,
      notesEn: null as any,
    });

    const updateCall = mockPrisma.client.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data.nameAr).toBeNull();
    expect(updateCall.data.address).toBeNull();
    expect(updateCall.data.creditLimit).toBeNull();
    expect(updateCall.data.notesEn).toBeNull();
  });

  it('update() leaves nameAr/address/creditLimit/notesEn untouched when omitted from the DTO', async () => {
    mockPrisma.client.findUnique.mockResolvedValue({ id: 'client-1' });
    mockBalanceService.computeBalance.mockResolvedValue(new Decimal(0));
    mockPrisma.client.update.mockResolvedValue({ id: 'client-1' });

    await service.update('client-1', { name: 'New Name' });

    const updateCall = mockPrisma.client.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).not.toHaveProperty('nameAr');
    expect(updateCall.data).not.toHaveProperty('address');
    expect(updateCall.data).not.toHaveProperty('creditLimit');
    expect(updateCall.data).not.toHaveProperty('notesEn');
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
    clientOpeningBalance: { findFirst: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: no client_bags_fill pickups — every pre-existing test below
    // (all normal-client scenarios) is unaffected unless it explicitly
    // overrides this.
    mockPrisma.stockExit.findMany.mockResolvedValue([]);
    // Default: no go-live opening balance.
    mockPrisma.clientOpeningBalance.findFirst.mockResolvedValue(null);

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

  // ── Go-live opening balance (ClientOpeningBalance) ──────────────────────────
  it('opening balance: a positive carry-forward adds to the balance (works with no invoices — e.g. a Fill Client)', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.payment.findMany.mockResolvedValue([{ amount: { toString: () => '200' } }]);
    mockPrisma.clientOpeningBalance.findFirst.mockResolvedValue({ amount: { toString: () => '1000' } });

    const result = await balanceService.computeBalance('c-ob');

    expect(result.toFixed(2)).toBe('800.00');
  });

  it('opening balance: a negative carry-forward (client credit) reduces the balance', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([{ total: { toString: () => '300' } }]);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.clientOpeningBalance.findFirst.mockResolvedValue({ amount: { toString: () => '-100' } });

    const result = await balanceService.computeBalance('c-ob');

    expect(result.toFixed(2)).toBe('200.00');
  });

  it('opening balance: an asOf bound only counts a carry-forward dated on/before it', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    const lte = new Date('2026-11-01T00:00:00Z');

    await balanceService.computeBalance('c-ob', undefined, { lte, businessLt: lte });

    expect(mockPrisma.clientOpeningBalance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: 'c-ob', date: { lte } } }),
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

// ---------------------------------------------------------------------------
// Client Locations (forensic audit, 2026-08-31): "Client Multiple Locations
// with ONE shared client balance" — provenance for normal Orders only.
// CASE numbers reference the task's own test matrix.
// ---------------------------------------------------------------------------
describe('ClientsService — Client Locations', () => {
  let service: ClientsService;

  const mockPrisma = {
    client: { findUnique: fn() },
    clientLocation: { findMany: fn(), findFirst: fn(), findUnique: fn(), create: fn(), update: fn() },
  };
  const mockBalanceService = { computeBalance: fn() };

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

  describe('listLocations()', () => {
    it('CASE 1 — a client with no locations returns an empty list, never crashes', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c1' });
      mockPrisma.clientLocation.findMany.mockResolvedValue([]);

      const result = await service.listLocations('c1');

      expect(result).toEqual([]);
    });

    it('throws NotFoundException for an unknown client', async () => {
      mockPrisma.client.findUnique.mockResolvedValue(null);
      await expect(service.listLocations('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createLocation() — CASE 3', () => {
    it('creates a new location for the client', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c1' });
      mockPrisma.clientLocation.findFirst.mockResolvedValue(null);
      mockPrisma.clientLocation.create.mockResolvedValue({ id: 'loc-a', clientId: 'c1', name: 'Hamra Branch' });

      const result = await service.createLocation('c1', { name: 'Hamra Branch' });

      expect(result.name).toBe('Hamra Branch');
      expect(mockPrisma.clientLocation.create).toHaveBeenCalledWith({
        data: { clientId: 'c1', name: 'Hamra Branch' },
      });
    });

    it('CASE 3 — a second, differently-named location (Location B) can be created for the same client', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c1' });
      mockPrisma.clientLocation.findFirst.mockResolvedValue(null);
      mockPrisma.clientLocation.create.mockResolvedValue({ id: 'loc-b', clientId: 'c1', name: 'Jounieh Branch' });

      const result = await service.createLocation('c1', { name: 'Jounieh Branch' });

      expect(result.name).toBe('Jounieh Branch');
    });

    it('rejects a case-insensitive duplicate name within the SAME client ("Fuel/fuel/FUEL" prevention pattern)', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c1' });
      mockPrisma.clientLocation.findFirst.mockResolvedValue({ id: 'loc-existing', name: 'Hamra Branch' });

      await expect(service.createLocation('c1', { name: 'hamra branch' })).rejects.toThrow(ConflictException);
      expect(mockPrisma.clientLocation.create).not.toHaveBeenCalled();
    });

    it('the SAME location name is allowed for a DIFFERENT client — uniqueness is per-client, not global', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c2' });
      // findFirst is scoped to clientId in the real query — this mock simply
      // proves the service never widens the search beyond the given client.
      mockPrisma.clientLocation.findFirst.mockResolvedValue(null);
      mockPrisma.clientLocation.create.mockResolvedValue({ id: 'loc-c2', clientId: 'c2', name: 'Hamra Branch' });

      const result = await service.createLocation('c2', { name: 'Hamra Branch' });

      expect(result.name).toBe('Hamra Branch');
      expect(mockPrisma.clientLocation.findFirst).toHaveBeenCalledWith({
        where: { clientId: 'c2', name: { equals: 'Hamra Branch', mode: 'insensitive' } },
      });
    });

    it('rejects an empty/whitespace-only name', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'c1' });
      await expect(service.createLocation('c1', { name: '   ' })).rejects.toThrow(BadRequestException);
      expect(mockPrisma.clientLocation.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('updateLocation() — CASE 15 (deactivate preserves history)', () => {
    it('CASE 15 — deactivating a location sets isActive=false, never deletes the row', async () => {
      mockPrisma.clientLocation.findUnique.mockResolvedValue({ id: 'loc-a', clientId: 'c1', name: 'Hamra Branch', isActive: true });
      mockPrisma.clientLocation.update.mockResolvedValue({ id: 'loc-a', clientId: 'c1', name: 'Hamra Branch', isActive: false });

      const result = await service.updateLocation('c1', 'loc-a', { isActive: false });

      expect(result.isActive).toBe(false);
      expect(mockPrisma.clientLocation.update).toHaveBeenCalledWith({
        where: { id: 'loc-a' },
        data: { isActive: false },
      });
      // The row itself is UPDATEd, never deleted — no delete/remove call exists on this service.
    });

    it('throws NotFoundException when the location belongs to a DIFFERENT client', async () => {
      mockPrisma.clientLocation.findUnique.mockResolvedValue({ id: 'loc-a', clientId: 'other-client', name: 'Hamra Branch', isActive: true });
      await expect(service.updateLocation('c1', 'loc-a', { isActive: false })).rejects.toThrow(NotFoundException);
    });

    it('rejects renaming to a name that collides (case-insensitive) with another active location on the same client', async () => {
      mockPrisma.clientLocation.findUnique.mockResolvedValue({ id: 'loc-a', clientId: 'c1', name: 'Hamra Branch', isActive: true });
      mockPrisma.clientLocation.findFirst.mockResolvedValue({ id: 'loc-b', name: 'Jounieh Branch' });

      await expect(service.updateLocation('c1', 'loc-a', { name: 'jounieh branch' })).rejects.toThrow(ConflictException);
    });
  });
});

describe('ClientsService — setFillBags()', () => {
  let service: ClientsService;
  const mockPrisma = { client: { findUnique: fn(), update: fn() } };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.client.update.mockImplementation((args: unknown) => Promise.resolve(args));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ClientBalanceService, useValue: { computeBalance: fn() } },
      ],
    }).compile();
    service = module.get<ClientsService>(ClientsService);
  });

  it('stores the bag list on the client (trimmed, bagCost 0 when they supply the bag)', async () => {
    mockPrisma.client.findUnique.mockResolvedValue({ id: 'c1' });
    await service.setFillBags('c1', {
      bags: [
        { id: 'a', size: 10, charcoal: ' Grade A ', price: 2.5, worker: 0.25, ours: true, bagCost: 0.3 },
        { id: 'b', size: 5, charcoal: 'mix', price: 1, worker: 0.1, ours: false, bagCost: 9 },
      ],
    });
    const args = mockPrisma.client.update.mock.calls[0][0] as { where: { id: string }; data: { fillBags: unknown[] } };
    expect(args.where).toEqual({ id: 'c1' });
    expect(args.data.fillBags).toEqual([
      { id: 'a', size: 10, charcoal: 'Grade A', price: 2.5, worker: 0.25, ours: true, bagCost: 0.3 },
      { id: 'b', size: 5, charcoal: 'mix', price: 1, worker: 0.1, ours: false, bagCost: 0 },
    ]);
  });

  it('throws NotFound for an unknown client and writes nothing', async () => {
    mockPrisma.client.findUnique.mockResolvedValue(null);
    await expect(service.setFillBags('nope', { bags: [] })).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.client.update).not.toHaveBeenCalled();
  });
});

describe('ClientsService — New client form fields (terms / notes / preferred payment)', () => {
  let service: ClientsService;
  const mockPrisma = { client: { findUnique: fn(), create: fn(), update: fn() }, user: { findUnique: fn() } };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ClientBalanceService, useValue: { computeBalance: fn().mockResolvedValue({ toFixed: () => '0.00' }) } },
      ],
    }).compile();
    service = module.get<ClientsService>(ClientsService);
  });

  it('create() saves paymentTerms, notes, notesEn and preferredPaymentMethod', async () => {
    mockPrisma.client.create.mockResolvedValue({ id: 'c' });
    await service.create({
      name: 'X', type: 'restaurant' as any, currency: 'USD' as any,
      paymentTerms: 'Cash on delivery', notes: 'ملاحظة', notesEn: 'Back door', preferredPaymentMethod: 'whish' as any,
    });
    expect((mockPrisma.client.create.mock.calls[0][0] as { data: unknown }).data).toMatchObject({
      paymentTerms: 'Cash on delivery', notes: 'ملاحظة', notesEn: 'Back door', preferredPaymentMethod: 'whish',
    });
  });

  it('update() can set and clear preferredPaymentMethod', async () => {
    mockPrisma.client.findUnique.mockResolvedValue({ id: 'c' });
    mockPrisma.client.update.mockResolvedValue({ id: 'c' });
    await service.update('c', { preferredPaymentMethod: 'omt' as any });
    await service.update('c', { preferredPaymentMethod: null });
    expect((mockPrisma.client.update.mock.calls[0][0] as { data: unknown }).data).toEqual({ preferredPaymentMethod: 'omt' });
    expect((mockPrisma.client.update.mock.calls[1][0] as { data: unknown }).data).toEqual({ preferredPaymentMethod: null });
  });
});
