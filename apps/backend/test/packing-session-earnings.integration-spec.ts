/**
 * Real-Postgres integration test — requires the dev DB running and DATABASE_URL configured.
 * NOT part of `npm test` (mocked-Prisma only) — run via `npm run test:integration`.
 *
 * Why this exists: proves the historical-packing-earnings-integrity fix against a real
 * transaction and a real Worker payroll aggregate, not a mocked one. The bug this guards
 * against — editing an unrelated field on an old PackingSession silently recalculating
 * sessionEarnings from the CURRENT BagType.workerRate — was found by exactly this kind of
 * end-to-end reproduction; a mocked-Prisma unit test proves the code path in isolation but
 * can't prove the real Decimal/JSON round-trip through Postgres behaves the same way.
 *
 * Creates its own isolated fixtures (uniquely-tagged Supplier/BagTypes/StockLot) and deletes
 * everything it created in afterAll, with cleanup verified — safe to run repeatedly.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PackingSessionsModule } from '../src/packing-sessions/packing-sessions.module';
import { PackingSessionsService } from '../src/packing-sessions/packing-sessions.service';
import { WorkersModule } from '../src/workers/workers.module';
import { WorkersService } from '../src/workers/workers.service';

const TAG = `EARNINGS_INTEGRITY_${Date.now()}`;
const CLERK_ID = 'user_test_owner'; // matches the dev-auth-bypass seeded user (auth.guard.ts)

describe('Historical packing earnings integrity — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let packingSvc: PackingSessionsService;
  let workersSvc: WorkersService;

  let supplierId: string;
  let lotId: string;
  let bagType10kgId: string;
  let bagType5kgId: string;
  let workerId: string;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, PackingSessionsModule, WorkersModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    packingSvc = moduleRef.get(PackingSessionsService);
    workersSvc = moduleRef.get(WorkersService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const supplier = await prisma.supplier.create({ data: { name: TAG, country: 'AUDIT', notes: 'temp' } });
    supplierId = supplier.id;

    const bag10 = await prisma.bagType.create({
      data: { name: `${TAG}_10kg`, nominalKg: '10.000', costPerBag: '0.4000', workerRate: '0.1200', note: 'temp' },
    });
    bagType10kgId = bag10.id;

    const bag5 = await prisma.bagType.create({
      data: { name: `${TAG}_5kg`, nominalKg: '5.000', costPerBag: '0.2500', workerRate: '0.0800', note: 'temp' },
    });
    bagType5kgId = bag5.id;

    const lot = await prisma.stockLot.create({
      data: {
        charcoalType: TAG,
        grade: 'A',
        supplierId,
        kgReceived: '100000.000',
        kgRemaining: '100000.000',
        costPerKg: '0.3000',
        source: 'container',
        dateReceived: new Date(),
      },
    });
    lotId = lot.id;

    const worker = await prisma.worker.create({ data: { name: TAG } });
    workerId = worker.id;
  });

  afterAll(async () => {
    for (const id of sessionIds) {
      await prisma.packedStock.deleteMany({ where: { sessionId: id } });
      await prisma.packingSessionLot.deleteMany({ where: { sessionId: id } });
      await prisma.packingSession.delete({ where: { id } }).catch(() => {});
    }
    if (workerId) await prisma.worker.delete({ where: { id: workerId } }).catch(() => {});
    if (lotId) await prisma.stockLot.delete({ where: { id: lotId } }).catch(() => {});
    if (bagType10kgId) await prisma.bagType.delete({ where: { id: bagType10kgId } }).catch(() => {});
    if (bagType5kgId) await prisma.bagType.delete({ where: { id: bagType5kgId } }).catch(() => {});
    if (supplierId) await prisma.supplier.delete({ where: { id: supplierId } }).catch(() => {});

    const leftovers = await Promise.all([
      prisma.worker.findUnique({ where: { id: workerId } }),
      prisma.stockLot.findUnique({ where: { id: lotId } }),
      prisma.bagType.findUnique({ where: { id: bagType10kgId } }),
      prisma.bagType.findUnique({ where: { id: bagType5kgId } }),
      prisma.supplier.findUnique({ where: { id: supplierId } }),
    ]);
    // eslint-disable-next-line no-console
    console.log('CLEANUP VERIFICATION — all should be null:', leftovers);
    expect(leftovers.every(l => l === null)).toBe(true);

    await moduleRef.close();
  });

  it('rate-change regression: editing ONLY varianceNote never changes sessionEarnings, even after the BagType rate changes', async () => {
    // 1-3: create session, 10 bags @ $0.10 (temp-lowered rate for this test) → $1.00
    await prisma.bagType.update({ where: { id: bagType10kgId }, data: { workerRate: '0.1000' } });
    const created = await packingSvc.createPackingSession(
      { lotInputs: [{ lotId, kg: '100.000' }], bagsOutput: [{ bagTypeId: bagType10kgId, qty: 10 }] } as any,
      CLERK_ID,
    );
    sessionIds.push(created!.id);
    expect(parseFloat(created!.sessionEarnings.toString())).toBeCloseTo(1.0, 2);

    // 4: change BagType rate 0.10 -> 0.20
    await prisma.bagType.update({ where: { id: bagType10kgId }, data: { workerRate: '0.2000' } });

    // 5: update ONLY varianceNote
    await packingSvc.updatePackingSession(created!.id, { varianceNote: 'unrelated edit' } as any, CLERK_ID);

    // 6: sessionEarnings must STILL be $1.00
    const refetched = await prisma.packingSession.findUnique({ where: { id: created!.id } });
    expect(parseFloat(refetched!.sessionEarnings.toString())).toBeCloseTo(1.0, 2);
    expect(parseFloat((refetched!.bagsOutput as any)[0].ratePerBag)).toBeCloseTo(0.1, 4);
  });

  it('multiple bag types: unrelated-field edit preserves the full multi-line historical total after one rate changes', async () => {
    await prisma.bagType.update({ where: { id: bagType10kgId }, data: { workerRate: '0.1200' } });
    await prisma.bagType.update({ where: { id: bagType5kgId },  data: { workerRate: '0.0800' } });

    const created = await packingSvc.createPackingSession(
      {
        lotInputs: [{ lotId, kg: '600.000' }], // 50×10kg + 20×5kg = 600kg
        bagsOutput: [
          { bagTypeId: bagType10kgId, qty: 50 },
          { bagTypeId: bagType5kgId, qty: 20 },
        ],
      } as any,
      CLERK_ID,
    );
    sessionIds.push(created!.id);
    expect(parseFloat(created!.sessionEarnings.toString())).toBeCloseTo(7.6, 2); // 6.00 + 1.60

    // Change only the 10kg rate
    await prisma.bagType.update({ where: { id: bagType10kgId }, data: { workerRate: '0.2000' } });

    // Edit the old session's notes only
    await packingSvc.updatePackingSession(created!.id, { notes: 'touched, unrelated' } as any, CLERK_ID);

    const refetched = await prisma.packingSession.findUnique({ where: { id: created!.id } });
    expect(parseFloat(refetched!.sessionEarnings.toString())).toBeCloseTo(7.6, 2);
  });

  it('a NEW session created after the rate change uses the new current rate', async () => {
    await prisma.bagType.update({ where: { id: bagType10kgId }, data: { workerRate: '0.2000' } });

    const created = await packingSvc.createPackingSession(
      { lotInputs: [{ lotId, kg: '100.000' }], bagsOutput: [{ bagTypeId: bagType10kgId, qty: 10 }] } as any,
      CLERK_ID,
    );
    sessionIds.push(created!.id);
    expect(parseFloat(created!.sessionEarnings.toString())).toBeCloseTo(2.0, 2); // 10 × 0.20
  });

  it('Worker.totalEarned/totalOwed reflect the preserved historical sessionEarnings, not the current rate', async () => {
    await prisma.bagType.update({ where: { id: bagType10kgId }, data: { workerRate: '0.1000' } });

    const created = await packingSvc.createPackingSession(
      {
        lotInputs: [{ lotId, kg: '100.000' }],
        bagsOutput: [{ bagTypeId: bagType10kgId, qty: 10 }],
        workerEntityId: workerId,
      } as any,
      CLERK_ID,
    );
    sessionIds.push(created!.id);

    await prisma.bagType.update({ where: { id: bagType10kgId }, data: { workerRate: '0.2000' } });
    await packingSvc.updatePackingSession(created!.id, { notes: 'unrelated' } as any, CLERK_ID);

    const totals = await (workersSvc as any).computeTotals(workerId);
    expect(parseFloat(totals.pieceEarned)).toBeCloseTo(1.0, 2); // NOT 2.0
    expect(parseFloat(totals.totalEarned)).toBeCloseTo(1.0, 2);
  });
});
