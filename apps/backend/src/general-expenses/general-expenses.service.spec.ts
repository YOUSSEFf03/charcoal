import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { GeneralExpensesService } from './general-expenses.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }

describe('GeneralExpensesService', () => {
  let service: GeneralExpensesService;

  const mockPrisma = {
    generalExpense: { findMany: fn(), count: fn(), findUnique: fn(), create: fn(), delete: fn() },
    user:           { findUnique: fn() },
    $transaction:   fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.$transaction.mockImplementation(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(mockPrisma);
    });
    mockPrisma.generalExpense.findMany.mockResolvedValue([]);
    mockPrisma.generalExpense.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeneralExpensesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<GeneralExpensesService>(GeneralExpensesService);
  });

  // ===========================================================================
  // findAll() — "Option B" recurrence semantics.
  // isRecurring=false → only its exact recorded month (unchanged, pre-existing).
  // isRecurring=true  → included from its recorded date forward, never before.
  // ===========================================================================
  describe('findAll() — Option B recurrence date-scoping', () => {
    it('1. no date filter: where clause is empty (all rows, no OR)', async () => {
      await service.findAll(1, 20);
      const where = mockPrisma.generalExpense.findMany.mock.calls[0][0].where;
      expect(where).toEqual({});
    });

    it('2. date filter given: one-time rows are bounded by [dateFrom, dateTo]', async () => {
      await service.findAll(1, 20, '2026-08-01', '2026-08-31');
      const where = mockPrisma.generalExpense.findMany.mock.calls[0][0].where;
      const oneTimeClause = where.OR.find((c: any) => c.isRecurring === false);
      expect(oneTimeClause.date).toEqual({
        gte: new Date('2026-08-01'),
        lte: new Date('2026-08-31'),
      });
    });

    it('3. date filter given: recurring rows get ONLY an upper bound (date <= dateTo), no lower bound', async () => {
      await service.findAll(1, 20, '2026-08-01', '2026-08-31');
      const where = mockPrisma.generalExpense.findMany.mock.calls[0][0].where;
      const recurringClause = where.OR.find((c: any) => c.isRecurring === true);
      expect(recurringClause.date).toEqual({ lte: new Date('2026-08-31') });
      expect(recurringClause.date.gte).toBeUndefined();
    });

    it('4. a recurring row dated August must be excluded from a July query (date <= July 31 fails for an August date)', async () => {
      await service.findAll(1, 20, '2026-07-01', '2026-07-31');
      const where = mockPrisma.generalExpense.findMany.mock.calls[0][0].where;
      const recurringClause = where.OR.find((c: any) => c.isRecurring === true);
      // The recorded date (Aug 1) is after the query's upper bound (Jul 31) —
      // Prisma's `lte: Jul 31` will not match an August row, which is exactly
      // the "never before its recorded date" requirement.
      expect(recurringClause.date.lte < new Date('2026-08-01')).toBe(true);
    });

    it('5. a recurring row dated August IS included in a September query (date <= Sep 30 passes for an August date)', async () => {
      await service.findAll(1, 20, '2026-09-01', '2026-09-30');
      const where = mockPrisma.generalExpense.findMany.mock.calls[0][0].where;
      const recurringClause = where.OR.find((c: any) => c.isRecurring === true);
      expect(recurringClause.date.lte >= new Date('2026-08-01')).toBe(true);
    });

    it('6. only dateFrom given (no dateTo): recurring clause has no date constraint at all', async () => {
      await service.findAll(1, 20, '2026-08-01', undefined);
      const where = mockPrisma.generalExpense.findMany.mock.calls[0][0].where;
      const recurringClause = where.OR.find((c: any) => c.isRecurring === true);
      expect(recurringClause.date).toBeUndefined();
    });
  });

  describe('findOne()', () => {
    it('throws NotFoundException when missing', async () => {
      mockPrisma.generalExpense.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('returns the row when found', async () => {
      const row = { id: 'ge-1', description: 'Rent', amount: '1000.00' };
      mockPrisma.generalExpense.findUnique.mockResolvedValue(row);
      await expect(service.findOne('ge-1')).resolves.toEqual(row);
    });
  });

  describe('create()', () => {
    it('throws UnauthorizedException when the clerk user is not synced', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ description: 'Rent', amount: '1000.00', isRecurring: true, date: '2026-08-01' } as any, 'clerk-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('creates with resolved addedById and defaults isRecurring to false when omitted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      mockPrisma.generalExpense.create.mockResolvedValue({ id: 'ge-1' });

      await service.create({ description: 'Repair', amount: '50.00' } as any, 'clerk-1');

      const data = mockPrisma.generalExpense.create.mock.calls[0][0].data;
      expect(data.addedById).toBe('user-1');
      expect(data.isRecurring).toBe(false);
    });
  });
});
