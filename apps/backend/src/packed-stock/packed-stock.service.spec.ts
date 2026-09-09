import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PackedStockService } from './packed-stock.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }

describe('PackedStockService', () => {
  let service: PackedStockService;

  const mockPrisma = {
    packedStock: { findMany: fn(), count: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackedStockService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<PackedStockService>(PackedStockService);
  });

  const BAG_TYPE = 'bagtype-1';

  // Builds N mock PackedStock rows, each with `quantity` free bags and no
  // reservations, already in the createdAt-ascending order the real
  // findMany({orderBy:{createdAt:'asc'}}) query would return.
  function makeRecords(count: number, quantityEach: number, reservedEach = 0) {
    return Array.from({ length: count }, (_, i) => ({
      id: `ps-${i + 1}`,
      quantity: quantityEach,
      reservedQuantity: reservedEach,
    }));
  }

  // =========================================================================
  // getFifoDraw() — server-side FIFO draw plan, unbounded per bag type.
  // Replaces WarehouseSales.tsx's previous client-side computation over a
  // limit:200-capped fetch.
  // =========================================================================

  describe('getFifoDraw()', () => {
    it('normal FIFO ordering: draws from the oldest (first) record before newer ones', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue(
        makeRecords(3, 10), // ps-1, ps-2, ps-3, each 10 free bags, already createdAt-asc ordered
      );
      const result = await service.getFifoDraw(BAG_TYPE, 15);
      expect(result.draws).toEqual([
        { packedStockId: 'ps-1', quantity: 10 },
        { packedStockId: 'ps-2', quantity: 5 },
      ]);
      expect(result.fulfilled).toBe(true);
    });

    it('exact stock quantity: consuming precisely all available stock still succeeds with remaining = 0', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue(makeRecords(2, 10)); // 20 total
      const result = await service.getFifoDraw(BAG_TYPE, 20);
      expect(result.fulfilled).toBe(true);
      expect(result.draws.reduce((s, d) => s + d.quantity, 0)).toBe(20);
    });

    it('insufficient stock still correctly fails (fulfilled: false) and reports true available total', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue(makeRecords(2, 10)); // 20 total
      const result = await service.getFifoDraw(BAG_TYPE, 25);
      expect(result.fulfilled).toBe(false);
      expect(result.available).toBe(20);
      // Still draws everything that IS available — caller decides what to do with a partial plan.
      expect(result.draws.reduce((s, d) => s + d.quantity, 0)).toBe(20);
    });

    it('multiple records are consumed in the existing createdAt-ascending order, not reordered', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { id: 'oldest', quantity: 3, reservedQuantity: 0 },
        { id: 'middle', quantity: 3, reservedQuantity: 0 },
        { id: 'newest', quantity: 3, reservedQuantity: 0 },
      ]);
      const result = await service.getFifoDraw(BAG_TYPE, 7);
      expect(result.draws.map((d) => d.packedStockId)).toEqual(['oldest', 'middle', 'newest']);
      expect(result.draws.map((d) => d.quantity)).toEqual([3, 3, 1]);
    });

    it('no duplicate consumption: a record never contributes more than its own free quantity, and is skipped once remaining is satisfied', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue(makeRecords(5, 10)); // 50 total, plenty of headroom
      const result = await service.getFifoDraw(BAG_TYPE, 12);
      // Only the first 2 records should appear at all.
      expect(result.draws).toHaveLength(2);
      expect(result.draws).toEqual([
        { packedStockId: 'ps-1', quantity: 10 },
        { packedStockId: 'ps-2', quantity: 2 },
      ]);
      const totalDrawn = result.draws.reduce((s, d) => s + d.quantity, 0);
      expect(totalDrawn).toBe(12);
    });

    it('reserved quantity is excluded — draws only free stock (quantity − reservedQuantity), matching BUG-E (P2)', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { id: 'ps-1', quantity: 10, reservedQuantity: 7 }, // 3 free
      ]);
      const result = await service.getFifoDraw(BAG_TYPE, 3);
      expect(result.fulfilled).toBe(true);
      expect(result.draws).toEqual([{ packedStockId: 'ps-1', quantity: 3 }]);
    });

    it('a fully-reserved record (0 free) is skipped entirely, drawing from the next one instead', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { id: 'fully-reserved', quantity: 10, reservedQuantity: 10 },
        { id: 'available', quantity: 5, reservedQuantity: 0 },
      ]);
      const result = await service.getFifoDraw(BAG_TYPE, 5);
      expect(result.draws).toEqual([{ packedStockId: 'available', quantity: 5 }]);
    });

    it('scalability: draws correctly from records beyond the OLD limit:200 cap — 250 records of 1 bag each, requesting 210, must reach records past #200', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue(makeRecords(250, 1));
      const result = await service.getFifoDraw(BAG_TYPE, 210);
      expect(result.fulfilled).toBe(true);
      expect(result.draws).toHaveLength(210);
      // The 201st through 210th draws prove records past the old 200-row cap were reached.
      expect(result.draws[200]).toEqual({ packedStockId: 'ps-201', quantity: 1 });
      expect(result.draws[209]).toEqual({ packedStockId: 'ps-210', quantity: 1 });
      // The query itself is unbounded — no take/limit passed to findMany.
      const args = mockPrisma.packedStock.findMany.mock.calls[0][0];
      expect(args.take).toBeUndefined();
      expect(args.skip).toBeUndefined();
    });

    it('scalability: stock that only exists past record #200 is still found and fulfills the sale (the exact bug this fix resolves)', async () => {
      // First 200 records are fully reserved (0 free) — under the old
      // limit:200 client-side fetch, this bag type would have looked
      // completely out of stock. Records 201-205 carry the real free stock.
      const exhausted = makeRecords(200, 5, 5); // 200 records, 5 qty each, fully reserved → 0 free
      const realStock = makeRecords(5, 4).map((r, i) => ({ ...r, id: `real-${i + 1}` })); // 5 records × 4 free = 20
      mockPrisma.packedStock.findMany.mockResolvedValue([...exhausted, ...realStock]);
      const result = await service.getFifoDraw(BAG_TYPE, 15);
      expect(result.fulfilled).toBe(true);
      expect(result.available).toBe(20);
      expect(result.draws.every((d) => d.packedStockId.startsWith('real-'))).toBe(true);
    });

    it('existing (≤200-record) behavior is unchanged — small-scale request still resolves identically to before', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue(makeRecords(3, 10));
      const result = await service.getFifoDraw(BAG_TYPE, 5);
      expect(result).toEqual({
        draws: [{ packedStockId: 'ps-1', quantity: 5 }],
        fulfilled: true,
        requested: 5,
        available: 30,
      });
    });

    it('query is scoped to the requested bagTypeId only, and orders deterministically (forensic audit, 2026-08-29)', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([]);
      await service.getFifoDraw(BAG_TYPE, 5);
      const args = mockPrisma.packedStock.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ bagTypeId: BAG_TYPE });
      // createdAt ASC first (unchanged — the real signal across different
      // packing runs), then lot.dateReceived/lot.createdAt/id as tiebreakers
      // for sibling PackedStock rows a single packing session creates with
      // an identical createdAt (real-Postgres proof in
      // test/fifo-draw-order.integration-spec.ts — a mocked findMany here
      // can't exercise Postgres's own tie-break behavior).
      expect(args.orderBy).toEqual([
        { createdAt: 'asc' },
        { lot: { dateReceived: 'asc' } },
        { lot: { createdAt: 'asc' } },
        { id: 'asc' },
      ]);
    });

    // =======================================================================
    // Explicit multi-source allocation matrix (forensic audit, 2026-08-29).
    // getFifoDraw() itself is order-agnostic about WHY records arrive in a
    // given sequence — that's Postgres's job (proven separately in
    // fifo-draw-order.integration-spec.ts). These test the greedy
    // consumption arithmetic given an already-correctly-ordered record list.
    // =======================================================================

    it('Case 1: 200 available in one row, requesting 200 → one source, fully satisfied', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([{ id: 'row-1', quantity: 200, reservedQuantity: 0 }]);
      const result = await service.getFifoDraw(BAG_TYPE, 200);
      expect(result.draws).toEqual([{ packedStockId: 'row-1', quantity: 200 }]);
      expect(result.fulfilled).toBe(true);
    });

    it('Case 2: 100 + 100 available, requesting 200 → 100 + 100', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { id: 'row-1', quantity: 100, reservedQuantity: 0 },
        { id: 'row-2', quantity: 100, reservedQuantity: 0 },
      ]);
      const result = await service.getFifoDraw(BAG_TYPE, 200);
      expect(result.draws).toEqual([
        { packedStockId: 'row-1', quantity: 100 },
        { packedStockId: 'row-2', quantity: 100 },
      ]);
      expect(result.fulfilled).toBe(true);
    });

    it('Case 3: 50 + 50 + 100 available, requesting 200 → 50 + 50 + 100', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { id: 'row-1', quantity: 50, reservedQuantity: 0 },
        { id: 'row-2', quantity: 50, reservedQuantity: 0 },
        { id: 'row-3', quantity: 100, reservedQuantity: 0 },
      ]);
      const result = await service.getFifoDraw(BAG_TYPE, 200);
      expect(result.draws).toEqual([
        { packedStockId: 'row-1', quantity: 50 },
        { packedStockId: 'row-2', quantity: 50 },
        { packedStockId: 'row-3', quantity: 100 },
      ]);
      expect(result.fulfilled).toBe(true);
    });

    it('Case 4: 150 + 100 available, requesting 200 → 150 + 50 (partial draw from the second source only)', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { id: 'row-1', quantity: 150, reservedQuantity: 0 },
        { id: 'row-2', quantity: 100, reservedQuantity: 0 },
      ]);
      const result = await service.getFifoDraw(BAG_TYPE, 200);
      expect(result.draws).toEqual([
        { packedStockId: 'row-1', quantity: 150 },
        { packedStockId: 'row-2', quantity: 50 },
      ]);
      expect(result.fulfilled).toBe(true);
      // row-2 still has 50 free left over — proves this wasn't drained fully.
    });

    it('Case 8: insufficient total stock across every row → fulfilled false, no throw, no partial write (this method is read-only/advisory)', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        { id: 'row-1', quantity: 50, reservedQuantity: 0 },
        { id: 'row-2', quantity: 50, reservedQuantity: 0 },
      ]);
      const result = await service.getFifoDraw(BAG_TYPE, 200);
      expect(result.fulfilled).toBe(false);
      expect(result.available).toBe(100);
      // getFifoDraw() never calls .update()/.decrement() — verified by the
      // mock setup, which only stubs findMany. The actual atomic
      // validate-then-decrement + zero-partial-effects guarantee lives in
      // the caller's transaction (WalkInSalesService.create() /
      // ShipmentsService.drainPackedStockDirect()), tested in their own specs.
    });

    it('zero available stock: draws is empty, fulfilled false, available 0 — does not throw', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([]);
      const result = await service.getFifoDraw(BAG_TYPE, 10);
      expect(result).toEqual({ draws: [], fulfilled: false, requested: 10, available: 0 });
    });
  });

  // =========================================================================
  // findSummary() — lotCount (Warehouse → Packed goods detail-view audit).
  // Powers the "N lots" figure on the packed-good card, previously hardcoded
  // to 0 on the frontend regardless of real data.
  // =========================================================================

  describe('findSummary() — lotCount', () => {
    function ps(lotId: string, bagTypeId: string, bagTypeName: string, quantity: number, nominalKg = '2.000') {
      return { lotId, bagTypeId, quantity, reservedQuantity: 0, bagType: { name: bagTypeName, nominalKg } };
    }

    it('counts each distinct source lot once per bag type', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        ps('lot-1', 'bt-1', '2kg Bag', 10),
        ps('lot-2', 'bt-1', '2kg Bag', 5),
        ps('lot-3', 'bt-1', '2kg Bag', 8),
      ]);
      const [row] = await service.findSummary();
      expect(row.lotCount).toBe(3);
      expect(row.totalBags).toBe(23);
    });

    it('the SAME lot contributing multiple PackedStock rows (two separate packing sessions) is counted ONCE, not once per row', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        ps('lot-1', 'bt-1', '2kg Bag', 10),
        ps('lot-1', 'bt-1', '2kg Bag', 7), // same lot, a later session
      ]);
      const [row] = await service.findSummary();
      expect(row.lotCount).toBe(1);
      expect(row.totalBags).toBe(17);
    });

    it('lot counts are scoped per bag type — a lot contributing to two bag types counts once for each', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([
        ps('lot-1', 'bt-1', '2kg Bag', 10),
        ps('lot-1', 'bt-2', '5kg Bag', 4),
      ]);
      const rows = await service.findSummary();
      expect(rows.find((r) => r.bagTypeId === 'bt-1')?.lotCount).toBe(1);
      expect(rows.find((r) => r.bagTypeId === 'bt-2')?.lotCount).toBe(1);
    });

    it('no packed stock at all → empty result, no throw', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([]);
      const rows = await service.findSummary();
      expect(rows).toEqual([]);
    });

    it('only counts rows with quantity > 0 (the existing where-filter, unchanged)', async () => {
      mockPrisma.packedStock.findMany.mockResolvedValue([ps('lot-1', 'bt-1', '2kg Bag', 6)]);
      await service.findSummary();
      const args = mockPrisma.packedStock.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ quantity: { gt: 0 } });
    });
  });

  // =========================================================================
  // findAll() — the paginated GET /packed-stock listing (Warehouse → Packed
  // goods "by source lot" table + detail-view source lots).
  // =========================================================================

  describe('findAll()', () => {
    beforeEach(() => {
      // findMany's return value is irrelevant here (only its CALL ARGS are
      // inspected) — $transaction itself is what the service awaits for the
      // actual [rows, total] pair, per each test's own mockResolvedValue.
      mockPrisma.packedStock.findMany.mockReturnValue(Promise.resolve([]));
      mockPrisma.packedStock.count.mockReturnValue(Promise.resolve(0));
    });

    it('includes bagType, lot, and the packing session date — the exact fields the Warehouse detail view/source-lot table need', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);
      await service.findAll(1, 20);
      const findManyArgs = mockPrisma.packedStock.findMany.mock.calls[0][0];
      expect(findManyArgs.include).toEqual({
        bagType: true,
        lot: true,
        session: { select: { date: true } },
      });
    });

    it('paginates with the given page/limit and returns total for page-count math', async () => {
      const rows = [{ id: 'ps-1', lot: {}, bagType: { nominalKg: '2.000' } }];
      mockPrisma.$transaction.mockResolvedValue([rows, 47]);
      const result = await service.findAll(2, 20);
      expect(result).toEqual({ data: rows, total: 47, page: 2, limit: 20 });
    });

    it('computes skip from page/limit (page 3, limit 20 → skip 40)', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);
      await service.findAll(3, 20);
      const findManyArgs = mockPrisma.packedStock.findMany.mock.calls[0][0];
      expect(findManyArgs.skip).toBe(40);
      expect(findManyArgs.take).toBe(20);
    });

    it('filters by bagTypeId when provided (detail-view source-lot list)', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);
      await service.findAll(1, 100, undefined, 'bt-1');
      const findManyArgs = mockPrisma.packedStock.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({ bagTypeId: 'bt-1' });
    });

    it('with no filters, where is empty — every batch is returned (a fully-depleted, quantity:0 batch included, unlike findSummary())', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);
      await service.findAll(1, 20);
      const findManyArgs = mockPrisma.packedStock.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({});
    });

    // =======================================================================
    // CONSTRAINT 12 cost-field stripping — bagType.costPerBag/workerRate must
    // be hidden from sales_rep/worker on this endpoint exactly as
    // BagTypesService already hides the identical two fields on GET
    // /bag-types, and exactly as this same method already hides
    // lot.costPerKg. Regression coverage for a real gap found live: worker/
    // sales_rep received bagType.costPerBag/workerRate unredacted from GET
    // /packed-stock even though every sibling cost-bearing path strips them.
    // =======================================================================

    it('strips bagType.costPerBag/workerRate for a worker caller', async () => {
      const row = { id: 'ps-1', lot: { costPerKg: '0.50' }, bagType: { name: '2kg Bag', nominalKg: '2', costPerBag: '0.05', workerRate: '0.10' } };
      mockPrisma.$transaction.mockResolvedValue([[row], 1]);
      const result = await service.findAll(1, 20, undefined, undefined, 'worker');
      expect(result.data[0].bagType).toEqual({ name: '2kg Bag', nominalKg: '2' });
      expect(result.data[0].lot).toEqual({});
    });

    it('strips bagType.costPerBag/workerRate for a sales_rep caller', async () => {
      const row = { id: 'ps-1', lot: {}, bagType: { name: '2kg Bag', nominalKg: '2', costPerBag: '0.05', workerRate: '0.10' } };
      mockPrisma.$transaction.mockResolvedValue([[row], 1]);
      const result = await service.findAll(1, 20, undefined, undefined, 'sales_rep');
      expect(result.data[0].bagType).not.toHaveProperty('costPerBag');
      expect(result.data[0].bagType).not.toHaveProperty('workerRate');
    });

    it('does NOT strip bagType cost fields for owner/accountant', async () => {
      const row = { id: 'ps-1', lot: {}, bagType: { name: '2kg Bag', nominalKg: '2', costPerBag: '0.05', workerRate: '0.10' } };
      mockPrisma.$transaction.mockResolvedValue([[row], 1]);
      const ownerResult = await service.findAll(1, 20, undefined, undefined, 'owner');
      expect(ownerResult.data[0].bagType).toEqual({ name: '2kg Bag', nominalKg: '2', costPerBag: '0.05', workerRate: '0.10' });
      const accountantResult = await service.findAll(1, 20, undefined, undefined, 'accountant');
      expect(accountantResult.data[0].bagType).toHaveProperty('costPerBag');
    });

    it('a row with no bagType included does not throw when stripping', async () => {
      const row = { id: 'ps-1', lot: { costPerKg: '0.50' }, bagType: null };
      mockPrisma.$transaction.mockResolvedValue([[row], 1]);
      const result = await service.findAll(1, 20, undefined, undefined, 'worker');
      expect(result.data[0].bagType).toBeNull();
    });

    // =======================================================================
    // Mixed source-lot type/grade regression (Warehouse → Packed goods →
    // "Source lots" detail panel). A StockLot itself is single type/grade,
    // but one bag type's packing history routinely draws from SEVERAL
    // distinct lots — including the same lot again on a later date — each
    // carrying its own type/grade. findAll() must return one row per real
    // PackedStock record, each with its OWN nested `lot`, never collapsed/
    // deduped/reduced to a single representative type or grade. Shape below
    // is the exact real dev-data case behind the "2kg Bag" bug report: 3
    // distinct lots, 6 packing records (one lot repeats across 3 dates).
    // =======================================================================

    it('mixed source lots: every packing record keeps its OWN lot.charcoalType/grade — nothing is merged into one representative value', async () => {
      const rows = [
        { id: 'ps-1', lotId: 'lot-6517f36c', lot: { charcoalType: 'BBQ hardwood', grade: 'B' }, bagType: { nominalKg: '2.000' }, quantity: 360 },
        { id: 'ps-2', lotId: 'lot-00000000', lot: { charcoalType: 'BBQ hardwood', grade: 'A' }, bagType: { nominalKg: '2.000' }, quantity: 320 },
        { id: 'ps-3', lotId: 'lot-85e6a61a', lot: { charcoalType: 'BBQ Hardwood', grade: 'A' }, bagType: { nominalKg: '2.000' }, quantity: 320 },
        { id: 'ps-4', lotId: 'lot-6517f36c', lot: { charcoalType: 'BBQ hardwood', grade: 'B' }, bagType: { nominalKg: '2.000' }, quantity: 51 },
        { id: 'ps-5', lotId: 'lot-85e6a61a', lot: { charcoalType: 'BBQ Hardwood', grade: 'A' }, bagType: { nominalKg: '2.000' }, quantity: 49 },
        { id: 'ps-6', lotId: 'lot-6517f36c', lot: { charcoalType: 'BBQ hardwood', grade: 'B' }, bagType: { nominalKg: '2.000' }, quantity: 80 },
      ];
      mockPrisma.$transaction.mockResolvedValue([rows, rows.length]);
      const result = await service.findAll(1, 100, undefined, 'bt-2kg', 'owner');

      // All 6 real packing records survive — none dropped, none merged.
      expect(result.data).toHaveLength(6);
      expect(result.data.map((r: any) => r.id)).toEqual(['ps-1', 'ps-2', 'ps-3', 'ps-4', 'ps-5', 'ps-6']);
      // The repeated lot (lot-6517f36c, 3 separate packing dates) keeps its own
      // row each time — never collapsed into a single "lot-6517f36c" entry.
      const repeatedLotRows = result.data.filter((r: any) => r.lotId === 'lot-6517f36c');
      expect(repeatedLotRows).toHaveLength(3);
      // Every row still carries its own lot's real type/grade, unaltered.
      expect(result.data.map((r: any) => `${r.lot.charcoalType}|${r.lot.grade}`)).toEqual([
        'BBQ hardwood|B',
        'BBQ hardwood|A',
        'BBQ Hardwood|A',
        'BBQ hardwood|B',
        'BBQ Hardwood|A',
        'BBQ hardwood|B',
      ]);
    });
  });
});
