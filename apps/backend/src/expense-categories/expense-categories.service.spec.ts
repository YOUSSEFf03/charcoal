import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpenseCategoriesService } from './expense-categories.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

describe('ExpenseCategoriesService', () => {
  let service: ExpenseCategoriesService;

  const mockPrisma = {
    expenseCategory: { findMany: fn(), findFirst: fn(), create: fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseCategoriesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ExpenseCategoriesService>(ExpenseCategoriesService);
  });

  describe('findAll()', () => {
    it('lists categories alphabetically', async () => {
      mockPrisma.expenseCategory.findMany.mockResolvedValue([{ id: 'c1', name: 'Fuel' }]);
      const result = await service.findAll();
      expect(result).toEqual([{ id: 'c1', name: 'Fuel' }]);
      expect(mockPrisma.expenseCategory.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
    });
  });

  describe('findOrCreate() — CASE 9/CASE 10 (create new / reuse existing)', () => {
    it('CASE 9 — creates a brand-new category when no match exists', async () => {
      mockPrisma.expenseCategory.findFirst.mockResolvedValue(null);
      mockPrisma.expenseCategory.create.mockResolvedValue({ id: 'c-new', name: 'Vehicle Repair' });

      const result = await service.findOrCreate('Vehicle Repair');

      expect(result).toEqual({ id: 'c-new', name: 'Vehicle Repair' });
      expect(mockPrisma.expenseCategory.create).toHaveBeenCalledWith({ data: { name: 'Vehicle Repair' } });
    });

    it('CASE 10 — reuses the existing category (case-insensitive) instead of creating a duplicate', async () => {
      mockPrisma.expenseCategory.findFirst.mockResolvedValue({ id: 'c-fuel', name: 'Fuel' });

      const result = await service.findOrCreate('fuel');

      expect(result).toEqual({ id: 'c-fuel', name: 'Fuel' });
      expect(mockPrisma.expenseCategory.create).not.toHaveBeenCalled();
      expect(mockPrisma.expenseCategory.findFirst).toHaveBeenCalledWith({
        where: { name: { equals: 'fuel', mode: 'insensitive' } },
      });
    });

    it('never creates Fuel/fuel/FUEL as three separate rows across repeated calls', async () => {
      mockPrisma.expenseCategory.findFirst
        .mockResolvedValueOnce(null) // "Fuel" — first call, none exists yet
        .mockResolvedValueOnce({ id: 'c-fuel', name: 'Fuel' }) // "fuel" — now matches
        .mockResolvedValueOnce({ id: 'c-fuel', name: 'Fuel' }); // "FUEL" — still matches
      mockPrisma.expenseCategory.create.mockResolvedValue({ id: 'c-fuel', name: 'Fuel' });

      const a = await service.findOrCreate('Fuel');
      const b = await service.findOrCreate('fuel');
      const c = await service.findOrCreate('FUEL');

      expect(a.id).toBe('c-fuel');
      expect(b.id).toBe('c-fuel');
      expect(c.id).toBe('c-fuel');
      expect(mockPrisma.expenseCategory.create).toHaveBeenCalledTimes(1); // only the first call ever creates
    });

    it('trims whitespace before matching/creating', async () => {
      mockPrisma.expenseCategory.findFirst.mockResolvedValue(null);
      mockPrisma.expenseCategory.create.mockResolvedValue({ id: 'c1', name: 'Food' });

      await service.findOrCreate('  Food  ');

      expect(mockPrisma.expenseCategory.findFirst).toHaveBeenCalledWith({
        where: { name: { equals: 'Food', mode: 'insensitive' } },
      });
      expect(mockPrisma.expenseCategory.create).toHaveBeenCalledWith({ data: { name: 'Food' } });
    });

    it('rejects an empty/whitespace-only name', async () => {
      await expect(service.findOrCreate('   ')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.expenseCategory.findFirst).not.toHaveBeenCalled();
    });

    it('recovers from a concurrent-create race (P2002) by returning the winner, not throwing', async () => {
      mockPrisma.expenseCategory.findFirst
        .mockResolvedValueOnce(null) // no match before the race
        .mockResolvedValueOnce({ id: 'c-winner', name: 'Fuel' }); // the other request's row, found after P2002
      mockPrisma.expenseCategory.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' }),
      );

      const result = await service.findOrCreate('Fuel');

      expect(result).toEqual({ id: 'c-winner', name: 'Fuel' });
    });
  });
});
