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
    payment: { findMany: fn() },
    stockExit: { findMany: fn() }, // walk-in sale amounts also contribute to balance
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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
  // CONSTRAINT 15: balance is computed from invoices - payments, never stored
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
    mockPrisma.stockExit.findMany.mockResolvedValue([]); // no walk-in sale amounts

    const result = await balanceService.computeBalance(clientId);

    // Result is a Decimal and equals 250
    expect(result).toBeInstanceOf(Decimal);
    expect(result.toFixed(2)).toBe('250.00');

    // CONSTRAINT 15 verification: must call invoice.findMany and payment.findMany
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId } }),
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
    mockPrisma.stockExit.findMany.mockResolvedValue([]);

    const result = await balanceService.computeBalance('client-uuid-zero');

    expect(result).toBeInstanceOf(Decimal);
    expect(result.toFixed(2)).toBe('0.00');
    expect(result.equals(0)).toBe(true);
  });
});
