import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

/** A single charcoal input line: kg taken from one stock lot. `kg` may be a string or number. */
export interface LotConsumptionInput {
  lotId: string;
  kg: string | number;
}

/** Aggregated, validated per-lot consumption returned by {@link consumeLots}. */
export interface ConsumedLot {
  lotId: string;
  /** Total kg consumed from this lot across all input lines (already summed). */
  kg: Decimal;
  /** Lot cost per kg snapshotted at consumption time (for COGS / fill pricing). */
  costPerKg: Decimal;
}

/**
 * Shared "consume-lots" primitive used by BOTH packing sessions and fill jobs.
 *
 * Enforces the inventory invariant that a lot's `kgRemaining` is reduced ONLY by the
 * per-lot input weight — never a session total, bag output, or a separate waste step.
 *
 * Inside the caller's transaction it:
 *   1. AGGREGATES inputs by lotId (duplicate lotIds are summed into one total), so a
 *      lot referenced twice deducts the sum once — no lost update.
 *   1b. LOCKS every distinct lot row with SELECT ... FOR UPDATE (sorted by id, one
 *      statement) before reading — mirrors stock-exits.service.ts's row-locking
 *      pattern so a concurrent consumer of the same lot cannot validate against a
 *      stale pre-deduction kgRemaining.
 *   2. Fetches each distinct lot (404 if any missing).
 *   3. VALIDATES each aggregated total <= lot.kgRemaining (400 CONSTRAINT_VIOLATION).
 *   4. DEDUCTS with an ATOMIC Prisma `{ decrement }` per distinct lot — never a stale
 *      read-modify-write — mirroring the pattern in stock-exits.service.ts.
 *
 * The returned aggregated totals are the single source of truth the caller MUST use to
 * write junction rows and audit records, so the deducted numbers and the recorded
 * numbers can never diverge.
 *
 * @param tx     An open Prisma transaction client (call inside `prisma.$transaction`).
 * @param inputs Raw per-line lot inputs; duplicates by lotId are allowed and summed.
 * @returns      One {@link ConsumedLot} per DISTINCT lotId, carrying the summed kg and snapshot costPerKg.
 * @throws NotFoundException     if any referenced lot does not exist (code NOT_FOUND).
 * @throws BadRequestException   if any aggregated total exceeds kgRemaining (code CONSTRAINT_VIOLATION).
 */
export async function consumeLots(
  tx: Prisma.TransactionClient,
  inputs: LotConsumptionInput[],
): Promise<ConsumedLot[]> {
  // Step 1: Aggregate by lotId — duplicate lotIds collapse into a single summed total.
  const totalsByLot = new Map<string, Decimal>();
  for (const inp of inputs) {
    const prev = totalsByLot.get(inp.lotId) ?? new Decimal(0);
    totalsByLot.set(inp.lotId, prev.plus(new Decimal(inp.kg.toString())));
  }

  const lotIds = [...totalsByLot.keys()].sort();

  // Step 1b: Lock every distinct target row BEFORE reading — same FOR UPDATE
  // pattern already used by stock-exits.service.ts / payments.service.ts /
  // payment-allocation.service.ts, extended to multiple rows in ONE
  // statement, sorted ascending by id (never locked one-by-one in caller
  // order) so every transaction that locks stock_lots rows — this one, or a
  // concurrent packing session / fill job / walk-in sale — acquires them in
  // the same deterministic order and cannot deadlock against another. Once
  // held, a concurrent consumer of the same lot is forced to wait until this
  // transaction commits or rolls back, so the read below can never be stale.
  if (lotIds.length > 0) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "stock_lots" WHERE id IN (${Prisma.join(lotIds)}) ORDER BY id FOR UPDATE`,
    );
  }

  // Step 2: Fetch each distinct lot.
  const lots = await tx.stockLot.findMany({ where: { id: { in: lotIds } } });
  const lotMap = new Map(lots.map((l) => [l.id, l]));

  const result: ConsumedLot[] = [];

  // Step 3: Validate each aggregated total is positive and <= kgRemaining.
  for (const [lotId, total] of totalsByLot) {
    const lot = lotMap.get(lotId);
    if (!lot) {
      throw new NotFoundException({ error: `Stock lot not found: ${lotId}`, code: 'NOT_FOUND' });
    }
    // A non-positive aggregated total would flip Step 4's atomic
    // `{ decrement: total }` below into an INCREMENT (Prisma applies the
    // decrement literally) — silently fabricating raw stock from a
    // packing session or fill job whose lotInputs[].kg was zero/negative.
    // No caller (LotInputDto here has no @Min — see the positivity-gap
    // audit) currently enforces this above the primitive, so it is
    // enforced here, at the single choke point every consumer shares.
    if (!total.gt(0)) {
      throw new BadRequestException({
        message: `kgUsed for lot ${lotId} must be greater than zero (got ${total.toFixed(3)})`,
        error: 'kgUsed must be greater than zero',
        code: 'CONSTRAINT_VIOLATION',
      });
    }
    if (total.gt(lot.kgRemaining.toString())) {
      throw new BadRequestException({
        message: `kgUsed (${total.toFixed(3)}) exceeds lot kgRemaining (${lot.kgRemaining}) for lot ${lotId}`,
        error: 'kgUsed exceeds lot kgRemaining',
        code: 'CONSTRAINT_VIOLATION',
      });
    }
    result.push({
      lotId,
      kg: total,
      costPerKg: new Decimal(lot.costPerKg.toString()),
    });
  }

  // Step 4: Deduct with an ATOMIC decrement per distinct lot (no stale read-modify-write).
  await Promise.all(
    result.map((c) =>
      tx.stockLot.update({
        where: { id: c.lotId },
        data: { kgRemaining: { decrement: c.kg.toFixed(3) } },
      }),
    ),
  );

  return result;
}
