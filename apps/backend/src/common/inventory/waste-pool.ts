import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

/** WasteStock is a singleton row — see its doc comment in schema.prisma. */
export const WASTE_STOCK_ID = 'singleton';

/**
 * Shared "sync waste variance" primitive used by BOTH createPackingSession and
 * updatePackingSession (packing-sessions.service.ts) — mirrors consume-lots.ts's role
 * as the single choke point both callers share for the thing it mutates.
 *
 * Keeps ONE session's own WasteEntry (type='packing_variance') equal to
 * `max(varianceKg, 0)` and WasteStock.kgOnHand in lockstep via an atomic delta — all
 * inside the caller's transaction, so a session can never commit with its waste entry
 * out of sync with the pool balance. See WasteEntry/WasteStock's doc comments in
 * schema.prisma for the full ledger design.
 *
 *   - create: `existing` is always none (brand-new session) — this only ever adds.
 *   - update: `existing` may or may not be present (a session created before this
 *     feature existed has none). The delta between the old and new entry kg is applied
 *     to the pool — not the new value written blind — so a session whose variance
 *     shrinks correctly gives back only what IT contributed, not the whole pool.
 *
 * GUARD — the one real risk of an auto-fed pool: if this session's variance is being
 * corrected DOWN after some of what it contributed has already been sold, disposed, or
 * adjusted out of the pool elsewhere, the pool may not have enough left to absorb the
 * reduction. That case is rejected (400 WASTE_POOL_INSUFFICIENT) rather than silently
 * clamped or driven negative — same discipline as consume-lots.ts rejecting
 * kgUsed > kgRemaining instead of clamping it. The caller must post a waste adjustment
 * (physical-count correction) first.
 *
 * Locks the singleton row with `SELECT ... FOR UPDATE` before validating — same pattern
 * consume-lots.ts uses on stock_lots — so a concurrent waste sale can never validate
 * against a stale pre-adjustment balance.
 */
export async function syncPackingVarianceWasteEntry(
  tx: Prisma.TransactionClient,
  params: { sessionId: string; varianceKg: Decimal; date: Date; createdById: string },
): Promise<void> {
  const newKg = Decimal.max(params.varianceKg, 0);

  const existing = await tx.wasteEntry.findUnique({ where: { sessionId: params.sessionId } });
  const oldKg = existing ? new Decimal(existing.kg.toString()) : new Decimal(0);

  const delta = newKg.minus(oldKg);
  if (delta.eq(0)) return;

  await tx.$queryRaw(Prisma.sql`SELECT id FROM "waste_stock" WHERE id = ${WASTE_STOCK_ID} FOR UPDATE`);
  const stock = await tx.wasteStock.findUniqueOrThrow({ where: { id: WASTE_STOCK_ID } });
  const kgOnHand = new Decimal(stock.kgOnHand.toString());

  if (delta.lt(0) && kgOnHand.plus(delta).lt(0)) {
    throw new BadRequestException({
      message:
        `Cannot reduce this session's waste contribution by ${delta.abs().toFixed(3)} kg — only ` +
        `${kgOnHand.toFixed(3)} kg remains in the waste pool (some has already been sold, disposed, ` +
        'or corrected out elsewhere). Post a waste adjustment to reconcile the pool before editing this session.',
      error: 'WASTE_POOL_INSUFFICIENT',
      code: 'WASTE_POOL_INSUFFICIENT',
    });
  }

  await tx.wasteStock.update({
    where: { id: WASTE_STOCK_ID },
    data: { kgOnHand: kgOnHand.plus(delta).toFixed(3) },
  });

  if (newKg.eq(0)) {
    // existing is guaranteed non-null here: delta !== 0 and newKg === 0 means oldKg > 0,
    // which only happens when an entry already exists.
    await tx.wasteEntry.delete({ where: { id: existing!.id } });
    return;
  }

  if (existing) {
    await tx.wasteEntry.update({
      where: { id: existing.id },
      data: { kg: newKg.toFixed(3), date: params.date },
    });
  } else {
    await tx.wasteEntry.create({
      data: {
        type: 'packing_variance',
        kg: newKg.toFixed(3),
        sessionId: params.sessionId,
        date: params.date,
        createdById: params.createdById,
      },
    });
  }
}

/** Display labels stamped on waste-sale invoice lines and used by reports. */
export const WASTE_CHARCOAL_TYPE = 'Waste';
export const WASTE_GRADE = 'Mixed';

/**
 * Take `kg` OUT of the waste pool (a sale or a disposal) inside the caller's
 * transaction: locks the singleton row FOR UPDATE (same lock order as
 * syncPackingVarianceWasteEntry), rejects with 400 WASTE_POOL_INSUFFICIENT
 * instead of ever driving kgOnHand negative, decrements the pool and writes the
 * matching NEGATIVE WasteEntry — so Σ(WasteEntry.kg) keeps equalling kgOnHand.
 *
 * A waste SALE always passes `stockExitId` (every waste sale has one StockExit so
 * it shows in the warehouse sales history); an invoiced sale also passes
 * `invoiceId`. "Exit has a wasteEntry" is how reports recognise a waste exit.
 */
export async function drawFromWastePool(
  tx: Prisma.TransactionClient,
  params: {
    type: 'sale' | 'disposal';
    kg: Decimal;
    date: Date;
    createdById: string;
    stockExitId?: string;
    invoiceId?: string;
    note?: string;
  },
) {
  const kg = new Decimal(params.kg);
  if (!kg.gt(0)) {
    throw new BadRequestException({
      message: `Waste kg must be greater than zero (got ${kg.toFixed(3)})`,
      error: `Waste kg must be greater than zero (got ${kg.toFixed(3)})`,
      code: 'CONSTRAINT_VIOLATION',
    });
  }

  await tx.$queryRaw(Prisma.sql`SELECT id FROM "waste_stock" WHERE id = ${WASTE_STOCK_ID} FOR UPDATE`);
  const stock = await tx.wasteStock.findUnique({ where: { id: WASTE_STOCK_ID } });
  const kgOnHand = new Decimal(stock?.kgOnHand.toString() ?? '0');
  if (kg.gt(kgOnHand)) {
    throw new BadRequestException({
      message: `Not enough waste in the pool — available: ${kgOnHand.toFixed(3)} kg, requested: ${kg.toFixed(3)} kg`,
      error: `Not enough waste in the pool — available: ${kgOnHand.toFixed(3)} kg, requested: ${kg.toFixed(3)} kg`,
      code: 'WASTE_POOL_INSUFFICIENT',
    });
  }

  await tx.wasteStock.update({
    where: { id: WASTE_STOCK_ID },
    data: { kgOnHand: kgOnHand.minus(kg).toFixed(3) },
  });
  return tx.wasteEntry.create({
    data: {
      type: params.type,
      kg: kg.negated().toFixed(3),
      date: params.date,
      createdById: params.createdById,
      ...(params.stockExitId ? { stockExitId: params.stockExitId } : {}),
      ...(params.invoiceId ? { invoiceId: params.invoiceId } : {}),
      ...(params.note ? { note: params.note } : {}),
    },
  });
}

/**
 * Put a cancelled waste sale's kg BACK into the pool. The ledger is append-only,
 * so the original (negative) sale entry is kept and a POSITIVE 'sale' entry
 * reverses it — Σ(sale entries) is therefore the NET kg sold, which is exactly
 * what WasteService.getSummary()'s soldThisMonthKg reports.
 */
export async function returnSaleToWastePool(
  tx: Prisma.TransactionClient,
  params: { kg: Decimal; date: Date; createdById: string; note: string },
) {
  const kg = new Decimal(params.kg);
  if (!kg.gt(0)) return;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "waste_stock" WHERE id = ${WASTE_STOCK_ID} FOR UPDATE`);
  await tx.wasteStock.upsert({
    where: { id: WASTE_STOCK_ID },
    create: { id: WASTE_STOCK_ID, kgOnHand: kg.toFixed(3) },
    update: { kgOnHand: { increment: kg.toFixed(3) } },
  });
  await tx.wasteEntry.create({
    data: { type: 'sale', kg: kg.toFixed(3), date: params.date, createdById: params.createdById, note: params.note },
  });
}
