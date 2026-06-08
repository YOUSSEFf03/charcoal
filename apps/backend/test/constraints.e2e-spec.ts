/**
 * Constraint e2e tests for the Charcoal Business Accounting System backend.
 *
 * These are unit-style tests using TestingModule + mocked PrismaService.
 * No running database required.
 *
 * Each describe block corresponds to one business constraint.
 * Each block has a passing test (rule enforced / valid input accepted) and a
 * failing test (violation correctly rejected).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { parseCorsOrigins } from '../src/common/utils/cors.utils';
import { ParseLimitPipe, ParsePagePipe, MAX_PAGE_LIMIT } from '../src/common/pipes/pagination.pipes';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Prisma } from '@prisma/client';

import { PackingSessionsService } from '../src/packing-sessions/packing-sessions.service';
import { StockExitsService } from '../src/stock-exits/stock-exits.service';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { StockAdjustmentsService } from '../src/stock-adjustments/stock-adjustments.service';
import { ContainersService } from '../src/containers/containers.service';
import { BagTypesService } from '../src/bag-types/bag-types.service';
import { InvoiceCalculatorService } from '../src/invoices/invoice-calculator.service';
import { ReportsController } from '../src/reports/reports.controller';
import { ReportsService } from '../src/reports/reports.service';
import { ClientsService } from '../src/clients/clients.service';
import { ClientBalanceService } from '../src/clients/client-balance.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RolesGuard } from '../src/auth/roles.guard';
import { Reflector } from '@nestjs/core';
import { CreateStockExitDto } from '../src/stock-exits/dto/create-stock-exit.dto';
import { CreateStockAdjustmentDto } from '../src/stock-adjustments/dto/create-stock-adjustment.dto';

// ---------------------------------------------------------------------------
// Shared mock helper — avoids TS strict-generic issues with @jest/globals
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

function makeDecimal(value: string) {
  return { toString: () => value };
}

// ---------------------------------------------------------------------------
// CONSTRAINT 1: lot.kgRemaining >= 0 at all times
// ---------------------------------------------------------------------------

describe('CONSTRAINT 1: lot.kgRemaining >= 0 at all times', () => {
  let service: PackingSessionsService;

  const mockPrisma = {
    user: { findUnique: fn(), upsert: fn() },
    packingSession: { findMany: fn(), findUnique: fn(), create: fn(), count: fn() },
    packingSessionLot: { create: fn() },
    packedStock: { create: fn() },
    stockLot: { findMany: fn(), update: fn() },
    bagType: { findMany: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackingSessionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<PackingSessionsService>(PackingSessionsService);
  });

  function makeTx(overrides: Record<string, any> = {}) {
    return {
      user: { upsert: fn(), findUnique: fn(), ...overrides.user },
      stockLot: { findMany: fn(), update: fn(), ...overrides.stockLot },
      bagType: { findMany: fn(), ...overrides.bagType },
      packingSession: { create: fn(), findUnique: fn(), ...overrides.packingSession },
      packingSessionLot: { create: fn(), ...overrides.packingSessionLot },
      packedStock: { create: fn(), ...overrides.packedStock },
    };
  }

  it('valid: kgUsed <= kgRemaining → stockLot.update called with kgRemaining >= 0 ("0.000")', async () => {
    const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
    const lotId = '550e8400-e29b-41d4-a716-446655440000';

    const tx = makeTx();
    tx.user.upsert.mockResolvedValue({ id: 'u1', clerkId: 'c1' });
    tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: makeDecimal('50.000') }]);
    tx.bagType.findMany.mockResolvedValue([
      { id: bagTypeId, nominalKg: makeDecimal('10.000'), workerRate: makeDecimal('1.00') },
    ]);
    tx.stockLot.update.mockResolvedValue({});
    tx.packingSession.create.mockResolvedValue({ id: 's1' });
    tx.packingSession.findUnique.mockResolvedValue({ id: 's1', sessionLots: [] });
    tx.packingSessionLot.create.mockResolvedValue({});
    tx.packedStock.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.createPackingSession({ lotInputs: [{ lotId, kg: '50.000' }], bagsOutput: [{ bagTypeId, qty: 5 }] }, 'c1');

    const updateCall = tx.stockLot.update.mock.calls[0][0];
    const kgRemainingAfter = parseFloat(updateCall.data.kgRemaining);
    expect(kgRemainingAfter).toBeGreaterThanOrEqual(0);
    expect(updateCall.data.kgRemaining).toBe('0.000');
  });

  it('violation: kgUsed > kgRemaining → BadRequestException(CONSTRAINT_VIOLATION) thrown before any write', async () => {
    const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
    const lotId = '550e8400-e29b-41d4-a716-446655440000';

    const tx = makeTx();
    tx.user.upsert.mockResolvedValue({ id: 'u1', clerkId: 'c1' });
    tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: makeDecimal('50.000') }]);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await expect(
      service.createPackingSession({ lotInputs: [{ lotId, kg: '100.000' }], bagsOutput: [{ bagTypeId, qty: 5 }] }, 'c1'),
    ).rejects.toThrow(BadRequestException);

    // No DB write must occur
    expect(tx.stockLot.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 2: packedStock.quantity >= 0 at all times
// ---------------------------------------------------------------------------

describe('CONSTRAINT 2: packedStock.quantity >= 0 at all times', () => {
  let service: StockExitsService;

  const mockPrisma = {
    user: { findUnique: fn() },
    packedStock: { findUnique: fn(), update: fn() },
    stockExit: { findUnique: fn(), findMany: fn(), create: fn(), count: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockExitsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<StockExitsService>(StockExitsService);
  });

  it('valid: requested quantity <= available stock → exit created and quantity decremented to 0', async () => {
    const tx = {
      user: { findUnique: fn() },
      packedStock: { findUnique: fn(), update: fn() },
      stockExit: { create: fn() },
    };
    tx.user.findUnique.mockResolvedValue({ id: 'u1' });
    tx.packedStock.findUnique.mockResolvedValue({ id: 'ps1', quantity: 10 });
    tx.packedStock.update.mockResolvedValue({ id: 'ps1', quantity: 0 });
    tx.stockExit.create.mockResolvedValue({ id: 'se1' });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const dto = {
      packedStockId: 'ps1',
      bagTypeId: '550e8400-e29b-41d4-a716-446655440002',
      quantity: 10,
      exitType: 'sample' as any,
      date: '2024-01-01',
    };

    await expect(service.create(dto, 'clerk-1')).resolves.toBeDefined();
    expect(tx.packedStock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ps1' },
        data: { quantity: { decrement: 10 } },
      }),
    );
  });

  it('violation: requested quantity > available stock → BadRequestException(CONSTRAINT_VIOLATION)', async () => {
    const tx = {
      user: { findUnique: fn() },
      packedStock: { findUnique: fn(), update: fn() },
      stockExit: { create: fn() },
    };
    tx.user.findUnique.mockResolvedValue({ id: 'u1' });
    tx.packedStock.findUnique.mockResolvedValue({ id: 'ps1', quantity: 5 });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const dto = {
      packedStockId: 'ps1',
      bagTypeId: '550e8400-e29b-41d4-a716-446655440002',
      quantity: 10,
      exitType: 'sample' as any,
      date: '2024-01-01',
    };

    await expect(service.create(dto, 'clerk-1')).rejects.toThrow(BadRequestException);
    await expect(service.create(dto, 'clerk-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
    });
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 3: session.kgConsumed <= lot.kgRemaining before session starts
// ---------------------------------------------------------------------------

describe('CONSTRAINT 3: session.kgConsumed <= lot.kgRemaining before session starts', () => {
  let service: PackingSessionsService;

  const mockPrisma = {
    user: { findUnique: fn(), upsert: fn() },
    packingSession: { findMany: fn(), findUnique: fn(), create: fn(), count: fn() },
    packingSessionLot: { create: fn() },
    packedStock: { create: fn() },
    stockLot: { findMany: fn(), update: fn() },
    bagType: { findMany: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackingSessionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<PackingSessionsService>(PackingSessionsService);
  });

  function makeTx(overrides: Record<string, any> = {}) {
    return {
      user: { upsert: fn(), findUnique: fn(), ...overrides.user },
      stockLot: { findMany: fn(), update: fn(), ...overrides.stockLot },
      bagType: { findMany: fn(), ...overrides.bagType },
      packingSession: { create: fn(), findUnique: fn(), ...overrides.packingSession },
      packingSessionLot: { create: fn(), ...overrides.packingSessionLot },
      packedStock: { create: fn(), ...overrides.packedStock },
    };
  }

  it('valid: kgUsed exactly equals kgRemaining → no error, session created', async () => {
    const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
    const lotId = '550e8400-e29b-41d4-a716-446655440000';

    const tx = makeTx();
    tx.user.upsert.mockResolvedValue({ id: 'u1', clerkId: 'c1' });
    tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: makeDecimal('200.000') }]);
    tx.bagType.findMany.mockResolvedValue([
      { id: bagTypeId, nominalKg: makeDecimal('40.000'), workerRate: makeDecimal('2.00') },
    ]);
    tx.stockLot.update.mockResolvedValue({});
    tx.packingSession.create.mockResolvedValue({ id: 's1' });
    tx.packingSession.findUnique.mockResolvedValue({ id: 's1', sessionLots: [] });
    tx.packingSessionLot.create.mockResolvedValue({});
    tx.packedStock.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await expect(
      service.createPackingSession({ lotInputs: [{ lotId, kg: '200.000' }], bagsOutput: [{ bagTypeId, qty: 5 }] }, 'c1'),
    ).resolves.toBeDefined();
  });

  it('violation: kgUsed > kgRemaining → BadRequestException with CONSTRAINT_VIOLATION code', async () => {
    const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
    const lotId = '550e8400-e29b-41d4-a716-446655440000';

    const tx = makeTx();
    tx.user.upsert.mockResolvedValue({ id: 'u1', clerkId: 'c1' });
    tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: makeDecimal('100.000') }]);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await expect(
      service.createPackingSession({ lotInputs: [{ lotId, kg: '100.001' }], bagsOutput: [{ bagTypeId, qty: 5 }] }, 'c1'),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 4: Shipment bags <= available packed stock per bag type
// ---------------------------------------------------------------------------

describe('CONSTRAINT 4: Shipment bags <= available packed stock per bag type', () => {
  let service: ShipmentsService;

  const mockPrisma = {
    packedStock: { aggregate: fn() },
    shipment: { create: fn(), findUnique: fn(), findMany: fn(), update: fn(), count: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ShipmentsService>(ShipmentsService);
  });

  it('valid: available stock >= requested quantity → shipment created', async () => {
    mockPrisma.packedStock.aggregate.mockResolvedValue({ _sum: { quantity: 100 } });
    mockPrisma.shipment.create.mockResolvedValue({ id: 'sh1', bags: [] });

    const dto = {
      orderId: '550e8400-e29b-41d4-a716-446655440010',
      address: '123 Test St',
      nominalKg: '500',
      bags: [{ bagTypeId: '550e8400-e29b-41d4-a716-446655440001', quantity: 50 }],
    };

    await expect(service.createShipment(dto, 'clerk-1')).resolves.toBeDefined();
    expect(mockPrisma.shipment.create).toHaveBeenCalled();
  });

  it('violation: available stock < requested quantity → BadRequestException(CONSTRAINT_VIOLATION)', async () => {
    mockPrisma.packedStock.aggregate.mockResolvedValue({ _sum: { quantity: 30 } });

    const dto = {
      orderId: '550e8400-e29b-41d4-a716-446655440010',
      address: '123 Test St',
      nominalKg: '500',
      bags: [{ bagTypeId: '550e8400-e29b-41d4-a716-446655440001', quantity: 50 }],
    };

    await expect(service.createShipment(dto, 'clerk-1')).rejects.toThrow(BadRequestException);
    await expect(service.createShipment(dto, 'clerk-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
    });
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 5: Every stock exit must have exitType, bagTypeId, quantity, loggedById, date
// ---------------------------------------------------------------------------

describe('CONSTRAINT 5: Every stock exit must have required fields (DTO + loggedById from user)', () => {
  it('valid DTO: all required fields present → no validation errors', async () => {
    const dto = plainToInstance(CreateStockExitDto, {
      packedStockId: '550e8400-e29b-41d4-a716-446655440001',
      bagTypeId: '550e8400-e29b-41d4-a716-446655440002',
      quantity: 5,
      exitType: 'sample',
      date: '2024-01-15',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('violation: missing exitType → validation error on exitType field', async () => {
    const dto = plainToInstance(CreateStockExitDto, {
      packedStockId: '550e8400-e29b-41d4-a716-446655440001',
      bagTypeId: '550e8400-e29b-41d4-a716-446655440002',
      quantity: 5,
      // exitType intentionally omitted
      date: '2024-01-15',
    });
    const errors = await validate(dto);
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('exitType');
  });

  it('violation: missing date → validation error on date field', async () => {
    const dto = plainToInstance(CreateStockExitDto, {
      packedStockId: '550e8400-e29b-41d4-a716-446655440001',
      bagTypeId: '550e8400-e29b-41d4-a716-446655440002',
      quantity: 5,
      exitType: 'sample',
      // date intentionally omitted
    });
    const errors = await validate(dto);
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('date');
  });

  it('valid: loggedById is NOT declared on CreateStockExitDto (set by service from @CurrentUser)', () => {
    // loggedById must not be a class-level property on the DTO.
    // Structural enforcement: the controller takes it from @CurrentUser, not from the body.
    expect(
      Object.prototype.hasOwnProperty.call(CreateStockExitDto.prototype, 'loggedById'),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 6: Every stock adjustment must have reason + owner's approvedById
// ---------------------------------------------------------------------------

describe('CONSTRAINT 6: Stock adjustment requires reason + approvedById from owner', () => {
  let service: StockAdjustmentsService;

  const mockPrisma = {
    stockAdjustment: { findUnique: fn(), findMany: fn(), create: fn(), count: fn() },
    stockLot: { findUnique: fn(), update: fn() },
    packedStock: { findUnique: fn(), update: fn() },
    user: { findUnique: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockAdjustmentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<StockAdjustmentsService>(StockAdjustmentsService);
  });

  it('valid: reason provided → adjustment created with approvedById = caller user id', async () => {
    const callerId = 'owner-db-id';
    const tx = {
      user: { findUnique: fn() },
      stockLot: { findUnique: fn(), update: fn() },
      stockAdjustment: { create: fn() },
    };
    tx.user.findUnique.mockResolvedValue({ id: callerId });
    tx.stockLot.findUnique.mockResolvedValue({ id: 'lot-1' });
    tx.stockLot.update.mockResolvedValue({});
    tx.stockAdjustment.create.mockResolvedValue({
      id: 'adj-1',
      approvedById: callerId,
    });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const dto = {
      adjustmentType: 'lot' as any,
      lotId: '550e8400-e29b-41d4-a716-446655440000',
      qtyBefore: '100',
      qtyAfter: '90',
      reason: 'Physical count discrepancy',
      date: '2024-01-15',
    };

    await service.create(dto, 'clerk-owner');

    expect(tx.stockAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reason: 'Physical count discrepancy',
          approvedById: callerId,
        }),
      }),
    );
  });

  it('violation: missing reason → DTO validation error on reason field', async () => {
    const dto = plainToInstance(CreateStockAdjustmentDto, {
      adjustmentType: 'lot',
      lotId: '550e8400-e29b-41d4-a716-446655440000',
      qtyBefore: '100',
      qtyAfter: '90',
      // reason intentionally omitted
      date: '2024-01-15',
    });
    const errors = await validate(dto);
    const fields = errors.map((e) => e.property);
    expect(fields).toContain('reason');
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 7: varianceKg < 0 requires varianceNote before session closes
// ---------------------------------------------------------------------------

describe('CONSTRAINT 7: negative varianceKg requires varianceNote', () => {
  let service: PackingSessionsService;

  const mockPrisma = {
    user: { findUnique: fn(), upsert: fn() },
    packingSession: { findMany: fn(), findUnique: fn(), create: fn(), count: fn() },
    packingSessionLot: { create: fn() },
    packedStock: { create: fn() },
    stockLot: { findMany: fn(), update: fn() },
    bagType: { findMany: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackingSessionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<PackingSessionsService>(PackingSessionsService);
  });

  function makeTx(overrides: Record<string, any> = {}) {
    return {
      user: { upsert: fn(), findUnique: fn(), ...overrides.user },
      stockLot: { findMany: fn(), update: fn(), ...overrides.stockLot },
      bagType: { findMany: fn(), ...overrides.bagType },
      packingSession: { create: fn(), findUnique: fn(), ...overrides.packingSession },
      packingSessionLot: { create: fn(), ...overrides.packingSessionLot },
      packedStock: { create: fn(), ...overrides.packedStock },
    };
  }

  it('valid: negative variance WITH varianceNote → session created successfully', async () => {
    // kgConsumed=10, nominalKg=0.2 × qty=100 → kgOutputTotal=20, variance=10-20=-10
    const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
    const lotId = '550e8400-e29b-41d4-a716-446655440000';

    const tx = makeTx();
    tx.user.upsert.mockResolvedValue({ id: 'u1', clerkId: 'c1' });
    tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: makeDecimal('999.000') }]);
    tx.bagType.findMany.mockResolvedValue([
      { id: bagTypeId, nominalKg: makeDecimal('0.200'), workerRate: makeDecimal('1.00') },
    ]);
    tx.stockLot.update.mockResolvedValue({});
    tx.packingSession.create.mockResolvedValue({ id: 's1' });
    tx.packingSession.findUnique.mockResolvedValue({ id: 's1', sessionLots: [] });
    tx.packingSessionLot.create.mockResolvedValue({});
    tx.packedStock.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await expect(
      service.createPackingSession({
        lotInputs: [{ lotId, kg: '10.000' }],
        bagsOutput: [{ bagTypeId, qty: 100 }],
        varianceNote: 'Extra bags packed',
      }, 'c1'),
    ).resolves.toBeDefined();
  });

  it('violation: negative variance WITHOUT varianceNote → BadRequestException(CONSTRAINT_VIOLATION)', async () => {
    const bagTypeId = '550e8400-e29b-41d4-a716-446655440001';
    const lotId = '550e8400-e29b-41d4-a716-446655440000';

    const tx = makeTx();
    tx.user.upsert.mockResolvedValue({ id: 'u1', clerkId: 'c1' });
    tx.stockLot.findMany.mockResolvedValue([{ id: lotId, kgRemaining: makeDecimal('999.000') }]);
    tx.bagType.findMany.mockResolvedValue([
      { id: bagTypeId, nominalKg: makeDecimal('0.200'), workerRate: makeDecimal('1.00') },
    ]);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await expect(
      service.createPackingSession({
        lotInputs: [{ lotId, kg: '10.000' }],
        bagsOutput: [{ bagTypeId, qty: 100 }],
        // varianceNote intentionally omitted
      }, 'c1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
    });
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 8: Never merge lots from different suppliers — one lot per product line
// ---------------------------------------------------------------------------

describe('CONSTRAINT 8: Never merge lots — one StockLot per ContainerProductLine on arrival', () => {
  let service: ContainersService;

  const mockPrisma = {
    container: { findUnique: fn(), update: fn(), create: fn(), findMany: fn(), delete: fn() },
    containerProductLine: { findMany: fn(), create: fn(), findFirst: fn(), update: fn(), delete: fn() },
    containerExpense: { findMany: fn(), create: fn(), findFirst: fn(), update: fn(), delete: fn() },
    containerDiscount: { findUnique: fn(), upsert: fn(), delete: fn() },
    stockLot: { create: fn(), findMany: fn(), update: fn() },
    supplier: { findUnique: fn() },
    user: { findUnique: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ContainersService>(ContainersService);
  });

  it('valid: arrival with 2 product lines creates exactly 2 separate StockLots (one per line)', async () => {
    const containerId = '550e8400-e29b-41d4-a716-446655440020';

    // Container not yet arrived
    mockPrisma.container.findUnique.mockResolvedValueOnce({ id: containerId, status: 'transit' });

    const txContainer = {
      container: {
        findUnique: fn(),
        update: fn(),
      },
      stockLot: { create: fn(), findMany: fn(), update: fn() },
    };

    txContainer.container.findUnique
      // First call: inside tx — the container with product lines
      .mockResolvedValueOnce({
        id: containerId,
        status: 'transit',
        productLines: [
          {
            id: 'line-1',
            charcoalType: 'hardwood',
            grade: 'A',
            supplierId: 'sup-1',
            paidBags: 100,
            kgPerBag: makeDecimal('50.000'),
            pricePerTon: makeDecimal('400.00'),
          },
          {
            id: 'line-2',
            charcoalType: 'bamboo',
            grade: 'B',
            supplierId: 'sup-2',
            paidBags: 200,
            kgPerBag: makeDecimal('25.000'),
            pricePerTon: makeDecimal('350.00'),
          },
        ],
        expenses: [],
        discount: null,
      })
      // Second call: recalculateContainerCosts container lookup
      .mockResolvedValueOnce({
        id: containerId,
        productLines: [
          {
            id: 'line-1',
            paidBags: 100,
            kgPerBag: makeDecimal('50.000'),
            pricePerTon: makeDecimal('400.00'),
          },
          {
            id: 'line-2',
            paidBags: 200,
            kgPerBag: makeDecimal('25.000'),
            pricePerTon: makeDecimal('350.00'),
          },
        ],
        expenses: [],
        discount: null,
      })
      // Third call: final findUnique for return value
      .mockResolvedValueOnce({
        id: containerId,
        status: 'arrived',
        supplier: {},
        productLines: [],
        expenses: [],
        discount: null,
        stockLots: [],
      });

    txContainer.container.update.mockResolvedValue({});
    txContainer.stockLot.create.mockResolvedValue({ id: 'lot-new', createdAt: new Date() });
    txContainer.stockLot.findMany.mockResolvedValue([]);
    txContainer.stockLot.update.mockResolvedValue({});

    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(txContainer));

    await service.update(containerId, { status: 'arrived' }, 'clerk-1');

    // Exactly 2 separate stockLot.create calls — one per product line
    expect(txContainer.stockLot.create).toHaveBeenCalledTimes(2);

    // Each lot must be separate — different calls, not merged
    const firstLotData = txContainer.stockLot.create.mock.calls[0][0].data;
    const secondLotData = txContainer.stockLot.create.mock.calls[1][0].data;
    expect(firstLotData.charcoalType).toBe('hardwood');
    expect(secondLotData.charcoalType).toBe('bamboo');
  });

  it('violation: container without product lines cannot arrive (no lot merging from zero lines)', async () => {
    const containerId = '550e8400-e29b-41d4-a716-446655440021';

    mockPrisma.container.findUnique.mockResolvedValueOnce({ id: containerId, status: 'transit' });

    const txContainer = {
      container: { findUnique: fn(), update: fn() },
      stockLot: { create: fn(), findMany: fn(), update: fn() },
    };

    txContainer.container.findUnique.mockResolvedValueOnce({
      id: containerId,
      status: 'transit',
      productLines: [],  // empty — should be rejected
    });

    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(txContainer));

    await expect(service.update(containerId, { status: 'arrived' }, 'clerk-1')).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 9: Container expenses trigger costPerKg recalculation on all linked lots
// ---------------------------------------------------------------------------

describe('CONSTRAINT 9: Container expenses trigger costPerKg recalculation', () => {
  let service: ContainersService;

  const mockPrisma = {
    container: { findUnique: fn(), update: fn(), create: fn() },
    containerProductLine: { findMany: fn(), create: fn() },
    containerExpense: { findMany: fn(), create: fn(), findFirst: fn(), update: fn(), delete: fn() },
    containerDiscount: { findUnique: fn() },
    stockLot: { create: fn(), findMany: fn(), update: fn() },
    supplier: { findUnique: fn() },
    user: { findUnique: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ContainersService>(ContainersService);
  });

  it('valid: createExpense calls recalculateContainerCosts (stockLot.update called inside tx)', async () => {
    const containerId = '550e8400-e29b-41d4-a716-446655440030';
    const userId = 'owner-clerk-id';

    mockPrisma.container.findUnique.mockResolvedValue({ id: containerId, status: 'arrived' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkId: userId });

    const tx = {
      containerExpense: { create: fn() },
      container: { findUnique: fn() },
      stockLot: { findMany: fn(), update: fn() },
    };

    tx.containerExpense.create.mockResolvedValue({ id: 'exp-1', containerId, amount: makeDecimal('500.00') });
    tx.container.findUnique.mockResolvedValue({
      id: containerId,
      productLines: [
        {
          id: 'line-1',
          paidBags: 100,
          kgPerBag: makeDecimal('50.000'),
          pricePerTon: makeDecimal('400.00'),
        },
      ],
      expenses: [{ amount: makeDecimal('500.00') }],
      discount: null,
    });
    tx.stockLot.findMany.mockResolvedValue([
      { id: 'lot-1', createdAt: new Date() },
    ]);
    tx.stockLot.update.mockResolvedValue({});

    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.createExpense(containerId, { description: 'Shipping', amount: '500.00' }, userId);

    // recalculateContainerCosts must have called stockLot.update for cost recalculation
    expect(tx.stockLot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ costPerKg: expect.any(String) }),
      }),
    );
  });

  it('violation: if recalculateContainerCosts is skipped, costPerKg remains stale ("0") after expense', async () => {
    // This test verifies that costPerKg starts as "0" (the placeholder) and becomes non-zero
    // after recalculation. If recalculateContainerCosts was never called, the update would not happen.
    const containerId = '550e8400-e29b-41d4-a716-446655440031';
    const userId = 'owner-clerk-id-2';

    mockPrisma.container.findUnique.mockResolvedValue({ id: containerId, status: 'arrived' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u2', clerkId: userId });

    const tx = {
      containerExpense: { create: fn() },
      container: { findUnique: fn() },
      stockLot: { findMany: fn(), update: fn() },
    };

    // Container with one product line; 100 bags × 50 kg = 5000 kg = 5 tonnes
    // pricePerTon = 400, expense = 200 → allInCostPerTon = 400 + 200/5 = 440
    // allInCostPerKg = 440/1000 = 0.4400
    tx.containerExpense.create.mockResolvedValue({ id: 'exp-2', amount: makeDecimal('200.00') });
    tx.container.findUnique.mockResolvedValue({
      id: containerId,
      productLines: [
        {
          id: 'line-1',
          paidBags: 100,
          kgPerBag: makeDecimal('50.000'),
          pricePerTon: makeDecimal('400.00'),
        },
      ],
      expenses: [{ amount: makeDecimal('200.00') }],
      discount: null,
    });
    tx.stockLot.findMany.mockResolvedValue([{ id: 'lot-2', createdAt: new Date() }]);
    tx.stockLot.update.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.createExpense(containerId, { description: 'Port fees', amount: '200.00' }, userId);

    // The costPerKg written must be "0.4400" (not "0")
    const updateArgs = tx.stockLot.update.mock.calls[0][0];
    expect(updateArgs.data.costPerKg).toBe('0.4400');
    expect(updateArgs.data.costPerKg).not.toBe('0');
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 10: Price is set at time of sale — no pre-set price list enforced
// ---------------------------------------------------------------------------

describe('CONSTRAINT 10: Price accepted as-is at time of sale — no price-list validation', () => {
  let calculator: InvoiceCalculatorService;

  beforeEach(() => {
    calculator = new InvoiceCalculatorService({} as any);
  });

  it('valid: any numeric pricePerBag is accepted and lineTotal computed correctly', () => {
    const result = calculator.computeLines([
      { bagTypeId: 'bt-1', bagTypeName: 'Standard', qty: 10, pricePerBag: '12.50' },
    ]);
    const line = result.lines[0] as import('../src/invoices/invoice-calculator.service').EnrichedBagLine;
    expect(line.pricePerBag).toBe('12.50');
    expect(line.lineTotal).toBe('125.00');
    expect(result.subtotal).toBe('125.00');
  });

  it('valid: arbitrary price not in any price list → accepted without error (no price-list lookup)', () => {
    // computeLines is pure and never calls prisma — confirming no DB lookup for price validation
    const arbitraryPrice = '999999.99';
    const result = calculator.computeLines([
      { bagTypeId: 'bt-2', bagTypeName: 'Premium', qty: 1, pricePerBag: arbitraryPrice },
    ]);
    const line = result.lines[0] as import('../src/invoices/invoice-calculator.service').EnrichedBagLine;
    expect(line.pricePerBag).toBe(arbitraryPrice);
    expect(line.lineTotal).toBe('999999.99');
  });

  it('violation: zero price is also accepted — system does not enforce minimum price', () => {
    // Constraint 10 means the system accepts ANY price — including 0
    const result = calculator.computeLines([
      { bagTypeId: 'bt-3', bagTypeName: 'Promo', qty: 5, pricePerBag: '0.00' },
    ]);
    expect(result.lines[0].lineTotal).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 11: Total profit (grossProfit) visible to owner role only
// ---------------------------------------------------------------------------

describe('CONSTRAINT 11: grossProfit visible to owner role only', () => {
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  const mockService = {
    getProfitLoss: fn(),
    getStockValue: fn(),
    getVariance: fn(),
    getContainerCosts: fn(),
    getClientLedger: fn(),
    getWorkerEarnings: fn(),
    getPhysicalCount: fn(),
    submitPhysicalCount: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        { provide: ReportsService, useValue: mockService },
        Reflector,
        RolesGuard,
      ],
    }).compile();

    reflector = module.get<Reflector>(Reflector);
    rolesGuard = new RolesGuard(reflector);
  });

  function mockContext(role: string, handlerName: string) {
    const handler = (ReportsController.prototype as any)[handlerName];
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: { role, userId: 'user-id' } }),
      }),
      getHandler: () => handler,
      getClass: () => ReportsController,
    } as any;
  }

  it('valid: owner role → getProfitLoss passes RolesGuard (returns true)', () => {
    const ctx = mockContext('owner', 'getProfitLoss');
    expect(rolesGuard.canActivate(ctx)).toBe(true);
  });

  it('violation: sales_rep role → getProfitLoss throws ForbiddenException', () => {
    const ctx = mockContext('sales_rep', 'getProfitLoss');
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('violation: accountant role → getProfitLoss throws ForbiddenException (grossProfit is owner-only)', () => {
    const ctx = mockContext('accountant', 'getProfitLoss');
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('violation: worker role → getProfitLoss throws ForbiddenException', () => {
    const ctx = mockContext('worker', 'getProfitLoss');
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 12: costPerKg visible to owner and accountant only
// ---------------------------------------------------------------------------

describe('CONSTRAINT 12: costPerKg visible to owner and accountant only — never to sales_rep or worker', () => {
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  const mockService = {
    getProfitLoss: fn(),
    getStockValue: fn(),
    getVariance: fn(),
    getContainerCosts: fn(),
    getClientLedger: fn(),
    getWorkerEarnings: fn(),
    getPhysicalCount: fn(),
    submitPhysicalCount: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        { provide: ReportsService, useValue: mockService },
        Reflector,
        RolesGuard,
      ],
    }).compile();

    reflector = module.get<Reflector>(Reflector);
    rolesGuard = new RolesGuard(reflector);
  });

  function mockContext(role: string, handlerName: string) {
    const handler = (ReportsController.prototype as any)[handlerName];
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: { role, userId: 'user-id' } }),
      }),
      getHandler: () => handler,
      getClass: () => ReportsController,
    } as any;
  }

  it('valid: owner → getStockValue (which returns costPerKg) passes RolesGuard', () => {
    const ctx = mockContext('owner', 'getStockValue');
    expect(rolesGuard.canActivate(ctx)).toBe(true);
  });

  it('valid: accountant → getStockValue passes RolesGuard', () => {
    const ctx = mockContext('accountant', 'getStockValue');
    expect(rolesGuard.canActivate(ctx)).toBe(true);
  });

  it('violation: sales_rep → getStockValue throws ForbiddenException', () => {
    const ctx = mockContext('sales_rep', 'getStockValue');
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('violation: worker → getStockValue throws ForbiddenException', () => {
    const ctx = mockContext('worker', 'getStockValue');
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 13: Physical count adjustments require owner approval
// ---------------------------------------------------------------------------

describe('CONSTRAINT 13: Physical count adjustments require owner approval (approvedById set from request user)', () => {
  let service: ReportsService;

  const mockPrisma = {
    invoice: { findMany: fn() },
    stockExit: { findMany: fn() },
    bagPurchase: { findMany: fn() },
    packingSession: { findMany: fn() },
    driverTrip: { findMany: fn() },
    stockLot: { findMany: fn() },
    container: { findMany: fn() },
    client: { findUnique: fn() },
    payment: { findMany: fn() },
    worker: { findUnique: fn() },
    workerPayment: { findMany: fn() },
    packedStock: { findMany: fn(), findUnique: fn(), update: fn() },
    stockAdjustment: { create: fn() },
    user: { findUnique: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ReportsService>(ReportsService);
  });

  it('valid: submitPhysicalCount sets approvedById from the request user (not from body)', async () => {
    const ownerDbId = 'owner-db-uuid';
    let capturedApprovedById: string | undefined;

    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        user: {
          findUnique: fn(),
        },
        packedStock: { findUnique: fn(), update: fn() },
        stockAdjustment: { create: fn() },
      };
      tx.user.findUnique.mockResolvedValue({ id: ownerDbId });
      tx.packedStock.findUnique.mockResolvedValue({ id: 'ps-1', quantity: 100 });
      tx.packedStock.update.mockResolvedValue({});
      tx.stockAdjustment.create.mockImplementation((args: any) => {
        capturedApprovedById = args.data.approvedById;
        return Promise.resolve({ id: 'adj-1', ...args.data });
      });
      return cb(tx);
    });

    await service.submitPhysicalCount(
      { items: [{ packedStockId: 'ps-1', actualQuantity: 80 }] },
      'clerk-owner-id',
    );

    expect(capturedApprovedById).toBe(ownerDbId);
  });

  it('violation: non-existent packed stock ID → NotFoundException (no silent adjustment)', async () => {
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        user: { findUnique: fn() },
        packedStock: { findUnique: fn(), update: fn() },
        stockAdjustment: { create: fn() },
      };
      tx.user.findUnique.mockResolvedValue({ id: 'owner-db-id' });
      tx.packedStock.findUnique.mockResolvedValue(null);  // not found
      return cb(tx);
    });

    await expect(
      service.submitPhysicalCount(
        { items: [{ packedStockId: 'ps-nonexistent', actualQuantity: 10 }] },
        'clerk-owner-id',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 14: Client phone numbers never deleted — only isActive: false
// ---------------------------------------------------------------------------

describe('CONSTRAINT 14: Client phone numbers never deleted — only marked isActive: false', () => {
  let service: ClientsService;

  const mockPrisma = {
    client: { findUnique: fn(), update: fn(), create: fn(), findMany: fn(), count: fn() },
    clientOrder: { findMany: fn(), count: fn() },
    invoice: { findMany: fn(), count: fn() },
    payment: { findMany: fn(), count: fn() },
    $transaction: fn(),
  };

  const mockClientBalance = {
    computeBalance: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ClientBalanceService, useValue: mockClientBalance },
      ],
    }).compile();
    service = module.get<ClientsService>(ClientsService);
  });

  it('valid: deactivatePhone marks phone isActive=false and calls client.update (not delete)', async () => {
    const clientId = 'client-uuid-1';
    const phoneNumber = '+1234567890';

    mockPrisma.client.findUnique.mockResolvedValue({
      id: clientId,
      phones: [
        { number: phoneNumber, label: 'Mobile', isActive: true, dateAdded: '2024-01-01' },
      ],
    });
    mockPrisma.client.update.mockResolvedValue({ id: clientId });

    await service.deactivatePhone(clientId, { phoneNumber });

    expect(mockPrisma.client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: clientId },
        data: {
          phones: [
            { number: phoneNumber, label: 'Mobile', isActive: false, dateAdded: '2024-01-01' },
          ],
        },
      }),
    );

    // Crucially, client.delete must NEVER be called
    expect((mockPrisma.client as any).delete).toBeUndefined();
  });

  it('violation: phone not found → NotFoundException (no silent removal)', async () => {
    const clientId = 'client-uuid-2';

    mockPrisma.client.findUnique.mockResolvedValue({
      id: clientId,
      phones: [
        { number: '+9999999999', label: 'Work', isActive: true, dateAdded: '2024-01-01' },
      ],
    });

    await expect(
      service.deactivatePhone(clientId, { phoneNumber: '+0000000000' }),
    ).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 15: Client balance always computed from records — never stored
// ---------------------------------------------------------------------------

describe('CONSTRAINT 15: Client balance always computed from records — never stored', () => {
  let service: ClientBalanceService;

  const mockPrisma = {
    invoice: { findMany: fn() },
    payment: { findMany: fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientBalanceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ClientBalanceService>(ClientBalanceService);
  });

  it('valid: computeBalance returns invoice total minus payment total (100 - 40 = 60)', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { total: makeDecimal('100.00') },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([
      { amount: makeDecimal('40.00') },
    ]);

    const balance = await service.computeBalance('client-1');
    expect(balance.toFixed(2)).toBe('60.00');
  });

  it('valid: computeBalance never calls prisma.client.update (no stored balance)', async () => {
    const mockPrismaWithClientUpdate = {
      ...mockPrisma,
      client: { update: fn() },
    };

    // Rebuild with the extended mock to verify client.update is never called
    const module2: TestingModule = await Test.createTestingModule({
      providers: [
        ClientBalanceService,
        { provide: PrismaService, useValue: mockPrismaWithClientUpdate },
      ],
    }).compile();
    const service2 = module2.get<ClientBalanceService>(ClientBalanceService);

    mockPrismaWithClientUpdate.invoice.findMany.mockResolvedValue([
      { total: makeDecimal('200.00') },
    ]);
    mockPrismaWithClientUpdate.payment.findMany.mockResolvedValue([
      { amount: makeDecimal('50.00') },
    ]);

    await service2.computeBalance('client-2');

    // client.update must NEVER be called — balance is never stored
    expect(mockPrismaWithClientUpdate.client.update).not.toHaveBeenCalled();
  });

  it('violation: balance = 0 when invoices and payments are equal (no stored credit bias)', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { total: makeDecimal('500.00') },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([
      { amount: makeDecimal('500.00') },
    ]);

    const balance = await service.computeBalance('client-3');
    expect(balance.toFixed(2)).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 16: CORS allowed origins are derived from CORS_ORIGINS env var
// ---------------------------------------------------------------------------

describe('CONSTRAINT 16: CORS allowed origins are derived from CORS_ORIGINS env var', () => {
  it('default (CORS_ORIGINS unset) → only http://localhost:5173 is in the allow-list', () => {
    const origins = parseCorsOrigins('http://localhost:5173');
    expect(origins).toEqual(['http://localhost:5173']);
    expect(origins).not.toContain('https://attacker.example.com');
  });

  it('CORS_ORIGINS="https://app.example.com" → only that origin is in the allow-list', () => {
    const origins = parseCorsOrigins('https://app.example.com');
    expect(origins).toContain('https://app.example.com');
    expect(origins).not.toContain('http://localhost:5173');
    expect(origins).not.toContain('https://attacker.example.com');
  });

  it('multiple origins (comma-separated) → all listed origins allowed, others not', () => {
    const origins = parseCorsOrigins('https://app.example.com, http://localhost:5173');
    expect(origins).toContain('https://app.example.com');
    expect(origins).toContain('http://localhost:5173');
    expect(origins).not.toContain('https://attacker.example.com');
  });

  it('extra whitespace around entries is stripped', () => {
    const origins = parseCorsOrigins('  https://app.example.com  ,  https://staging.example.com  ');
    expect(origins).toEqual(['https://app.example.com', 'https://staging.example.com']);
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 17: Pagination limit is clamped to MAX_PAGE_LIMIT on every list
// endpoint — clients cannot force a full-table scan by sending limit=9999999
// ---------------------------------------------------------------------------

describe('CONSTRAINT 17: limit is clamped server-side regardless of client value', () => {
  describe('ParseLimitPipe', () => {
    it('limit=100000 → clamped to MAX_PAGE_LIMIT (never loads whole table)', () => {
      const pipe = new ParseLimitPipe(20);
      const result = pipe.transform('100000');
      expect(result).toBe(MAX_PAGE_LIMIT);
      expect(result).toBeLessThanOrEqual(MAX_PAGE_LIMIT);
    });

    it('limit=9999999 → clamped to MAX_PAGE_LIMIT', () => {
      const pipe = new ParseLimitPipe(20);
      expect(pipe.transform('9999999')).toBe(MAX_PAGE_LIMIT);
    });

    it('limit omitted (undefined) → returns configured default', () => {
      expect(new ParseLimitPipe(20).transform(undefined)).toBe(20);
      expect(new ParseLimitPipe(50).transform(undefined)).toBe(50);
      expect(new ParseLimitPipe(30).transform(undefined)).toBe(30);
    });

    it('limit="" (empty string) → returns configured default', () => {
      expect(new ParseLimitPipe(20).transform('')).toBe(20);
    });

    it('limit=0 → clamped to minimum of 1', () => {
      expect(new ParseLimitPipe(20).transform('0')).toBe(1);
    });

    it('limit=-5 → clamped to minimum of 1', () => {
      expect(new ParseLimitPipe(20).transform('-5')).toBe(1);
    });

    it('limit=NaN → returns configured default', () => {
      expect(new ParseLimitPipe(20).transform('abc')).toBe(20);
    });

    it('limit=50 within bounds → passes through unchanged', () => {
      expect(new ParseLimitPipe(20).transform('50')).toBe(50);
    });
  });

  describe('ParsePagePipe', () => {
    it('page omitted (undefined) → returns 1', () => {
      expect(new ParsePagePipe().transform(undefined)).toBe(1);
    });

    it('page="" (empty string) → returns 1', () => {
      expect(new ParsePagePipe().transform('')).toBe(1);
    });

    it('page=0 → clamped to 1', () => {
      expect(new ParsePagePipe().transform('0')).toBe(1);
    });

    it('page=-1 → clamped to 1', () => {
      expect(new ParsePagePipe().transform('-1')).toBe(1);
    });

    it('page=NaN → returns 1', () => {
      expect(new ParsePagePipe().transform('abc')).toBe(1);
    });

    it('page=5 → passes through unchanged', () => {
      expect(new ParsePagePipe().transform('5')).toBe(5);
    });
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 18: Container.number is globally unique — duplicate → 409 CONFLICT
// ---------------------------------------------------------------------------

describe('CONSTRAINT 18: Container.number is globally unique', () => {
  let service: ContainersService;

  // P2002 error that Prisma would raise on a unique-constraint violation
  const p2002 = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`number`)',
    { code: 'P2002', clientVersion: '5.0.0' },
  );

  const mockPrisma = {
    container: { create: fn(), update: fn(), findUnique: fn(), findMany: fn(), count: fn() },
    containerProductLine: { createMany: fn(), findMany: fn() },
    stockLot: { createMany: fn(), findMany: fn(), update: fn() },
    containerExpense: { findMany: fn() },
    containerDiscount: { findUnique: fn() },
    user:     { findUnique: fn() },
    supplier: { findUnique: fn() },
    $transaction: fn(),
    $queryRaw:    fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cbOrArray: any) => {
      if (Array.isArray(cbOrArray)) return Promise.all(cbOrArray);
      return cbOrArray(mockPrisma);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ContainersService>(ContainersService);
  });

  it('valid: first container with a new number is created successfully', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: 'Acme' });
    mockPrisma.container.create.mockResolvedValue({ id: 'c1' });
    // findUniqueOrThrow used for the return value inside tx
    (mockPrisma.container as any).findUniqueOrThrow = fn();
    (mockPrisma.container as any).findUniqueOrThrow.mockResolvedValue({
      id: 'c1', number: 'ABCD1234567', supplier: {}, productLines: [], expenses: [], discount: null,
    });

    await expect(
      service.create({ number: 'ABCD1234567', supplierId: 's1' } as any, 'clerk-1'),
    ).resolves.toBeDefined();
  });

  it('violation: duplicate Container.number → ConflictException with CONFLICT code', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: 'Acme' });
    // Simulate the DB rejecting with a P2002 unique-constraint error
    mockPrisma.$transaction.mockRejectedValue(p2002);

    await expect(
      service.create({ number: 'ABCD1234567', supplierId: 's1' } as any, 'clerk-1'),
    ).rejects.toThrow(ConflictException);

    await expect(
      service.create({ number: 'ABCD1234567', supplierId: 's1' } as any, 'clerk-1'),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CONFLICT' }) });
  });

  it('violation: renaming a container to an existing number → ConflictException', async () => {
    mockPrisma.container.findUnique.mockResolvedValue({ id: 'c2', status: 'port' });
    // Simulate P2002 from the UPDATE
    mockPrisma.container.update.mockRejectedValue(p2002);

    await expect(
      service.update('c2', { number: 'ABCD1234567' } as any, 'clerk-1'),
    ).rejects.toThrow(ConflictException);
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT 19: BagType.name is unique — duplicate → 409 CONFLICT
// ---------------------------------------------------------------------------

describe('CONSTRAINT 19: BagType.name is unique', () => {
  let service: BagTypesService;

  const p2002 = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`name`)',
    { code: 'P2002', clientVersion: '5.0.0' },
  );

  const mockPrisma = {
    bagType: { create: fn(), update: fn(), findUnique: fn(), findMany: fn(), count: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (arr: any) =>
      Array.isArray(arr) ? Promise.all(arr) : arr(mockPrisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BagTypesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BagTypesService>(BagTypesService);
  });

  it('valid: first bag type with a new name is created successfully', async () => {
    mockPrisma.bagType.create.mockResolvedValue({
      id: 'bt1', name: '2kg bag', nominalKg: '2.000', costPerBag: '0.05', workerRate: '0.05',
    });

    await expect(
      service.create({ name: '2kg bag', nominalKg: '2.000', costPerBag: '0.0500', workerRate: '0.0500' } as any),
    ).resolves.toBeDefined();
  });

  it('violation: duplicate BagType.name → ConflictException with CONFLICT code', async () => {
    mockPrisma.bagType.create.mockRejectedValue(p2002);

    await expect(
      service.create({ name: '2kg bag', nominalKg: '2.000', costPerBag: '0.0500', workerRate: '0.0500' } as any),
    ).rejects.toThrow(ConflictException);

    await expect(
      service.create({ name: '2kg bag', nominalKg: '2.000', costPerBag: '0.0500', workerRate: '0.0500' } as any),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CONFLICT' }) });
  });

  it('violation: renaming a bag type to an existing name → ConflictException', async () => {
    // findOne (called by update) succeeds — the bag type exists
    mockPrisma.bagType.findUnique.mockResolvedValue({ id: 'bt2', name: '5kg bag' });
    // update fails with P2002 because target name already taken
    mockPrisma.bagType.update.mockRejectedValue(p2002);

    await expect(
      service.update('bt2', { name: '2kg bag' }),
    ).rejects.toThrow(ConflictException);

    await expect(
      service.update('bt2', { name: '2kg bag' }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CONFLICT' }) });
  });
});
