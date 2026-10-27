import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

/** Per-lot, per-session breakdown of a packing session's contribution to one lot's material flow. */
export interface LotFlowSession {
  sessionId: string;
  date: string;
  bagCount: number;
  lotKgUsed: string; // Decimal — PackingSessionLot.kgUsed, this lot's real input to the session
  sessionKgConsumed: string; // Decimal — PackingSession.kgConsumed (session total, for reference only)
  sessionKgOutputTotal: string; // Decimal — PackingSession.kgOutputTotal (session total, for reference only)
  /** PackingSession.bagsOutput's raw (bagTypeId, qty) lines — a session can legitimately
   *  produce more than one bag type. Session-level, like bagCount, NOT apportioned by
   *  this lot's input share (bagsOutput has no per-lot breakdown), so this is the same
   *  full list for every lot that contributed to this session. */
  bagTypes: { bagTypeId: string; qty: number }[];
  sharePct: string; // this lot's kgUsed / session kgConsumed * 100
  /** HISTORICAL output — session.kgOutputTotal apportioned by this lot's input share. Fixed,
   *  immutable at packing time. NEVER derived from live PackedStock.quantity, which shrinks
   *  with every later sale/adjustment against that batch — see computeLotFlows()'s doc
   *  comment. This lot's share only — never the full session total. */
  allocatedOutputKg: string;
  allocatedWasteKg: string; // this lot's share of max(varianceKg, 0)
  /** CURRENT, live on-hand PackedStock kg still remaining from this exact (lot, session)
   *  batch. Informational only — a snapshot of today's inventory, not a production figure.
   *  Never added into packedOutput/waste/yield calculations. */
  currentBatchStockKg: string;
}

interface LotFlowAggregate {
  consumedPacking: Decimal;
  consumedFillJobs: Decimal;
  /** Σ StockAdjustment.difference WHERE adjustmentType='lot' AND lotId = this lot. Same
   *  sign convention as the write path (stock-adjustments.service.ts): difference =
   *  qtyAfter − qtyBefore, applied to StockLot.kgRemaining via `{ increment: difference }`.
   *  So a positive value is a stock GAIN, a negative value is a LOSS — added (not
   *  subtracted) when reconciling against `remaining`, see getLotMaterialFlow(). */
  lotAdjustments: Decimal;
  /** Raw-material exits: StockExit rows where StockExit.lotId = this lot (by-kg sales). */
  rawMaterialExits: Decimal;
  /** Finished-goods exits: StockExit rows where StockExit.packedStockId → PackedStock.lotId
   *  = this lot (bag sales drawn from this lot's packed batches). Never reduces
   *  StockLot.kgRemaining — that ledger is raw material only. Kept separate from
   *  rawMaterialExits so the UI can never present it as additional raw consumption. */
  packedBagSales: Decimal;
  /** Σ StockExit.amount across every raw-material AND finished-goods exit counted in
   *  rawMaterialExits/packedBagSales above — the authoritative, unbounded $ total for
   *  this lot's "Sales & exits" table, so the UI never has to reduce over a
   *  page-limited exit list (which undercounts once a lot has more exits than fit
   *  on one page). */
  totalExitAmount: Decimal;
  /** HISTORICAL total output — Σ per-session kgOutputTotal shares. See LotFlowSession. */
  packedOutput: Decimal;
  /** CURRENT total on-hand PackedStock kg for this lot, across all its batches. Informational
   *  only — see LotFlowSession.currentBatchStockKg. */
  currentPackedStock: Decimal;
  waste: Decimal;
  sessions: LotFlowSession[];
}

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Shared material-flow aggregation for one or more StockLots.
   *
   * CRITICAL AGGREGATION RULE: `PackingSession.kgOutputTotal` and `.varianceKg` are
   * SESSION-level fields — a session drawing from multiple lots stores its output/variance
   * ONCE, not once per lot. Reading them directly per lot (as the old Warehouse.tsx UI did)
   * makes a 40kg-A + 60kg-B / 100kg-output session appear as "100kg" on BOTH lots' pages —
   * 200kg total for 100kg of real output. This method never does that: every session-level
   * field is apportioned by `kgUsed / session.kgConsumed` (the lot's real, non-derived share
   * of that session's input) before being attributed to a lot.
   *
   * HISTORICAL OUTPUT: allocatedOutputKg is ALWAYS `session.kgOutputTotal * share` — the
   * fixed, immutable production figure recorded at packing time. It is deliberately NEVER
   * derived from live `PackedStock.quantity`, which is mutable on-hand inventory that
   * shrinks with every later sale (StockExit) or count correction (StockAdjustment) against
   * that specific batch. Using PackedStock.quantity as "output" would silently misreport
   * sold goods as production loss — confirmed against a real session where 20 bags (200kg)
   * of a 500kg batch had since been sold: PackedStock.quantity read 210kg while the true,
   * historical output remained 500kg. `currentPackedStock` is exposed separately, purely
   * informationally, and is never added into packedOutput/waste/yield.
   *
   * WASTE: `max(varianceKg, 0)` apportioned the same way, because `PackingSession.varianceKg`
   * is not measurable per lot (loss occurs after lots are physically mixed) — this is a
   * reasonable estimate, not a separately-recorded fact. Negative varianceKg (output
   * exceeded recorded input — overpack) is never reported as waste.
   *
   * Because `Σ(kgUsed/kgConsumed)` over a session's own lots is always exactly 1, summing
   * these per-lot allocations across every lot of a container reproduces the container's
   * true totals without ever double-counting a session that spans multiple lots of that
   * container — no separate "distinct session id" bookkeeping is required.
   *
   * SALES/EXITS: kept in two distinct categories, never merged:
   *   - rawMaterialExits: StockExit rows where StockExit.lotId = this lot (by-kg sales of
   *     raw charcoal). One of the writers of StockLot.kgRemaining.
   *   - packedBagSales: StockExit rows where StockExit.packedStockId → PackedStock.lotId =
   *     this lot (bag sales drawn from this lot's packed batches). These reduce
   *     PackedStock.quantity, never StockLot.kgRemaining — a structurally separate ledger.
   *
   * ADJUSTMENTS: lotAdjustments = Σ StockAdjustment.difference where adjustmentType='lot'
   * and status='approved' (only approved adjustments have actually been applied to
   * kgRemaining — see stock-adjustments.service.ts). Same sign convention as the write
   * path: a positive value is a stock gain, negative is a loss.
   *
   * RECONCILIATION: `received − consumedPacking − consumedFillJobs − rawMaterialExits +
   * lotAdjustments = remaining`, exactly — this is now the complete set of every writer of
   * StockLot.kgRemaining (packing, fill jobs, raw exits, adjustments).
   */
  private async computeLotFlows(lotIds: string[]): Promise<Map<string, LotFlowAggregate>> {
    const result = new Map<string, LotFlowAggregate>();
    if (lotIds.length === 0) return result;

    const [sessionLots, fillJobSums, rawExitSums, packedBagExits, packedStocks, lotAdjustmentSums] = await Promise.all([
      this.prisma.packingSessionLot.findMany({
        where: { lotId: { in: lotIds } },
        include: {
          session: {
            select: { id: true, date: true, kgConsumed: true, kgOutputTotal: true, varianceKg: true, bagsOutput: true },
          },
        },
      }),
      this.prisma.fillJobLot.groupBy({
        by: ['lotId'],
        where: { lotId: { in: lotIds } },
        _sum: { kgUsed: true },
      }),
      this.prisma.stockExit.groupBy({
        by: ['lotId'],
        where: { lotId: { in: lotIds } },
        _sum: { kgQuantity: true, amount: true },
      }),
      // Packed-bag exits reach this lot only via packedStock.lotId — StockExit.lotId is
      // null for these rows (see doc comment above). Filtered server-side via the relation.
      this.prisma.stockExit.findMany({
        where: { packedStockId: { not: null }, packedStock: { lotId: { in: lotIds } } },
        include: { bagType: true, packedStock: { select: { lotId: true } } },
      }),
      this.prisma.packedStock.findMany({
        where: { lotId: { in: lotIds } },
        include: { bagType: true },
      }),
      // Lot-level count corrections — same `difference` field/sign convention the write
      // path already applies to StockLot.kgRemaining (stock-adjustments.service.ts).
      // status:'approved' only — a 'pending' adjustment's difference has NOT been applied
      // to kgRemaining yet (see StockAdjustmentsService.create()/approve()), and 'rejected'
      // never will be; including either would break this exact reconciliation.
      this.prisma.stockAdjustment.groupBy({
        by: ['lotId'],
        where: { adjustmentType: 'lot', status: 'approved', lotId: { in: lotIds } },
        _sum: { difference: true },
      }),
    ]);

    // Index CURRENT (live) PackedStock kg by (lotId, sessionId) — informational only, see
    // doc comment above. Never used as historical output.
    const currentStockByLotSession = new Map<string, Decimal>();
    for (const ps of packedStocks) {
      const key = `${ps.lotId}:${ps.sessionId}`;
      const kg = new Decimal(ps.bagType.nominalKg.toString()).mul(ps.quantity);
      currentStockByLotSession.set(key, (currentStockByLotSession.get(key) ?? new Decimal(0)).plus(kg));
    }

    const fillJobByLot = new Map(
      fillJobSums.map((r) => [r.lotId, new Decimal(r._sum.kgUsed?.toString() ?? '0')]),
    );
    const rawExitByLot = new Map(
      rawExitSums.map((r) => [r.lotId as string, new Decimal(r._sum.kgQuantity?.toString() ?? '0')]),
    );
    const rawExitAmountByLot = new Map(
      rawExitSums.map((r) => [r.lotId as string, new Decimal(r._sum.amount?.toString() ?? '0')]),
    );
    const lotAdjustmentByLot = new Map(
      lotAdjustmentSums.map((r) => [r.lotId as string, new Decimal(r._sum.difference?.toString() ?? '0')]),
    );

    const packedBagSalesByLot = new Map<string, Decimal>();
    const packedBagSalesAmountByLot = new Map<string, Decimal>();
    for (const e of packedBagExits) {
      const lotId = e.packedStock?.lotId;
      if (!lotId) continue;
      const kg = e.bagType ? new Decimal(e.bagType.nominalKg.toString()).mul(e.quantity ?? 0) : new Decimal(0);
      packedBagSalesByLot.set(lotId, (packedBagSalesByLot.get(lotId) ?? new Decimal(0)).plus(kg));
      const amount = new Decimal(e.amount?.toString() ?? '0');
      packedBagSalesAmountByLot.set(lotId, (packedBagSalesAmountByLot.get(lotId) ?? new Decimal(0)).plus(amount));
    }

    const sessionLotsByLot = new Map<string, typeof sessionLots>();
    for (const sl of sessionLots) {
      const arr = sessionLotsByLot.get(sl.lotId) ?? [];
      arr.push(sl);
      sessionLotsByLot.set(sl.lotId, arr);
    }

    for (const lotId of lotIds) {
      let consumedPacking = new Decimal(0);
      let packedOutput = new Decimal(0);
      let currentPackedStock = new Decimal(0);
      let waste = new Decimal(0);
      const sessions: LotFlowSession[] = [];

      for (const sl of sessionLotsByLot.get(lotId) ?? []) {
        const session = sl.session;
        const kgUsed = new Decimal(sl.kgUsed.toString());
        const sessionKgConsumed = new Decimal(session.kgConsumed.toString());
        const sessionKgOutputTotal = new Decimal(session.kgOutputTotal.toString());
        const sessionVariance = new Decimal(session.varianceKg.toString());
        // Guard: kgConsumed <= 0 (should not occur — every session requires >=1 lot input —
        // but division must never NaN/Infinity a displayed percentage).
        const share = sessionKgConsumed.gt(0) ? kgUsed.div(sessionKgConsumed) : new Decimal(0);

        // HISTORICAL output — always session.kgOutputTotal * share. See doc comment above.
        const allocatedOutput = sessionKgOutputTotal.mul(share);

        // WASTE: max(varianceKg, 0) — negative variance (overpack) is never waste.
        const sessionWasteClamped = Decimal.max(sessionVariance, 0);
        const allocatedWaste = sessionWasteClamped.mul(share);

        // CURRENT batch stock — informational only, never folded into output/waste/yield.
        const currentBatchStock = currentStockByLotSession.get(`${lotId}:${session.id}`) ?? new Decimal(0);

        consumedPacking = consumedPacking.plus(kgUsed);
        packedOutput = packedOutput.plus(allocatedOutput);
        currentPackedStock = currentPackedStock.plus(currentBatchStock);
        waste = waste.plus(allocatedWaste);

        const bagsOutput = (session.bagsOutput as unknown as Array<{ bagTypeId: string; qty: number }>) ?? [];
        const bagCount = bagsOutput.reduce((s, b) => s + (b.qty ?? 0), 0);
        const bagTypes = bagsOutput.map((b) => ({ bagTypeId: b.bagTypeId, qty: b.qty ?? 0 }));

        sessions.push({
          sessionId: session.id,
          date: session.date.toISOString(),
          bagCount,
          bagTypes,
          lotKgUsed: kgUsed.toFixed(3),
          sessionKgConsumed: sessionKgConsumed.toFixed(3),
          sessionKgOutputTotal: sessionKgOutputTotal.toFixed(3),
          sharePct: share.mul(100).toFixed(1),
          allocatedOutputKg: allocatedOutput.toFixed(3),
          allocatedWasteKg: allocatedWaste.toFixed(3),
          currentBatchStockKg: currentBatchStock.toFixed(3),
        });
      }

      sessions.sort((a, b) => b.date.localeCompare(a.date));

      result.set(lotId, {
        consumedPacking,
        packedOutput,
        currentPackedStock,
        waste,
        consumedFillJobs: fillJobByLot.get(lotId) ?? new Decimal(0),
        lotAdjustments: lotAdjustmentByLot.get(lotId) ?? new Decimal(0),
        rawMaterialExits: rawExitByLot.get(lotId) ?? new Decimal(0),
        packedBagSales: packedBagSalesByLot.get(lotId) ?? new Decimal(0),
        totalExitAmount: (rawExitAmountByLot.get(lotId) ?? new Decimal(0))
          .plus(packedBagSalesAmountByLot.get(lotId) ?? new Decimal(0)),
        sessions,
      });
    }

    return result;
  }

  /**
   * Full material-flow breakdown for one StockLot: received, consumed (packing / fill jobs
   * / direct exits), packed output, waste, remaining, and the per-session allocation that
   * backs those totals (see computeLotFlows()'s doc comment for the anti-double-count rule).
   */
  async getLotMaterialFlow(lotId: string) {
    const lot = await this.prisma.stockLot.findUnique({ where: { id: lotId } });
    if (!lot) throw new NotFoundException({ error: 'Stock lot not found', code: 'NOT_FOUND' });

    const flows = await this.computeLotFlows([lotId]);
    const f = flows.get(lotId)!;

    const received = new Decimal(lot.kgReceived.toString());
    const remaining = new Decimal(lot.kgRemaining.toString());

    return {
      lotId,
      charcoalType: lot.charcoalType,
      grade: lot.grade,
      received: received.toFixed(3),
      consumedPacking: f.consumedPacking.toFixed(3),
      consumedFillJobs: f.consumedFillJobs.toFixed(3),
      lotAdjustmentsKg: f.lotAdjustments.toFixed(3),
      rawMaterialExitsKg: f.rawMaterialExits.toFixed(3),
      packedBagSalesKg: f.packedBagSales.toFixed(3),
      totalExitAmount: f.totalExitAmount.toFixed(2),
      packedOutput: f.packedOutput.toFixed(3),
      currentPackedStockKg: f.currentPackedStock.toFixed(3),
      waste: f.waste.toFixed(3),
      remaining: remaining.toFixed(3),
      wastePct: f.consumedPacking.gt(0) ? f.waste.div(f.consumedPacking).mul(100).toFixed(1) : null,
      yieldPct: f.consumedPacking.gt(0) ? f.packedOutput.div(f.consumedPacking).mul(100).toFixed(1) : null,
      sessions: f.sessions,
    };
  }

  /**
   * Container-level material flow, rolled up from every StockLot belonging to the
   * container. Because each lot's consumed/output/waste figures are already correctly
   * apportioned per-session (see computeLotFlows()), summing them across the container's
   * lots reproduces the container's true totals — a session spanning two of the
   * container's own lots is counted exactly once, split by each lot's real share, never
   * once per lot.
   */
  async getContainerMaterialFlow(containerId: string) {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
      include: { stockLots: true },
    });
    if (!container) throw new NotFoundException({ error: 'Container not found', code: 'NOT_FOUND' });

    const lots = container.stockLots;
    const flows = await this.computeLotFlows(lots.map((l) => l.id));

    let received = new Decimal(0);
    let remaining = new Decimal(0);
    let consumedPacking = new Decimal(0);
    let consumedFillJobs = new Decimal(0);
    let lotAdjustments = new Decimal(0);
    let rawMaterialExits = new Decimal(0);
    let packedBagSales = new Decimal(0);
    let packedOutput = new Decimal(0);
    let currentPackedStock = new Decimal(0);
    let waste = new Decimal(0);

    const lotRows = lots.map((lot) => {
      const f = flows.get(lot.id)!;
      const lotReceived = new Decimal(lot.kgReceived.toString());
      const lotRemaining = new Decimal(lot.kgRemaining.toString());

      received = received.plus(lotReceived);
      remaining = remaining.plus(lotRemaining);
      consumedPacking = consumedPacking.plus(f.consumedPacking);
      consumedFillJobs = consumedFillJobs.plus(f.consumedFillJobs);
      lotAdjustments = lotAdjustments.plus(f.lotAdjustments);
      rawMaterialExits = rawMaterialExits.plus(f.rawMaterialExits);
      packedBagSales = packedBagSales.plus(f.packedBagSales);
      packedOutput = packedOutput.plus(f.packedOutput);
      currentPackedStock = currentPackedStock.plus(f.currentPackedStock);
      waste = waste.plus(f.waste);

      return {
        lotId: lot.id,
        charcoalType: lot.charcoalType,
        grade: lot.grade,
        received: lotReceived.toFixed(3),
        consumedPacking: f.consumedPacking.toFixed(3),
        lotAdjustmentsKg: f.lotAdjustments.toFixed(3),
        packedOutput: f.packedOutput.toFixed(3),
        currentPackedStockKg: f.currentPackedStock.toFixed(3),
        waste: f.waste.toFixed(3),
        remaining: lotRemaining.toFixed(3),
        yieldPct: f.consumedPacking.gt(0) ? f.packedOutput.div(f.consumedPacking).mul(100).toFixed(1) : null,
      };
    });

    // Second pass: each lot's share of the CONTAINER's total packing input (needs the
    // container total, only known after summing every lot above).
    const lots_ = lotRows.map((r) => ({
      ...r,
      sharePct: consumedPacking.gt(0)
        ? new Decimal(r.consumedPacking).div(consumedPacking).mul(100).toFixed(1)
        : null,
    }));

    return {
      containerId,
      received: received.toFixed(3),
      consumedPacking: consumedPacking.toFixed(3),
      consumedFillJobs: consumedFillJobs.toFixed(3),
      lotAdjustmentsKg: lotAdjustments.toFixed(3),
      rawMaterialExitsKg: rawMaterialExits.toFixed(3),
      packedBagSalesKg: packedBagSales.toFixed(3),
      packedOutput: packedOutput.toFixed(3),
      currentPackedStockKg: currentPackedStock.toFixed(3),
      waste: waste.toFixed(3),
      remaining: remaining.toFixed(3),
      wastePct: consumedPacking.gt(0) ? waste.div(consumedPacking).mul(100).toFixed(1) : null,
      yieldPct: consumedPacking.gt(0) ? packedOutput.div(consumedPacking).mul(100).toFixed(1) : null,
      lots: lots_,
    };
  }

  /**
   * Compute a live warehouse snapshot.
   *
   * CONSTRAINT 12: estimatedTotalValue is omitted for sales_rep and worker roles.
   *
   * @param userRole - Role used for cost-field stripping
   */
  async getSummary(userRole?: string) {
    // Fetch all active stock lots (raw charcoal)
    const activeLots = await this.prisma.stockLot.findMany({
      where: { kgRemaining: { gt: 0 } },
    });

    // Compute totalRawKg and estimatedTotalValue (all arithmetic via decimal.js)
    let totalRawKg = new Decimal(0);
    let estimatedTotalValue = new Decimal(0);

    for (const lot of activeLots) {
      const remaining = new Decimal(lot.kgRemaining.toString());
      totalRawKg = totalRawKg.plus(remaining);
      estimatedTotalValue = estimatedTotalValue.plus(
        remaining.mul(new Decimal(lot.costPerKg.toString())),
      );
    }

    // Fetch all packed stocks with quantity > 0
    const packedStocks = await this.prisma.packedStock.findMany({
      where: { quantity: { gt: 0 } },
      include: { bagType: true },
    });

    // Compute totalPackedNominalKg and per-bagType summary
    let totalPackedNominalKg = new Decimal(0);
    const bagTypeTotals = new Map<
      string,
      { bagTypeName: string; totalBags: number; totalNominalKg: Decimal }
    >();

    for (const ps of packedStocks) {
      const nominalKg = new Decimal(ps.bagType.nominalKg.toString()).mul(ps.quantity);
      totalPackedNominalKg = totalPackedNominalKg.plus(nominalKg);

      const existing = bagTypeTotals.get(ps.bagTypeId);
      if (existing) {
        existing.totalBags += ps.quantity;
        existing.totalNominalKg = existing.totalNominalKg.plus(nominalKg);
      } else {
        bagTypeTotals.set(ps.bagTypeId, {
          bagTypeName: ps.bagType.name,
          totalBags: ps.quantity,
          totalNominalKg: nominalKg,
        });
      }
    }

    const totalSystemKg = totalRawKg.plus(totalPackedNominalKg);

    const packedSummary = Array.from(bagTypeTotals.entries()).map(
      ([bagTypeId, entry]) => ({
        bagTypeId,
        bagTypeName: entry.bagTypeName,
        totalBags: entry.totalBags,
        totalNominalKg: entry.totalNominalKg.toFixed(3),
      }),
    );

    const result: Record<string, unknown> = {
      totalRawKg: totalRawKg.toFixed(3),
      totalPackedNominalKg: totalPackedNominalKg.toFixed(3),
      totalSystemKg: totalSystemKg.toFixed(3),
      lotCount: activeLots.length,
      packedSummary,
    };

    // CONSTRAINT 12: strip estimatedTotalValue for restricted roles
    if (userRole !== 'sales_rep' && userRole !== 'worker') {
      result.estimatedTotalValue = estimatedTotalValue.toFixed(2);
    }

    return result;
  }
}
