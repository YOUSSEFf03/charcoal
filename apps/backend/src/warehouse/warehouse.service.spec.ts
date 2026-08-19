import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }

describe('WarehouseService — material flow (anti-double-count)', () => {
  let service: WarehouseService;

  const mockPrisma = {
    stockLot: { findMany: fn(), findUnique: fn() },
    packedStock: { findMany: fn() },
    packingSessionLot: { findMany: fn() },
    fillJobLot: { groupBy: fn() },
    stockExit: { groupBy: fn(), findMany: fn() },
    stockAdjustment: { groupBy: fn() },
    container: { findUnique: fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.fillJobLot.groupBy.mockResolvedValue([]);
    mockPrisma.stockExit.groupBy.mockResolvedValue([]);
    mockPrisma.stockExit.findMany.mockResolvedValue([]);
    mockPrisma.stockAdjustment.groupBy.mockResolvedValue([]);
    mockPrisma.packedStock.findMany.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [WarehouseService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<WarehouseService>(WarehouseService);
  });

  /** One session: A=40kg, B=60kg input, 100kg output split proportionally, 0 variance. */
  function twoLotSessionFixture(overrides: { kgOutputTotal?: string; varianceKg?: string } = {}) {
    const session = {
      id: 'S1',
      date: new Date('2026-01-01T00:00:00.000Z'),
      kgConsumed: '100.000',
      kgOutputTotal: overrides.kgOutputTotal ?? '100.000',
      varianceKg: overrides.varianceKg ?? '0.000',
      bagsOutput: [{ bagTypeId: 'bt1', qty: 100 }],
    };
    mockPrisma.packingSessionLot.findMany.mockResolvedValue([
      { lotId: 'A', kgUsed: '40.000', session },
      { lotId: 'B', kgUsed: '60.000', session },
    ]);
    mockPrisma.packedStock.findMany.mockResolvedValue([
      { lotId: 'A', sessionId: 'S1', quantity: 40, bagType: { nominalKg: '1.000' } },
      { lotId: 'B', sessionId: 'S1', quantity: 60, bagType: { nominalKg: '1.000' } },
    ]);
  }

  describe('TEST 1 — historical output survives later sales (real Aug-9 scenario)', () => {
    it('reports allocatedOutputKg=500 and waste=8, NOT the shrunk 210kg current PackedStock figure', async () => {
      const session = {
        id: 'S-aug9',
        date: new Date('2026-08-09T00:00:00.000Z'),
        kgConsumed: '508.000',
        kgOutputTotal: '500.000',
        varianceKg: '8.000',
        bagsOutput: [{ bagTypeId: 'bt-10kg', qty: 50 }],
      };
      mockPrisma.packingSessionLot.findMany.mockResolvedValue([
        { lotId: 'LOT-AUG9', kgUsed: '508.000', session },
      ]);
      // 20 of the original 50 bags have since been sold (walk-in exit) — only 21 remain
      // on-hand (matches the live-audited PackedStock row: originally 50, now 21).
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { lotId: 'LOT-AUG9', sessionId: 'S-aug9', quantity: 21, bagType: { nominalKg: '10.000' } },
      ]);
      mockPrisma.stockLot.findUnique.mockResolvedValue({
        id: 'LOT-AUG9', charcoalType: 'BBQ Hardwood', grade: 'A', kgReceived: '20000.000', kgRemaining: '19392.000',
      });

      const flow = await service.getLotMaterialFlow('LOT-AUG9');

      // TEST 1 + TEST 4: historical output/waste/yield, unaffected by the later sale.
      expect(flow.packedOutput).toBe('500.000'); // NOT 210.000
      expect(flow.waste).toBe('8.000');
      expect(flow.yieldPct).toBe('98.4'); // 500 / 508 * 100
      // The live current-inventory figure is exposed SEPARATELY and never folded into output.
      expect(flow.currentPackedStockKg).toBe('210.000');
      expect(flow.sessions[0].allocatedOutputKg).toBe('500.000');
      expect(flow.sessions[0].currentBatchStockKg).toBe('210.000');
    });
  });

  describe('TEST 3 — 50/50 control session (A=100, B=100, output=200)', () => {
    it('splits output exactly 100/100, summing to 200 — never doubled or halved', async () => {
      const session = {
        id: 'S-control',
        date: new Date('2026-08-15T00:00:00.000Z'),
        kgConsumed: '200.000',
        kgOutputTotal: '200.000',
        varianceKg: '0.000',
        bagsOutput: [{ bagTypeId: 'bt-10kg', qty: 20 }],
      };
      mockPrisma.packingSessionLot.findMany.mockResolvedValue([
        { lotId: 'A', kgUsed: '100.000', session },
        { lotId: 'B', kgUsed: '100.000', session },
      ]);
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { lotId: 'A', sessionId: 'S-control', quantity: 10, bagType: { nominalKg: '10.000' } },
        { lotId: 'B', sessionId: 'S-control', quantity: 10, bagType: { nominalKg: '10.000' } },
      ]);
      mockPrisma.stockLot.findUnique.mockResolvedValueOnce({
        id: 'A', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '900.000',
      });
      const flowA = await service.getLotMaterialFlow('A');
      mockPrisma.stockLot.findUnique.mockResolvedValueOnce({
        id: 'B', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '900.000',
      });
      const flowB = await service.getLotMaterialFlow('B');

      expect(flowA.packedOutput).toBe('100.000');
      expect(flowB.packedOutput).toBe('100.000');
      expect(parseFloat(flowA.packedOutput) + parseFloat(flowB.packedOutput)).toBe(200);
    });
  });

  describe('TEST 6 — raw-material exits vs. packed-bag sales are kept separate', () => {
    it('reports rawMaterialExitsKg and packedBagSalesKg as distinct, non-merged totals', async () => {
      mockPrisma.packingSessionLot.findMany.mockResolvedValue([]);
      mockPrisma.stockExit.groupBy.mockResolvedValue([
        { lotId: 'LOT-X', _sum: { kgQuantity: '5000.000' } },
      ]);
      // Packed-bag exit: StockExit.lotId is null; only reachable via packedStock.lotId.
      mockPrisma.stockExit.findMany.mockResolvedValue([
        { quantity: 20, bagType: { nominalKg: '10.000' }, packedStock: { lotId: 'LOT-X' } },
      ]);
      mockPrisma.stockLot.findUnique.mockResolvedValue({
        id: 'LOT-X', charcoalType: 'Oak', grade: 'A', kgReceived: '20000.000', kgRemaining: '14392.000',
      });

      const flow = await service.getLotMaterialFlow('LOT-X');

      expect(flow.rawMaterialExitsKg).toBe('5000.000');
      expect(flow.packedBagSalesKg).toBe('200.000');
      // StockLot.kgRemaining is read as-is from the lot row — computeLotFlows() never
      // touches or derives it, confirming packed-bag sales cannot affect it.
      expect(flow.remaining).toBe('14392.000');
    });
  });

  describe('TEST 7 — lot-level StockAdjustment (Finding B)', () => {
    it('no adjustment: lotAdjustmentsKg is 0.000 and reconciliation holds without it', async () => {
      mockPrisma.packingSessionLot.findMany.mockResolvedValue([]);
      mockPrisma.stockLot.findUnique.mockResolvedValue({
        id: 'LOT-NOADJ', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '1000.000',
      });
      const flow = await service.getLotMaterialFlow('LOT-NOADJ');
      expect(flow.lotAdjustmentsKg).toBe('0.000');
    });

    it('negative adjustment (loss) is reported with its real sign, not clamped', async () => {
      mockPrisma.packingSessionLot.findMany.mockResolvedValue([]);
      mockPrisma.stockAdjustment.groupBy.mockResolvedValue([
        { lotId: 'LOT-LOSS', _sum: { difference: '-50.000' } },
      ]);
      mockPrisma.stockLot.findUnique.mockResolvedValue({
        id: 'LOT-LOSS', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '950.000',
      });
      const flow = await service.getLotMaterialFlow('LOT-LOSS');
      expect(flow.lotAdjustmentsKg).toBe('-50.000');
    });

    it('positive adjustment (gain) is reported with its real sign', async () => {
      mockPrisma.packingSessionLot.findMany.mockResolvedValue([]);
      mockPrisma.stockAdjustment.groupBy.mockResolvedValue([
        { lotId: 'LOT-GAIN', _sum: { difference: '30.000' } },
      ]);
      mockPrisma.stockLot.findUnique.mockResolvedValue({
        id: 'LOT-GAIN', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '1030.000',
      });
      const flow = await service.getLotMaterialFlow('LOT-GAIN');
      expect(flow.lotAdjustmentsKg).toBe('30.000');
    });

    it('full reconciliation example: received=1000, packing=100, fillJobs=0, rawExits=0, adjustment=-50 → remaining=850', async () => {
      const session = {
        id: 'S-recon',
        date: new Date('2026-01-01'),
        kgConsumed: '100.000',
        kgOutputTotal: '100.000',
        varianceKg: '0.000',
        bagsOutput: [{ bagTypeId: 'bt1', qty: 10 }],
      };
      mockPrisma.packingSessionLot.findMany.mockResolvedValue([
        { lotId: 'LOT-RECON', kgUsed: '100.000', session },
      ]);
      mockPrisma.stockAdjustment.groupBy.mockResolvedValue([
        { lotId: 'LOT-RECON', _sum: { difference: '-50.000' } },
      ]);
      mockPrisma.stockLot.findUnique.mockResolvedValue({
        id: 'LOT-RECON', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '850.000',
      });

      const flow = await service.getLotMaterialFlow('LOT-RECON');

      expect(flow.received).toBe('1000.000');
      expect(flow.consumedPacking).toBe('100.000');
      expect(flow.consumedFillJobs).toBe('0.000');
      expect(flow.rawMaterialExitsKg).toBe('0.000');
      expect(flow.lotAdjustmentsKg).toBe('-50.000');
      expect(flow.remaining).toBe('850.000');

      // The reconciliation the fix restores: received - packing - fillJobs - rawExits +
      // adjustments = remaining.
      const reconciled = parseFloat(flow.received)
        - parseFloat(flow.consumedPacking)
        - parseFloat(flow.consumedFillJobs)
        - parseFloat(flow.rawMaterialExitsKg)
        + parseFloat(flow.lotAdjustmentsKg);
      expect(reconciled).toBe(parseFloat(flow.remaining));
    });

    it('only approved adjustments are included (status filter is applied server-side by the query)', async () => {
      // The service queries stockAdjustment.groupBy with status:'approved' in its `where` —
      // asserting the call shape here guards against silently including pending/rejected
      // adjustments, which have not been applied to kgRemaining yet.
      mockPrisma.packingSessionLot.findMany.mockResolvedValue([]);
      mockPrisma.stockLot.findUnique.mockResolvedValue({
        id: 'LOT-STATUS', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '1000.000',
      });
      await service.getLotMaterialFlow('LOT-STATUS');
      expect(mockPrisma.stockAdjustment.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ adjustmentType: 'lot', status: 'approved' }),
        }),
      );
    });

    it('container material flow sums lot-level adjustments across all of its lots, per-lot and in total', async () => {
      mockPrisma.packingSessionLot.findMany.mockResolvedValue([]);
      mockPrisma.stockAdjustment.groupBy.mockResolvedValue([
        { lotId: 'A', _sum: { difference: '-50.000' } },
        { lotId: 'B', _sum: { difference: '20.000' } },
      ]);
      mockPrisma.container.findUnique.mockResolvedValue({
        id: 'C-ADJ',
        stockLots: [
          { id: 'A', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '950.000' },
          { id: 'B', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '1020.000' },
        ],
      });

      const flow = await service.getContainerMaterialFlow('C-ADJ');

      expect(flow.lotAdjustmentsKg).toBe('-30.000'); // -50 + 20
      const a = flow.lots.find((l) => l.lotId === 'A')!;
      const b = flow.lots.find((l) => l.lotId === 'B')!;
      expect(a.lotAdjustmentsKg).toBe('-50.000');
      expect(b.lotAdjustmentsKg).toBe('20.000');
    });
  });

  describe('getLotMaterialFlow() — scenario 1: two lots, one session, A=40/B=60/output=100', () => {
    beforeEach(() => {
      twoLotSessionFixture();
    });

    it('attributes exactly 40kg consumed and 40kg output to lot A — never the full session total', async () => {
      mockPrisma.stockLot.findUnique.mockResolvedValue({
        id: 'A', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '960.000',
      });
      const flow = await service.getLotMaterialFlow('A');
      expect(flow.consumedPacking).toBe('40.000');
      expect(flow.packedOutput).toBe('40.000');
      expect(flow.packedOutput).not.toBe('100.000'); // the confirmed bug: must not show the full session output
    });

    it('attributes exactly 60kg consumed and 60kg output to lot B — never the full session total', async () => {
      mockPrisma.stockLot.findUnique.mockResolvedValue({
        id: 'B', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '940.000',
      });
      const flow = await service.getLotMaterialFlow('B');
      expect(flow.consumedPacking).toBe('60.000');
      expect(flow.packedOutput).toBe('60.000');
      expect(flow.packedOutput).not.toBe('100.000');
    });

    it('A + B allocated output sums to the real 100kg session output, not 200kg', async () => {
      mockPrisma.stockLot.findUnique.mockResolvedValueOnce({
        id: 'A', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '960.000',
      });
      const flowA = await service.getLotMaterialFlow('A');
      mockPrisma.stockLot.findUnique.mockResolvedValueOnce({
        id: 'B', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '940.000',
      });
      const flowB = await service.getLotMaterialFlow('B');

      const total = parseFloat(flowA.packedOutput) + parseFloat(flowB.packedOutput);
      expect(total).toBe(100);
      expect(total).not.toBe(200);
    });

    it('throws NotFoundException for a missing lot', async () => {
      mockPrisma.stockLot.findUnique.mockResolvedValue(null);
      await expect(service.getLotMaterialFlow('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getContainerMaterialFlow() — scenario 2: container holds both A and B', () => {
    beforeEach(() => {
      twoLotSessionFixture();
      mockPrisma.container.findUnique.mockResolvedValue({
        id: 'C1',
        stockLots: [
          { id: 'A', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '960.000' },
          { id: 'B', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '940.000' },
        ],
      });
    });

    it('counts the shared session once: input=100, output=100 — not 40+60+100=200', async () => {
      const flow = await service.getContainerMaterialFlow('C1');
      expect(flow.consumedPacking).toBe('100.000');
      expect(flow.packedOutput).toBe('100.000');
    });

    it('reports each lot\'s own share, summing back to the container total', async () => {
      const flow = await service.getContainerMaterialFlow('C1');
      const a = flow.lots.find((l) => l.lotId === 'A')!;
      const b = flow.lots.find((l) => l.lotId === 'B')!;
      expect(a.consumedPacking).toBe('40.000');
      expect(a.sharePct).toBe('40.0');
      expect(b.consumedPacking).toBe('60.000');
      expect(b.sharePct).toBe('60.0');
      expect(parseFloat(a.packedOutput) + parseFloat(b.packedOutput)).toBe(100);
    });

    it('throws NotFoundException for a missing container', async () => {
      mockPrisma.container.findUnique.mockResolvedValue(null);
      await expect(service.getContainerMaterialFlow('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getContainerMaterialFlow() — scenario 3: two separate sessions touching the same container', () => {
    it('sums both sessions once each, never double-counting either', async () => {
      const session1 = {
        id: 'S1', date: new Date('2026-01-01'), kgConsumed: '100.000', kgOutputTotal: '100.000',
        varianceKg: '0.000', bagsOutput: [{ bagTypeId: 'bt1', qty: 100 }],
      };
      const session2 = {
        id: 'S2', date: new Date('2026-01-02'), kgConsumed: '50.000', kgOutputTotal: '48.000',
        varianceKg: '2.000', bagsOutput: [{ bagTypeId: 'bt1', qty: 48 }],
      };
      mockPrisma.packingSessionLot.findMany.mockResolvedValue([
        { lotId: 'A', kgUsed: '40.000', session: session1 },
        { lotId: 'B', kgUsed: '60.000', session: session1 },
        { lotId: 'A', kgUsed: '50.000', session: session2 },
      ]);
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { lotId: 'A', sessionId: 'S1', quantity: 40, bagType: { nominalKg: '1.000' } },
        { lotId: 'B', sessionId: 'S1', quantity: 60, bagType: { nominalKg: '1.000' } },
        { lotId: 'A', sessionId: 'S2', quantity: 48, bagType: { nominalKg: '1.000' } },
      ]);
      mockPrisma.container.findUnique.mockResolvedValue({
        id: 'C1',
        stockLots: [
          { id: 'A', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '910.000' },
          { id: 'B', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '940.000' },
        ],
      });

      const flow = await service.getContainerMaterialFlow('C1');
      expect(flow.consumedPacking).toBe('150.000'); // 40+60+50, each session-lot row counted once
      expect(flow.packedOutput).toBe('148.000'); // 100 (S1) + 48 (S2)
      expect(flow.waste).toBe('2.000'); // only S2's positive variance
    });
  });

  describe('waste — positive vs. negative variance', () => {
    it('scenario 4: input=100, output=95 → waste=5kg, waste%=5.0', async () => {
      twoLotSessionFixture({ kgOutputTotal: '95.000', varianceKg: '5.000' });
      // Re-point PackedStock to the smaller output so allocation totals stay consistent.
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { lotId: 'A', sessionId: 'S1', quantity: 38, bagType: { nominalKg: '1.000' } },
        { lotId: 'B', sessionId: 'S1', quantity: 57, bagType: { nominalKg: '1.000' } },
      ]);
      mockPrisma.stockLot.findUnique.mockResolvedValue({
        id: 'A', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '960.000',
      });
      const flow = await service.getLotMaterialFlow('A');
      // A's share = 40/100 = 40% of the session's 5kg waste = 2kg
      expect(flow.waste).toBe('2.000');
      expect(flow.wastePct).toBe('5.0'); // 2kg waste / 40kg consumed by A = 5%
    });

    it('scenario 5: input=100, output=105 (negative variance) → waste is NOT reported as 5kg', async () => {
      twoLotSessionFixture({ kgOutputTotal: '105.000', varianceKg: '-5.000' });
      mockPrisma.stockLot.findUnique.mockResolvedValue({
        id: 'A', charcoalType: 'Oak', grade: 'A', kgReceived: '1000.000', kgRemaining: '960.000',
      });
      const flow = await service.getLotMaterialFlow('A');
      expect(flow.waste).toBe('0.000');
      expect(flow.wastePct).toBe('0.0');
    });
  });

  describe('scenario 6: zero/empty data — no NaN, no Infinity', () => {
    it('a lot with no packing sessions returns null percentages, not NaN', async () => {
      mockPrisma.packingSessionLot.findMany.mockResolvedValue([]);
      mockPrisma.stockLot.findUnique.mockResolvedValue({
        id: 'C', charcoalType: 'Oak', grade: 'A', kgReceived: '500.000', kgRemaining: '500.000',
      });
      const flow = await service.getLotMaterialFlow('C');
      expect(flow.consumedPacking).toBe('0.000');
      expect(flow.packedOutput).toBe('0.000');
      expect(flow.waste).toBe('0.000');
      expect(flow.wastePct).toBeNull();
      expect(flow.yieldPct).toBeNull();
      expect(flow.sessions).toEqual([]);
    });

    it('a container with no lots returns zeroed totals, not NaN', async () => {
      mockPrisma.container.findUnique.mockResolvedValue({ id: 'Empty', stockLots: [] });
      const flow = await service.getContainerMaterialFlow('Empty');
      expect(flow.received).toBe('0.000');
      expect(flow.consumedPacking).toBe('0.000');
      expect(flow.wastePct).toBeNull();
      expect(flow.yieldPct).toBeNull();
      expect(flow.lots).toEqual([]);
    });
  });
});
