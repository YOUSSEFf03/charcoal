import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FillJobsService } from './fill-jobs.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }

describe('FillJobsService', () => {
  let service: FillJobsService;

  const mockPrisma = {
    user: { findUnique: fn() },
    fillJob: { findUnique: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FillJobsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<FillJobsService>(FillJobsService);
  });

  function makeTx(overrides: Record<string, any> = {}) {
    return {
      stockLot: { findMany: fn(), update: fn(), ...overrides.stockLot },
      fillJob: { create: fn(), ...overrides.fillJob },
      fillJobLot: { createMany: fn(), ...overrides.fillJobLot },
      stockExit: { create: fn(), ...overrides.stockExit },
    };
  }

  function setupTransaction(tx: ReturnType<typeof makeTx>) {
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
  }

  const clientId  = '550e8400-e29b-41d4-a716-111111111111';
  const lotA      = '550e8400-e29b-41d4-a716-aaaaaaaaaaaa';
  const lotB      = '550e8400-e29b-41d4-a716-bbbbbbbbbbbb';
  const clerkId   = 'clerk-user-1';

  function baseTx() {
    const tx = makeTx();
    tx.stockLot.findMany.mockResolvedValue([
      { id: lotA, kgRemaining: { toString: () => '1000.000' }, costPerKg: { toString: () => '2.000' } },
      { id: lotB, kgRemaining: { toString: () => '1000.000' }, costPerKg: { toString: () => '3.000' } },
    ]);
    tx.stockLot.update.mockResolvedValue({});
    tx.fillJob.create.mockResolvedValue({ id: 'fill-1' });
    tx.fillJobLot.createMany.mockResolvedValue({ count: 2 });
    tx.stockExit.create.mockResolvedValue({ id: 'exit-1' });
    return tx;
  }

  it('creates exactly one client_bags_fill stock exit with kg = total charcoal consumed', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId });
    mockPrisma.fillJob.findUnique.mockResolvedValue({ id: 'fill-1' });
    const tx = baseTx();
    setupTransaction(tx);

    await service.create(
      {
        clientId,
        date: '2026-05-30',
        charcoalInputs: [{ lotId: lotA, kg: 600 }, { lotId: lotB, kg: 410 }],
        bagOutputs: [{ specKey: '10_A', size: 10, charcoal: 'A', qty: 100 }],
      },
      clerkId,
    );

    expect(tx.stockExit.create).toHaveBeenCalledTimes(1);
    const exitArg = tx.stockExit.create.mock.calls[0][0];
    expect(exitArg.data.exitType).toBe('client_bags_fill');
    expect(exitArg.data.kgQuantity).toBe('1010.000'); // 600 + 410
    expect(exitArg.data.loggedById).toBe('db-user-1');
    expect(exitArg.data.clientId).toBe(clientId);
  });

  it('per-lot deduction: lot A and lot B each decrement by their own input via atomic decrement', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId });
    mockPrisma.fillJob.findUnique.mockResolvedValue({ id: 'fill-1' });
    const tx = baseTx();
    setupTransaction(tx);

    await service.create(
      {
        clientId,
        date: '2026-05-30',
        charcoalInputs: [{ lotId: lotA, kg: 600 }, { lotId: lotB, kg: 410 }],
        bagOutputs: [{ specKey: '10_A', size: 10, charcoal: 'A', qty: 100 }],
      },
      clerkId,
    );

    const updates = tx.stockLot.update.mock.calls.map((c: any) => c[0]);
    expect(updates.find((u: any) => u.where.id === lotA).data.kgRemaining).toEqual({ decrement: '600.000' });
    expect(updates.find((u: any) => u.where.id === lotB).data.kgRemaining).toEqual({ decrement: '410.000' });
  });

  it('duplicate-lot: same lotId twice (300 + 200) decrements once by exactly 500 — no lost update', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId });
    mockPrisma.fillJob.findUnique.mockResolvedValue({ id: 'fill-1' });
    const tx = makeTx();
    tx.stockLot.findMany.mockResolvedValue([
      { id: lotA, kgRemaining: { toString: () => '1000.000' }, costPerKg: { toString: () => '2.000' } },
    ]);
    tx.stockLot.update.mockResolvedValue({});
    tx.fillJob.create.mockResolvedValue({ id: 'fill-1' });
    tx.fillJobLot.createMany.mockResolvedValue({ count: 1 });
    tx.stockExit.create.mockResolvedValue({ id: 'exit-1' });
    mockPrisma.fillJob.findUnique.mockResolvedValue({ id: 'fill-1' });
    setupTransaction(tx);

    await service.create(
      {
        clientId,
        date: '2026-05-30',
        charcoalInputs: [{ lotId: lotA, kg: 300 }, { lotId: lotA, kg: 200 }],
        bagOutputs: [{ specKey: '10_A', size: 10, charcoal: 'A', qty: 50 }],
      },
      clerkId,
    );

    const updates = tx.stockLot.update.mock.calls.map((c: any) => c[0]).filter((u: any) => u.where.id === lotA);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.kgRemaining).toEqual({ decrement: '500.000' });

    // Junction collapses to one row carrying the summed kg.
    const junction = tx.fillJobLot.createMany.mock.calls[0][0].data;
    expect(junction).toHaveLength(1);
    expect(junction[0].kgUsed).toBe('500.000');
  });

  it('throws CONSTRAINT_VIOLATION when aggregated kg exceeds lot kgRemaining', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-user-1', clerkId });
    const tx = makeTx();
    tx.stockLot.findMany.mockResolvedValue([
      { id: lotA, kgRemaining: { toString: () => '400.000' }, costPerKg: { toString: () => '2.000' } },
    ]);
    setupTransaction(tx);

    await expect(
      service.create(
        {
          clientId,
          date: '2026-05-30',
          charcoalInputs: [{ lotId: lotA, kg: 300 }, { lotId: lotA, kg: 200 }], // 500 > 400
          bagOutputs: [{ specKey: '10_A', size: 10, charcoal: 'A', qty: 40 }],
        },
        clerkId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NOT_FOUND when the caller has no DB user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.create(
        {
          clientId,
          date: '2026-05-30',
          charcoalInputs: [{ lotId: lotA, kg: 100 }],
          bagOutputs: [{ specKey: '10_A', size: 10, charcoal: 'A', qty: 10 }],
        },
        clerkId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
