import { describe, it, expect, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { syncPackingVarianceWasteEntry } from './waste-pool';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }

/**
 * Unit tests against a mocked tx — mirrors consume-lots.spec.ts's own approach and
 * disclaimer: these prove the lock precedes the read, the delta math, and the
 * insufficient-pool rejection; they cannot spin up two real concurrent Postgres
 * transactions (that needs a Postgres integration test, same caveat as consumeLots).
 */
describe('syncPackingVarianceWasteEntry', () => {
  function makeTx(opts: { existingEntry?: { id: string; kg: string } | null; kgOnHand: string }) {
    const callOrder: string[] = [];
    const tx: any = {
      $queryRaw: fn().mockImplementation(async () => { callOrder.push('lock'); return []; }),
      wasteEntry: {
        findUnique: fn().mockImplementation(async () => {
          callOrder.push('read-entry');
          return opts.existingEntry ?? null;
        }),
        create: fn().mockResolvedValue({}),
        update: fn().mockResolvedValue({}),
        delete: fn().mockResolvedValue({}),
      },
      wasteStock: {
        findUniqueOrThrow: fn().mockImplementation(async () => {
          callOrder.push('read-stock');
          return { id: 'singleton', kgOnHand: { toString: () => opts.kgOnHand } };
        }),
        update: fn().mockResolvedValue({}),
      },
    };
    return { tx, callOrder };
  }

  it('brand-new session (no prior entry) with positive variance creates an entry and increments the pool', async () => {
    const { tx, callOrder } = makeTx({ existingEntry: null, kgOnHand: '50.000' });

    await syncPackingVarianceWasteEntry(tx, {
      sessionId: 'session-1',
      varianceKg: new Decimal('12.500'),
      date: new Date('2024-01-15'),
      createdById: 'user-1',
    });

    expect(callOrder).toEqual(['read-entry', 'lock', 'read-stock']);
    expect(tx.wasteStock.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { kgOnHand: '62.500' },
    });
    expect(tx.wasteEntry.create).toHaveBeenCalledWith({
      data: {
        type: 'packing_variance',
        kg: '12.500',
        sessionId: 'session-1',
        date: new Date('2024-01-15'),
        createdById: 'user-1',
      },
    });
  });

  it('negative variance (overpack) is clamped to zero — never recorded as waste, never touches the pool', async () => {
    const { tx } = makeTx({ existingEntry: null, kgOnHand: '50.000' });

    await syncPackingVarianceWasteEntry(tx, {
      sessionId: 'session-1',
      varianceKg: new Decimal('-5.000'),
      date: new Date('2024-01-15'),
      createdById: 'user-1',
    });

    expect(tx.wasteStock.update).not.toHaveBeenCalled();
    expect(tx.wasteEntry.create).not.toHaveBeenCalled();
  });

  it('unchanged variance on update (same kg as the existing entry) is a true no-op — never locks the pool', async () => {
    const { tx, callOrder } = makeTx({ existingEntry: { id: 'we-1', kg: '12.500' }, kgOnHand: '50.000' });

    await syncPackingVarianceWasteEntry(tx, {
      sessionId: 'session-1',
      varianceKg: new Decimal('12.500'),
      date: new Date('2024-01-15'),
      createdById: 'user-1',
    });

    expect(callOrder).toEqual(['read-entry']); // never reaches the lock
    expect(tx.wasteStock.update).not.toHaveBeenCalled();
    expect(tx.wasteEntry.update).not.toHaveBeenCalled();
  });

  it('variance increased on update: applies only the DELTA to the pool and updates the existing entry', async () => {
    const { tx } = makeTx({ existingEntry: { id: 'we-1', kg: '12.500' }, kgOnHand: '50.000' });

    await syncPackingVarianceWasteEntry(tx, {
      sessionId: 'session-1',
      varianceKg: new Decimal('20.000'),
      date: new Date('2024-01-15'),
      createdById: 'user-1',
    });

    // delta = 20.000 - 12.500 = +7.500 → pool 50.000 + 7.500 = 57.500 (NOT 50 + 20)
    expect(tx.wasteStock.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { kgOnHand: '57.500' },
    });
    expect(tx.wasteEntry.update).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { kg: '20.000', date: new Date('2024-01-15') },
    });
    expect(tx.wasteEntry.create).not.toHaveBeenCalled();
  });

  it('variance decreased on update, pool has enough left: applies the negative delta and updates the entry', async () => {
    const { tx } = makeTx({ existingEntry: { id: 'we-1', kg: '20.000' }, kgOnHand: '50.000' });

    await syncPackingVarianceWasteEntry(tx, {
      sessionId: 'session-1',
      varianceKg: new Decimal('12.500'),
      date: new Date('2024-01-15'),
      createdById: 'user-1',
    });

    // delta = 12.500 - 20.000 = -7.500 → pool 50.000 - 7.500 = 42.500
    expect(tx.wasteStock.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { kgOnHand: '42.500' },
    });
    expect(tx.wasteEntry.update).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { kg: '12.500', date: new Date('2024-01-15') },
    });
  });

  it('variance reduced to exactly zero on update: deletes the entry and decrements the pool by the old value', async () => {
    const { tx } = makeTx({ existingEntry: { id: 'we-1', kg: '20.000' }, kgOnHand: '50.000' });

    await syncPackingVarianceWasteEntry(tx, {
      sessionId: 'session-1',
      varianceKg: new Decimal('0'),
      date: new Date('2024-01-15'),
      createdById: 'user-1',
    });

    expect(tx.wasteStock.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { kgOnHand: '30.000' },
    });
    expect(tx.wasteEntry.delete).toHaveBeenCalledWith({ where: { id: 'we-1' } });
    expect(tx.wasteEntry.update).not.toHaveBeenCalled();
  });

  it('variance going negative (overpack correction) on update deletes the entry (clamped to zero, same as negative-to-zero)', async () => {
    const { tx } = makeTx({ existingEntry: { id: 'we-1', kg: '20.000' }, kgOnHand: '50.000' });

    await syncPackingVarianceWasteEntry(tx, {
      sessionId: 'session-1',
      varianceKg: new Decimal('-3.000'),
      date: new Date('2024-01-15'),
      createdById: 'user-1',
    });

    expect(tx.wasteEntry.delete).toHaveBeenCalledWith({ where: { id: 'we-1' } });
    expect(tx.wasteStock.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { kgOnHand: '30.000' }, // decrement by the OLD 20.000, not by 23
    });
  });

  // =========================================================================
  // The one real risk of an auto-fed pool (see waste-pool.ts's doc comment): a
  // session's variance is corrected DOWN after some of what it contributed has
  // already been sold/disposed/adjusted out of the pool elsewhere, so the pool
  // doesn't have enough left to absorb the reduction. Rejected, not clamped.
  // =========================================================================

  it('rejects when reducing this session\'s contribution would drive the shared pool negative, and writes nothing', async () => {
    // This session contributed 20kg originally, but only 5kg is left in the shared pool
    // (15kg of it — some from this session, some from others — was sold/adjusted away).
    const { tx } = makeTx({ existingEntry: { id: 'we-1', kg: '20.000' }, kgOnHand: '5.000' });

    await expect(
      syncPackingVarianceWasteEntry(tx, {
        sessionId: 'session-1',
        varianceKg: new Decimal('0'), // reducing by 20 — more than the 5 left
        date: new Date('2024-01-15'),
        createdById: 'user-1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'WASTE_POOL_INSUFFICIENT' }),
    });

    expect(tx.wasteStock.update).not.toHaveBeenCalled();
    expect(tx.wasteEntry.delete).not.toHaveBeenCalled();
    expect(tx.wasteEntry.update).not.toHaveBeenCalled();
  });

  it('boundary: reducing exactly down to a zero remaining pool is allowed (not rejected)', async () => {
    const { tx } = makeTx({ existingEntry: { id: 'we-1', kg: '20.000' }, kgOnHand: '15.000' });

    await syncPackingVarianceWasteEntry(tx, {
      sessionId: 'session-1',
      varianceKg: new Decimal('5.000'), // delta -15.000, pool 15.000 - 15.000 = 0 exactly
      date: new Date('2024-01-15'),
      createdById: 'user-1',
    });

    expect(tx.wasteStock.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { kgOnHand: '0.000' },
    });
  });

  it('locks the waste_stock row via FOR UPDATE before reading it, only when a delta is actually being applied', async () => {
    const { tx } = makeTx({ existingEntry: null, kgOnHand: '0.000' });

    await syncPackingVarianceWasteEntry(tx, {
      sessionId: 'session-1',
      varianceKg: new Decimal('1.000'),
      date: new Date('2024-01-15'),
      createdById: 'user-1',
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const lockCall = tx.$queryRaw.mock.calls[0][0] as any;
    expect(lockCall.sql).toContain('FOR UPDATE');
    expect(lockCall.sql).toContain('waste_stock');
  });
});
