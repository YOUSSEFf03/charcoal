import { describe, it, expect, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { consumeLots } from './consume-lots';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any { return jest.fn(); }

/**
 * Concurrency safety — SELECT ... FOR UPDATE locking on every distinct target
 * StockLot row BEFORE consumeLots() reads/validates/decrements it. Mirrors
 * stock-exits.service.ts's already-fixed pattern, extended here to lock the
 * FULL distinct, sorted lotId set in one statement rather than row-by-row in
 * caller order — this shared primitive is used by both
 * PackingSessionsService (createPackingSession/updatePackingSession) and
 * FillJobsService.create(), so a concurrent packing session, a concurrent
 * fill job, or a concurrent walk-in/stock-exit sale on the same lot must all
 * serialize on the same lock.
 *
 * These are unit tests against a mocked tx, so — like stock-exits.service
 * .spec.ts's own concurrency tests — they cannot spin up two real concurrent
 * Postgres transactions. They prove the lock precedes the read, covers the
 * full deduplicated/sorted target set in one statement, and that existing
 * validation/decrement behavior is unchanged. Real concurrent-transaction
 * proof requires a Postgres integration test — see
 * test/stock-concurrency.integration-spec.ts.
 */
describe('consumeLots — concurrency safety (FOR UPDATE locking)', () => {
  function makeTx(lots: Array<{ id: string; kgRemaining: string; costPerKg: string }>) {
    const callOrder: string[] = [];
    const tx: any = {
      $queryRaw: fn().mockImplementation(async () => { callOrder.push('lock'); return []; }),
      stockLot: {
        findMany: fn().mockImplementation(async (args: any) => {
          callOrder.push('read');
          return lots
            .filter((l) => args.where.id.in.includes(l.id))
            .map((l) => ({ id: l.id, kgRemaining: { toString: () => l.kgRemaining }, costPerKg: { toString: () => l.costPerKg } }));
        }),
        update: fn().mockResolvedValue({}),
      },
    };
    return { tx, callOrder };
  }

  it('locks the stock_lots row via FOR UPDATE before reading it', async () => {
    const { tx, callOrder } = makeTx([{ id: 'lot-1', kgRemaining: '100.000', costPerKg: '2.000' }]);

    await consumeLots(tx, [{ lotId: 'lot-1', kg: '30.000' }]);

    expect(callOrder).toEqual(['lock', 'read']);
    const lockCall = tx.$queryRaw.mock.calls[0][0] as any;
    expect(lockCall.sql).toContain('FOR UPDATE');
    expect(lockCall.sql).toContain('stock_lots');
    expect(lockCall.values).toEqual(['lot-1']);
  });

  it('deduplicates and sorts multiple distinct lotIds into one lock statement, ascending by id', async () => {
    const { tx } = makeTx([
      { id: 'lot-z', kgRemaining: '100.000', costPerKg: '2.000' },
      { id: 'lot-a', kgRemaining: '100.000', costPerKg: '3.000' },
    ]);

    // Deliberately unsorted, with a duplicate lotId (summed, per existing aggregation behavior).
    await consumeLots(tx, [
      { lotId: 'lot-z', kg: '10.000' },
      { lotId: 'lot-a', kg: '5.000' },
      { lotId: 'lot-z', kg: '5.000' },
    ]);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const lockCall = tx.$queryRaw.mock.calls[0][0] as any;
    expect(lockCall.values).toEqual(['lot-a', 'lot-z']); // sorted ascending, not input order
  });

  it('does not issue a lock statement for an empty input set', async () => {
    const { tx } = makeTx([]);

    const result = await consumeLots(tx, []);

    expect(result).toEqual([]);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.stockLot.findMany).toHaveBeenCalledWith({ where: { id: { in: [] } } });
  });

  it('existing insufficient-stock rejection is unchanged: the lock is taken, but validation still rejects and nothing is decremented', async () => {
    const { tx, callOrder } = makeTx([{ id: 'lot-1', kgRemaining: '10.000', costPerKg: '2.000' }]);

    await expect(consumeLots(tx, [{ lotId: 'lot-1', kg: '30.000' }])).rejects.toBeInstanceOf(BadRequestException);

    expect(callOrder).toEqual(['lock', 'read']); // lock still acquired before the (failed) validation
    expect(tx.stockLot.update).not.toHaveBeenCalled();
  });

  it('existing not-found behavior is unchanged: the lock is taken even when the lot does not exist', async () => {
    const { tx } = makeTx([]);

    await expect(consumeLots(tx, [{ lotId: 'missing-lot', kg: '5.000' }])).rejects.toBeInstanceOf(NotFoundException);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.stockLot.update).not.toHaveBeenCalled();
  });

  it('normal single-threaded consumption is unchanged: atomic decrement per distinct lot, summed aggregation preserved', async () => {
    const { tx } = makeTx([
      { id: 'lot-1', kgRemaining: '1000.000', costPerKg: '2.000' },
      { id: 'lot-2', kgRemaining: '1000.000', costPerKg: '3.000' },
    ]);

    const result = await consumeLots(tx, [
      { lotId: 'lot-1', kg: '100.000' },
      { lotId: 'lot-2', kg: '50.000' },
      { lotId: 'lot-1', kg: '25.000' }, // duplicate lotId — summed into one decrement
    ]);

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.lotId === 'lot-1')!.kg.toFixed(3)).toBe('125.000');
    expect(result.find((r) => r.lotId === 'lot-2')!.kg.toFixed(3)).toBe('50.000');

    expect(tx.stockLot.update).toHaveBeenCalledWith({ where: { id: 'lot-1' }, data: { kgRemaining: { decrement: '125.000' } } });
    expect(tx.stockLot.update).toHaveBeenCalledWith({ where: { id: 'lot-2' }, data: { kgRemaining: { decrement: '50.000' } } });
  });

  // =========================================================================
  // Regression: a non-positive aggregated kg would flip the atomic
  // `{ decrement: total }` above into an INCREMENT (Prisma applies it
  // literally), silently fabricating raw stock. Neither caller's DTO
  // enforces this above the primitive today (PackingSessionsService's
  // LotInputDto.kg has no @Min, unlike FillJobsService's own
  // FillJobCharcoalInputDto.kg which does) — enforced here instead, at the
  // one choke point every consumer shares.
  // =========================================================================

  it('rejects a negative kg input and decrements nothing (would otherwise INCREASE kgRemaining)', async () => {
    const { tx } = makeTx([{ id: 'lot-1', kgRemaining: '100.000', costPerKg: '2.000' }]);

    await expect(consumeLots(tx, [{ lotId: 'lot-1', kg: '-50.000' }])).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
    });
    expect(tx.stockLot.update).not.toHaveBeenCalled();
  });

  it('rejects a zero kg input and decrements nothing', async () => {
    const { tx } = makeTx([{ id: 'lot-1', kgRemaining: '100.000', costPerKg: '2.000' }]);

    await expect(consumeLots(tx, [{ lotId: 'lot-1', kg: '0' }])).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
    });
    expect(tx.stockLot.update).not.toHaveBeenCalled();
  });

  it('rejects when duplicate lines for the same lot aggregate to zero net kg (e.g. +50 and -50)', async () => {
    const { tx } = makeTx([{ id: 'lot-1', kgRemaining: '100.000', costPerKg: '2.000' }]);

    await expect(
      consumeLots(tx, [{ lotId: 'lot-1', kg: '50.000' }, { lotId: 'lot-1', kg: '-50.000' }]),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
    });
    expect(tx.stockLot.update).not.toHaveBeenCalled();
  });
});
