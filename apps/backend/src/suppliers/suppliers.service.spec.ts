import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }

describe('SuppliersService', () => {
  let service: SuppliersService;

  const mockPrisma = {
    supplier: { findUnique: fn(), findMany: fn(), count: fn(), create: fn(), update: fn(), delete: fn() },
    container: { count: fn() },
    stockLot: { findMany: fn() },
    supplierPayment: { findMany: fn(), create: fn(), count: fn() },
    supplierOpeningBalance: { findUnique: fn(), findMany: fn(), upsert: fn(), deleteMany: fn() },
    user: { findUnique: fn() },
    $transaction: fn(),
  };

  const mockSettings = {
    getExchangeRate: fn(),
  };

  const supplier = { id: 'sup-1', name: 'Indonesian Charcoal Co.', containers: [] };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.supplier.findUnique.mockResolvedValue(supplier);
    mockPrisma.container.count.mockResolvedValue(0);
    mockPrisma.stockLot.findMany.mockResolvedValue([]);
    mockPrisma.supplierPayment.findMany.mockResolvedValue([]);
    mockPrisma.supplierOpeningBalance.findUnique.mockResolvedValue(null);
    mockPrisma.supplierOpeningBalance.findMany.mockResolvedValue([]);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    mockSettings.getExchangeRate.mockResolvedValue('89550');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  describe('findOne()', () => {
    it('throws NotFoundException when the supplier does not exist', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ===========================================================================
  // Regression: CreateSupplierPaymentDto.amount is @IsNumberString with no
  // decorator-level bound, and unlike PaymentsService.create() (the
  // client-payment sibling of this exact DTO shape), createPayment() had no
  // service-level check either — a zero/negative amount silently corrupted
  // the supplier's totalSpentUsd/outstandingUsd aggregates.
  // ===========================================================================
  describe('createPayment() — amount validation', () => {
    const validBody = { amount: '500.00', currency: 'USD' as const, method: 'cash' as const, date: '2026-08-01' };

    it('rejects a zero amount', async () => {
      await expect(
        service.createPayment('sup-1', { ...validBody, amount: '0.00' }, 'clerk-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.supplierPayment.create).not.toHaveBeenCalled();
    });

    it('rejects a negative amount', async () => {
      await expect(
        service.createPayment('sup-1', { ...validBody, amount: '-500.00' }, 'clerk-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.supplierPayment.create).not.toHaveBeenCalled();
    });

    it('accepts a positive amount and records it with the resolved loggedById', async () => {
      mockPrisma.supplierPayment.create.mockResolvedValue({ id: 'pay-1' });

      await service.createPayment('sup-1', validBody, 'clerk-1');

      const data = mockPrisma.supplierPayment.create.mock.calls[0][0].data;
      expect(data.amount).toBe('500.00');
      expect(data.loggedById).toBe('user-1');
    });

    it('throws NotFoundException when the clerk user is not synced', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.createPayment('sup-1', validBody, 'clerk-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ===========================================================================
  // Go-live opening balance (SupplierOpeningBalance, USD, signed)
  // ===========================================================================
  describe('opening balance', () => {
    const row = { amount: { toString: () => '1500' }, date: new Date('2026-11-01'), notes: 'Old notebook', updatedAt: new Date(), setBy: { name: 'Owner' } };

    it('findOne(): outstandingUsd includes the opening balance on top of purchases − payments', async () => {
      mockPrisma.stockLot.findMany.mockResolvedValue([
        { kgReceived: { toString: () => '1000' }, kgRemaining: { toString: () => '0' }, costPerKg: { toString: () => '0.5' }, charcoalType: 'Oak', grade: 'A' },
      ]);
      mockPrisma.supplierPayment.findMany.mockResolvedValue([{ amount: { toString: () => '200' }, currency: 'USD' }]);
      mockPrisma.supplierOpeningBalance.findUnique.mockResolvedValue({ amount: { toString: () => '1500' } });

      const result = await service.findOne('sup-1');

      // 1500 opening + 500 purchased − 200 paid
      expect(result.outstandingUsd).toBe('1800.00');
      expect(result.openingBalanceUsd).toBe('1500.00');
    });

    it('setOpeningBalance(): upserts the one row for this supplier with the resolved user', async () => {
      mockPrisma.supplierOpeningBalance.upsert.mockResolvedValue(row);

      const result = await service.setOpeningBalance('sup-1', { amount: '1500', date: '2026-11-01', notes: ' Old notebook ' }, 'clerk-1');

      const call = mockPrisma.supplierOpeningBalance.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ supplierId: 'sup-1' });
      expect(call.update).toEqual(expect.objectContaining({ amount: '1500.00', notes: 'Old notebook', setById: 'user-1' }));
      expect(result).toEqual(expect.objectContaining({ amount: '1500.00', setByName: 'Owner' }));
    });

    it('setOpeningBalance(): rejects a zero amount (use DELETE instead)', async () => {
      await expect(
        service.setOpeningBalance('sup-1', { amount: '0', date: '2026-11-01' }, 'clerk-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.supplierOpeningBalance.upsert).not.toHaveBeenCalled();
    });

    it('setOpeningBalance(): 404 for an unknown supplier', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue(null);
      await expect(
        service.setOpeningBalance('missing', { amount: '10', date: '2026-11-01' }, 'clerk-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('clearOpeningBalance(): deletes only this supplier\'s row', async () => {
      await service.clearOpeningBalance('sup-1');
      expect(mockPrisma.supplierOpeningBalance.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 'sup-1' } });
    });
  });
});
