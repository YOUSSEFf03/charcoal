import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ContainersService } from './containers.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Shared mock factory helpers
// ---------------------------------------------------------------------------

/**
 * Returns jest.fn() typed as `any` so that .mockResolvedValue / .mockImplementation
 * do not produce TS2345 errors from @jest/globals strict generic inference.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

function makeMockTx() {
  return {
    container: {
      findUnique: fn(),
      update: fn(),
    },
    containerProductLine: {
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
    },
    containerExpense: {
      create: fn(),
      update: fn(),
      delete: fn(),
    },
    containerDiscount: {
      upsert: fn(),
      delete: fn(),
    },
    stockLot: {
      findMany: fn(),
      create: fn(),
      createMany: fn(),
      update: fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ContainersService', () => {
  let service: ContainersService;

  const mockPrisma = {
    container: {
      findUnique: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      findMany: fn(),
      count: fn(),
    },
    containerProductLine: {
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      findFirst: fn(),
    },
    containerExpense: {
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      findFirst: fn(),
    },
    containerDiscount: {
      findUnique: fn(),
      upsert: fn(),
      delete: fn(),
    },
    stockLot: {
      findMany: fn(),
      create: fn(),
      update: fn(),
    },
    user: { findUnique: fn() },
    supplier: { findUnique: fn() },
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

  // =========================================================================
  // Test 1: Arrival — StockLot created with correct kgRemaining
  // =========================================================================

  describe('update() - arrival transition', () => {
    it('Test 1: creates StockLot with kgReceived and kgRemaining = "8400.000" for 800 bags × 10.500 kg', async () => {
      // Arrange
      const containerId = 'container-uuid-1';

      const productLine = {
        id: 'line-1',
        charcoalType: 'BBQ',
        grade: 'A',
        supplierId: 'supplier-1',
        paidBags: 800,
        giftBags: 0,
        kgPerBag: { toString: () => '10.500' },
        pricePerTon: { toString: () => '800.00' },
        createdAt: new Date('2024-01-01'),
      };

      const containerInDb = {
        id: containerId,
        status: 'transit',
        productLines: [productLine],
      };

      // The recalculateContainerCosts call inside the transaction needs this full shape
      const containerForRecalc = {
        id: containerId,
        productLines: [productLine],
        expenses: [],
        discount: null,
      };

      const finalContainer = { id: containerId, status: 'arrived' };
      const mockLotAfterCreate = { id: 'lot-1', productLineId: 'line-1', createdAt: new Date('2024-01-01') };

      const tx = makeMockTx();
      // tx.container.findUnique is called 2 times inside $transaction:
      //   1st: arrival guard (re-fetch with productLines)
      //   2nd: inside recalculateContainerCosts
      tx.container.findUnique
        .mockResolvedValueOnce(containerInDb)
        .mockResolvedValueOnce(containerForRecalc);

      tx.container.update.mockResolvedValue({});
      // BUG-1: lots are now created one-by-one with productLineId, not via createMany.
      tx.stockLot.create.mockResolvedValue({ id: 'lot-1' });
      tx.stockLot.findMany.mockResolvedValue([mockLotAfterCreate]);
      tx.stockLot.update.mockResolvedValue({});

      // Pre-transaction guard check (1st call) and post-tx fetch (2nd call)
      mockPrisma.container.findUnique
        .mockResolvedValueOnce({ id: containerId, status: 'transit' })
        .mockResolvedValueOnce(finalContainer);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      // Act
      await service.update(containerId, { status: 'arrived' }, 'user-clerk');

      // Assert
      const createCall = tx.stockLot.create.mock.calls[0][0];
      const createData = createCall.data;
      expect(createData.kgReceived).toBe('8400.000');
      expect(createData.kgRemaining).toBe('8400.000');
      expect(createData.productLineId).toBe('line-1');
    });

    // =======================================================================
    // Test 2: CONSTRAINT 8 — Two separate StockLots for two lines
    // =======================================================================

    it('Test 2: creates exactly 2 separate StockLots when container has 2 productLines with same type/grade', async () => {
      // Arrange
      const containerId = 'container-uuid-2';

      const lineA = {
        id: 'line-a',
        charcoalType: 'BBQ',
        grade: 'A',
        supplierId: 'supplier-1',
        paidBags: 500,
        giftBags: 0,
        kgPerBag: { toString: () => '20.000' },
        pricePerTon: { toString: () => '800.00' },
        createdAt: new Date('2024-01-01'),
      };

      const lineB = {
        id: 'line-b',
        charcoalType: 'BBQ', // same type as A
        grade: 'A',          // same grade as A
        supplierId: 'supplier-1',
        paidBags: 300,
        giftBags: 0,
        kgPerBag: { toString: () => '20.000' },
        pricePerTon: { toString: () => '800.00' },
        createdAt: new Date('2024-01-02'),
      };

      const containerInDb = { id: containerId, status: 'transit', productLines: [lineA, lineB] };
      const containerForRecalc = {
        id: containerId,
        productLines: [lineA, lineB],
        expenses: [],
        discount: null,
      };
      const finalContainer = { id: containerId, status: 'arrived' };

      const lotA = { id: 'lot-a', productLineId: 'line-a', createdAt: new Date('2024-01-01') };
      const lotB = { id: 'lot-b', productLineId: 'line-b', createdAt: new Date('2024-01-02') };

      const tx = makeMockTx();
      tx.container.findUnique
        .mockResolvedValueOnce(containerInDb)
        .mockResolvedValueOnce(containerForRecalc);

      tx.container.update.mockResolvedValue({});
      tx.stockLot.create.mockResolvedValue({ id: 'lot-x' });
      tx.stockLot.findMany.mockResolvedValue([lotA, lotB]);
      tx.stockLot.update.mockResolvedValue({});

      mockPrisma.container.findUnique
        .mockResolvedValueOnce({ id: containerId, status: 'transit' })
        .mockResolvedValueOnce(finalContainer);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      // Act
      await service.update(containerId, { status: 'arrived' }, 'user-clerk');

      // Assert — CONSTRAINT 8: one StockLot per product line, never merged.
      // BUG-1: created one-by-one, each bound to its own productLineId.
      expect(tx.stockLot.create).toHaveBeenCalledTimes(2);
      const createdLineIds = tx.stockLot.create.mock.calls.map((c: any) => c[0].data.productLineId);
      expect(createdLineIds).toEqual(['line-a', 'line-b']);
    });
  });

  // =========================================================================
  // Test 3: recalculateContainerCosts — correct costPerKg formula
  // =========================================================================

  describe('recalculateContainerCosts()', () => {
    it('Test 3: calculates allInCostPerKg = "0.8100" for 1000 bags × 20kg/bag at $800/ton with $200 expense', async () => {
      // Arrange
      const containerId = 'container-uuid-3';

      const productLine = {
        id: 'line-1',
        paidBags: 1000,
        kgPerBag: { toString: () => '20.000' },
        pricePerTon: { toString: () => '800.00' },
        createdAt: new Date('2024-01-01'),
      };

      const expense = { id: 'expense-1', amount: { toString: () => '200.00' } };

      const containerData = {
        id: containerId,
        productLines: [productLine],
        expenses: [expense],
        discount: null,
      };

      const lot = { id: 'lot-1', productLineId: 'line-1', createdAt: new Date('2024-01-01') };

      const tx = makeMockTx();
      tx.container.findUnique.mockResolvedValue(containerData);
      tx.stockLot.findMany.mockResolvedValue([lot]);
      tx.stockLot.update.mockResolvedValue({});

      // Act — recalculateContainerCosts is public
      await service.recalculateContainerCosts(containerId, tx as any);

      // Assert
      // tonnage = 1000 × 20 / 1000 = 20 tons
      // expenseShare = 200 × (20/20) = 200
      // allInCostPerTon = 800 + (200/20) = 800 + 10 = 810
      // allInCostPerKg = 810 / 1000 = 0.8100
      expect(tx.stockLot.update).toHaveBeenCalledTimes(1);
      const updateCall = tx.stockLot.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe('lot-1');
      expect(updateCall.data.costPerKg).toBe('0.8100');
    });

    // =======================================================================
    // Test 9: Two productLines with proportional expense split
    // =======================================================================

    it('Test 9: proportionally splits expense across two lines — Line A: "0.8100", Line B: "0.9100"', async () => {
      // Arrange
      const containerId = 'container-uuid-9';

      const lineA = {
        id: 'line-a',
        paidBags: 1000,
        kgPerBag: { toString: () => '20.000' },
        pricePerTon: { toString: () => '800.00' },
        createdAt: new Date('2024-01-01'),
      };

      const lineB = {
        id: 'line-b',
        paidBags: 500,
        kgPerBag: { toString: () => '20.000' },
        pricePerTon: { toString: () => '900.00' },
        createdAt: new Date('2024-01-02'),
      };

      const expense = { id: 'expense-1', amount: { toString: () => '300.00' } };

      const containerData = {
        id: containerId,
        productLines: [lineA, lineB],
        expenses: [expense],
        discount: null,
      };

      const lotA = { id: 'lot-a', productLineId: 'line-a', createdAt: new Date('2024-01-01') };
      const lotB = { id: 'lot-b', productLineId: 'line-b', createdAt: new Date('2024-01-02') };

      const tx = makeMockTx();
      tx.container.findUnique.mockResolvedValue(containerData);
      tx.stockLot.findMany.mockResolvedValue([lotA, lotB]);
      tx.stockLot.update.mockResolvedValue({});

      // Act
      await service.recalculateContainerCosts(containerId, tx as any);

      // Assert — lookup is by productLineId FK, so assert per-lot by id (not call order).
      // Line A: tonnage=20, expenseShare=300×(20/30)=200, allInCostPerTon=800+(200/20)=810, /1000=0.8100
      // Line B: tonnage=10, expenseShare=300×(10/30)=100, allInCostPerTon=900+(100/10)=910, /1000=0.9100
      expect(tx.stockLot.update).toHaveBeenCalledTimes(2);

      const costById = (id: string) =>
        tx.stockLot.update.mock.calls.find((c: any) => c[0].where.id === id)[0].data.costPerKg;
      expect(costById('lot-a')).toBe('0.8100');
      expect(costById('lot-b')).toBe('0.9100');
    });

    // =======================================================================
    // BUG-1 (P1): FK join, not array index
    // =======================================================================

    it('BUG-1: lots returned in REVERSE order still map cost to their OWN line (FK join, not index)', async () => {
      // Two lines, same type/grade/supplier, different price. findMany returns the
      // lots in the OPPOSITE order to productLines — the old index path would swap
      // the costs. The FK join must keep each lot tied to its own line.
      const containerId = 'container-bug1';
      const lineCheap = { id: 'line-cheap', paidBags: 100, kgPerBag: { toString: () => '50' }, pricePerTon: { toString: () => '1000' } };
      const lineExp = { id: 'line-exp', paidBags: 100, kgPerBag: { toString: () => '50' }, pricePerTon: { toString: () => '3000' } };

      const tx = makeMockTx();
      tx.container.findUnique.mockResolvedValue({
        id: containerId,
        productLines: [lineCheap, lineExp],
        expenses: [],
        discount: null,
      });
      // Reverse order: exp lot first, cheap lot second.
      tx.stockLot.findMany.mockResolvedValue([
        { id: 'lot-exp', productLineId: 'line-exp' },
        { id: 'lot-cheap', productLineId: 'line-cheap' },
      ]);
      tx.stockLot.update.mockResolvedValue({});

      await service.recalculateContainerCosts(containerId, tx as any);

      const costById = (id: string) =>
        tx.stockLot.update.mock.calls.find((c: any) => c[0].where.id === id)[0].data.costPerKg;
      // cheap line 1000/ton → 1.0000/kg; exp line 3000/ton → 3.0000/kg
      expect(costById('lot-cheap')).toBe('1.0000');
      expect(costById('lot-exp')).toBe('3.0000');
    });

    it('BUG-1: skips lots with a null productLineId instead of mis-assigning by index', async () => {
      const containerId = 'container-bug1-null';
      const line = { id: 'line-1', paidBags: 100, kgPerBag: { toString: () => '50' }, pricePerTon: { toString: () => '1000' } };

      const tx = makeMockTx();
      tx.container.findUnique.mockResolvedValue({
        id: containerId,
        productLines: [line],
        expenses: [],
        discount: null,
      });
      tx.stockLot.findMany.mockResolvedValue([
        { id: 'lot-1', productLineId: 'line-1' },
        { id: 'orphan-lot', productLineId: null },
      ]);
      tx.stockLot.update.mockResolvedValue({});

      await service.recalculateContainerCosts(containerId, tx as any);

      const updatedIds = tx.stockLot.update.mock.calls.map((c: any) => c[0].where.id);
      expect(updatedIds).toContain('lot-1');
      expect(updatedIds).not.toContain('orphan-lot');
    });
  });

  // =========================================================================
  // Test 4: Post-arrival expense → recalc runs
  // =========================================================================

  describe('createExpense()', () => {
    it('Test 4: triggers recalculateContainerCosts (stockLot.update called) after creating an expense', async () => {
      // Arrange
      const containerId = 'container-uuid-4';
      const userId = 'user-clerk-id';

      const container = { id: containerId, status: 'arrived' };
      const user = { id: 'user-internal-id', clerkId: userId };

      const productLine = {
        id: 'line-1',
        paidBags: 1000,
        kgPerBag: { toString: () => '20.000' },
        pricePerTon: { toString: () => '800.00' },
        createdAt: new Date('2024-01-01'),
      };

      const existingExpense = { id: 'exp-existing', amount: { toString: () => '100.00' } };
      const newExpense = { id: 'exp-new', description: 'freight', amount: { toString: () => '100.00' } };

      const containerForRecalc = {
        id: containerId,
        productLines: [productLine],
        expenses: [existingExpense, newExpense],
        discount: null,
      };

      const lot = { id: 'lot-1', productLineId: 'line-1', createdAt: new Date('2024-01-01') };

      mockPrisma.container.findUnique.mockResolvedValue(container);
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const tx = makeMockTx();
      tx.containerExpense.create.mockResolvedValue(newExpense);
      tx.container.findUnique.mockResolvedValue(containerForRecalc);
      tx.stockLot.findMany.mockResolvedValue([lot]);
      tx.stockLot.update.mockResolvedValue({});

      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      // Act
      await service.createExpense(containerId, { description: 'freight', amount: '100.00' }, userId);

      // Assert: recalculate ran — stockLot.update must have been called
      expect(tx.stockLot.update).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Test 5: DELETE container when arrived → ConflictException (409)
  // =========================================================================

  describe('remove()', () => {
    it('Test 5: throws ConflictException when container status is "arrived"', async () => {
      // Arrange
      mockPrisma.container.findUnique.mockResolvedValue({ id: 'c1', status: 'arrived' });

      // Act & Assert
      await expect(service.remove('c1')).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when container does not exist', async () => {
      mockPrisma.container.findUnique.mockResolvedValue(null);
      await expect(service.remove('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // Test 6: DELETE productLine when container arrived → BadRequestException (400)
  // =========================================================================

  describe('removeProductLine()', () => {
    it('Test 6: throws BadRequestException when deleting a product line from an arrived container', async () => {
      // Arrange
      mockPrisma.container.findUnique.mockResolvedValue({ id: 'c6', status: 'arrived' });

      // Act & Assert
      await expect(service.removeProductLine('c6', 'line-6')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when container does not exist', async () => {
      mockPrisma.container.findUnique.mockResolvedValue(null);
      await expect(service.removeProductLine('bad-id', 'line-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProductLine() — arrival guard', () => {
    it('throws BadRequestException(CONTAINER_ARRIVED) when editing a product line on an arrived container, and never touches the DB', async () => {
      // Regression test: editing paidBags/kgPerBag/pricePerTon after arrival would
      // recompute cost allocation (recalculateContainerCosts) against a tonnage that
      // no longer matches the StockLot's already-frozen kgReceived/kgRemaining,
      // silently desyncing costPerKg from the physical stock actually on hand.
      mockPrisma.container.findUnique.mockResolvedValue({ id: 'c7', status: 'arrived' });

      await expect(
        service.updateProductLine('c7', 'line-7', { paidBags: 999 } as any),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONTAINER_ARRIVED' }),
      });
      expect(mockPrisma.containerProductLine.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when container does not exist', async () => {
      mockPrisma.container.findUnique.mockResolvedValue(null);
      await expect(service.updateProductLine('bad-id', 'line-id', {} as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createProductLine() — arrival guard', () => {
    it('throws BadRequestException(CONTAINER_ARRIVED) when adding a product line to an arrived container, and never creates it', async () => {
      // Regression test: a line added post-arrival has no corresponding StockLot
      // (only created by the arrival transition), so its tonnage would silently
      // dilute expense/discount allocation across the container's REAL stock via
      // recalculateContainerCosts()'s totalTonnage denominator, without the new
      // line ever receiving a cost share of its own.
      mockPrisma.container.findUnique.mockResolvedValue({ id: 'c8', status: 'arrived' });

      await expect(
        service.createProductLine('c8', {
          charcoalType: 'coconut', grade: 'A', supplierId: 'sup-1',
          paidBags: 100, kgPerBag: 10, pricePerTon: 800,
        } as any),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONTAINER_ARRIVED' }),
      });
      expect(mockPrisma.supplier.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when container does not exist', async () => {
      mockPrisma.container.findUnique.mockResolvedValue(null);
      await expect(
        service.createProductLine('bad-id', {
          charcoalType: 'coconut', grade: 'A', supplierId: 'sup-1',
          paidBags: 100, kgPerBag: 10, pricePerTon: 800,
        } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // Test 7: GET container as sales_rep → no costPerKg / averageCostPerKg
  // =========================================================================

  describe('findOne()', () => {
    it('Test 7: strips costPerKg from stockLots and averageCostPerKg from totals for sales_rep role', async () => {
      // Arrange
      const containerId = 'container-uuid-7';

      const container = {
        id: containerId,
        status: 'arrived',
        expenses: [],
        discount: null,
        productLines: [
          {
            id: 'line-1',
            paidBags: 1000,
            kgPerBag: { toString: () => '20.000' },
          },
        ],
        stockLots: [
          {
            id: 'lot-1',
            costPerKg: { toString: () => '0.8100' },
          },
        ],
        supplier: { id: 'supplier-1', name: 'Test Supplier' },
      };

      mockPrisma.container.findUnique.mockResolvedValue(container);

      // Act
      const result = await service.findOne(containerId, 'sales_rep');

      // Assert
      expect(result.stockLots[0]).not.toHaveProperty('costPerKg');
      expect(result.totals).not.toHaveProperty('averageCostPerKg');
    });

    it('returns costPerKg and averageCostPerKg for owner role', async () => {
      // Arrange
      const container = {
        id: 'container-uuid-7b',
        status: 'arrived',
        expenses: [],
        discount: null,
        productLines: [
          { id: 'line-1', paidBags: 1000, kgPerBag: { toString: () => '20.000' } },
        ],
        stockLots: [
          { id: 'lot-1', costPerKg: { toString: () => '0.8100' } },
        ],
        supplier: { id: 'supplier-1', name: 'Test Supplier' },
      };

      mockPrisma.container.findUnique.mockResolvedValue(container);

      // Act
      const result = await service.findOne('container-uuid-7b', 'owner');

      // Assert
      expect(result.stockLots[0]).toHaveProperty('costPerKg');
      expect(result.totals).toHaveProperty('averageCostPerKg');
    });

    it('throws NotFoundException when container does not exist', async () => {
      mockPrisma.container.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // Test 8: Decimal precision — no floating-point drift
  // =========================================================================

  describe('update() - decimal precision', () => {
    it('Test 8: kgReceived is exactly "8400.000" (3 decimal places, no float drift) for 800 × 10.500', async () => {
      // Arrange
      const containerId = 'container-uuid-8';

      const productLine = {
        id: 'line-1',
        charcoalType: 'WOOD',
        grade: 'B',
        supplierId: 'supplier-1',
        paidBags: 800,
        giftBags: 0,
        kgPerBag: { toString: () => '10.500' },
        pricePerTon: { toString: () => '500.00' },
        createdAt: new Date('2024-01-01'),
      };

      const containerInDb = { id: containerId, status: 'transit', productLines: [productLine] };
      const containerForRecalc = {
        id: containerId,
        productLines: [productLine],
        expenses: [],
        discount: null,
      };
      const finalContainer = { id: containerId, status: 'arrived' };

      const lot = { id: 'lot-1', productLineId: 'line-1', createdAt: new Date('2024-01-01') };

      const tx = makeMockTx();
      tx.container.findUnique
        .mockResolvedValueOnce(containerInDb)
        .mockResolvedValueOnce(containerForRecalc);
      tx.container.update.mockResolvedValue({});
      tx.stockLot.create.mockResolvedValue({ id: 'lot-1' });
      tx.stockLot.findMany.mockResolvedValue([lot]);
      tx.stockLot.update.mockResolvedValue({});

      mockPrisma.container.findUnique
        .mockResolvedValueOnce({ id: containerId, status: 'transit' })
        .mockResolvedValueOnce(finalContainer);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      // Act
      await service.update(containerId, { status: 'arrived' }, 'user-clerk');

      // Assert — exact string representation, not floating-point garbage
      const createCall = tx.stockLot.create.mock.calls[0][0];
      const createData = createCall.data;
      expect(createData.kgReceived).toBe('8400.000');
      expect(createData.kgRemaining).toBe('8400.000');
      expect(typeof createData.kgReceived).toBe('string');
    });
  });

  // =========================================================================
  // Additional guard tests
  // =========================================================================

  describe('update() - arrival guards', () => {
    it('throws ConflictException if container is already arrived', async () => {
      const containerId = 'already-arrived';
      mockPrisma.container.findUnique.mockResolvedValue({ id: containerId, status: 'arrived' });

      const tx = makeMockTx();
      tx.container.findUnique.mockResolvedValue({ id: containerId, status: 'arrived', productLines: [] });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.update(containerId, { status: 'arrived' }, 'user-clerk')).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException if container has no product lines at arrival', async () => {
      const containerId = 'container-no-lines';
      mockPrisma.container.findUnique.mockResolvedValue({ id: containerId, status: 'transit' });

      const tx = makeMockTx();
      tx.container.findUnique.mockResolvedValue({
        id: containerId,
        status: 'transit',
        productLines: [],
      });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.update(containerId, { status: 'arrived' }, 'user-clerk')).rejects.toThrow(BadRequestException);
    });
  });
});
