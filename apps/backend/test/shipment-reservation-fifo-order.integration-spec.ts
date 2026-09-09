/**
 * Real-Postgres integration test — requires the dev DB running (docker compose up -d)
 * and DATABASE_URL configured. Run via `npm run test:integration`.
 *
 * Forensic audit (2026-08-29, follow-up to fifo-draw-order.integration-spec.ts):
 * PackedStockService.getFifoDraw() was fixed to break PackedStock sibling ties
 * deterministically (createdAt → lot.dateReceived → lot.createdAt → id). This
 * file proves the SAME nondeterministic-tie defect existed independently in
 * ShipmentsService.createShipment()'s own reservation walk
 * (`orderBy: { createdAt: 'asc' }`, never routed through getFifoDraw()) and in
 * ShipmentsService.logReturn()'s `findFirst` — both now fixed by reusing the
 * exact same exported PACKED_STOCK_FIFO_ORDER_BY ordering.
 *
 * Reachability: POST /shipments (createShipment) and the return-log action
 * (logReturn) have NO current frontend caller (useCreateShipment/useCreateSale/
 * useLogReturn are all defined but unused in src/pages) — but both endpoints
 * are fully wired, role-guarded (@Roles('owner','sales_rep') / ('driver','owner')),
 * and reachable by any authenticated caller via the API today. This is an
 * active, live code path, not dead code — hence a real fix, not a
 * documentation-only note.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { ShipmentsService } from '../src/shipments/shipments.service';

const TAG = `SHIP_FIFO_ORDER_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner';

describe('ShipmentsService.createShipment() — deterministic sibling ordering (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let shipments: ShipmentsService;

  let clientId: string;
  let ownerId: string;

  const createdBagTypeIds: string[] = [];
  const createdLotIds: string[] = [];
  const createdPackedStockIds: string[] = [];
  const createdSessionIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdShipmentIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ShipmentsModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    shipments = moduleRef.get(ShipmentsService);

    const owner = await prisma.user.upsert({
      where: { clerkId: CLERK_ID }, update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });
    ownerId = owner.id;
    const client = await prisma.client.create({
      data: { name: `Shipment FIFO Test Client ${Date.now()}`, type: 'restaurant', currency: 'USD' },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    if (createdShipmentIds.length) {
      await prisma.shipmentBag.deleteMany({ where: { shipmentId: { in: createdShipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: createdShipmentIds } } });
    }
    if (createdOrderIds.length) await prisma.clientOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    if (createdPackedStockIds.length) await prisma.packedStock.deleteMany({ where: { id: { in: createdPackedStockIds } } });
    if (createdSessionIds.length) {
      await prisma.packingSessionLot.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.packingSession.deleteMany({ where: { id: { in: createdSessionIds } } });
    }
    if (createdLotIds.length) await prisma.stockLot.deleteMany({ where: { id: { in: createdLotIds } } });
    if (createdBagTypeIds.length) await prisma.bagType.deleteMany({ where: { id: { in: createdBagTypeIds } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  async function makeBagType() {
    const bt = await prisma.bagType.create({
      data: { name: `${TAG}_${createdBagTypeIds.length}`, nominalKg: '5.000', costPerBag: '0.0500', workerRate: '0.1200' },
    });
    createdBagTypeIds.push(bt.id);
    return bt.id;
  }

  async function makeOrder(bagTypeId: string, totalKgRequested: string) {
    const order = await prisma.clientOrder.create({
      data: {
        clientId, charcoalType: `${TAG}_ORDER`, grade: 'A',
        totalKgRequested, bagTypeId, pricePerBag: '4.50', currency: 'USD',
        status: 'draft', createdById: ownerId,
      },
    });
    createdOrderIds.push(order.id);
    return order.id;
  }

  /** Same technique as fifo-draw-order.integration-spec.ts: two StockLots with
   * distinct dateReceived, two PackedStock rows written in ONE createMany()
   * call so they genuinely share one identical createdAt. */
  async function makeTiedSiblingPair(
    bagTypeId: string,
    insertOrder: 'oldest-first' | 'newest-first',
    olderQty = 100,
    newerQty = 100,
    olderDateReceived = new Date('2026-08-01'),
    newerDateReceived = new Date('2026-08-15'),
  ) {
    const supplierId = (await prisma.supplier.findFirst())!.id;
    const worker = await prisma.user.upsert({
      where: { clerkId: 'user_test_owner' }, update: {},
      create: { clerkId: 'user_test_owner', email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const olderLot = await prisma.stockLot.create({
      data: {
        charcoalType: `${TAG}_TYPE_A_${createdLotIds.length}`, grade: 'A', supplierId,
        kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '1.0000',
        source: 'container', dateReceived: olderDateReceived,
      },
    });
    const newerLot = await prisma.stockLot.create({
      data: {
        charcoalType: `${TAG}_TYPE_B_${createdLotIds.length}`, grade: 'B', supplierId,
        kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '2.0000',
        source: 'container', dateReceived: newerDateReceived,
      },
    });
    createdLotIds.push(olderLot.id, newerLot.id);

    const session = await prisma.packingSession.create({
      data: {
        workerId: worker.id, mode: 'stock',
        kgConsumed: '0', kgOutputTotal: '0', varianceKg: '0', sessionEarnings: '0',
        date: new Date(), completedAt: new Date(),
        sessionLots: { create: [{ lotId: olderLot.id, kgUsed: '0' }, { lotId: newerLot.id, kgUsed: '0' }] },
      },
    });
    createdSessionIds.push(session.id);

    const rows = insertOrder === 'oldest-first'
      ? [{ lotId: olderLot.id, bagTypeId, quantity: olderQty, sessionId: session.id },
         { lotId: newerLot.id, bagTypeId, quantity: newerQty, sessionId: session.id }]
      : [{ lotId: newerLot.id, bagTypeId, quantity: newerQty, sessionId: session.id },
         { lotId: olderLot.id, bagTypeId, quantity: olderQty, sessionId: session.id }];
    await prisma.$transaction(async (tx) => {
      await tx.packedStock.createMany({ data: rows });
    });

    const created = await prisma.packedStock.findMany({ where: { sessionId: session.id } });
    createdPackedStockIds.push(...created.map((c) => c.id));

    const timestamps = new Set(created.map((c) => c.createdAt.getTime()));
    expect(timestamps.size).toBe(1);

    const olderRow = created.find((c) => c.lotId === olderLot.id)!;
    const newerRow = created.find((c) => c.lotId === newerLot.id)!;
    return { olderRow, newerRow, olderLot, newerLot };
  }

  async function reservationsFor(shipmentId: string) {
    return prisma.shipmentReservation.findMany({ where: { shipmentId } });
  }

  it('CASE 1 — different createdAt: reserves from the row created first', async () => {
    const bagTypeId = await makeBagType();
    const supplierId = (await prisma.supplier.findFirst())!.id;
    const worker = await prisma.user.upsert({
      where: { clerkId: 'user_test_owner' }, update: {},
      create: { clerkId: 'user_test_owner', email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    // Two SEPARATE packing sessions (separate createMany() batches) — genuinely
    // different createdAt, no tie involved. The newer one is created FIRST in
    // wall-clock terms below is irrelevant; what matters is which one is older.
    async function makeSingleRow(qty: number) {
      const lot = await prisma.stockLot.create({
        data: {
          charcoalType: `${TAG}_C1_${createdLotIds.length}`, grade: 'A', supplierId,
          kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '1.0000',
          source: 'container', dateReceived: new Date('2026-08-01'),
        },
      });
      createdLotIds.push(lot.id);
      const session = await prisma.packingSession.create({
        data: {
          workerId: worker.id, mode: 'stock',
          kgConsumed: '0', kgOutputTotal: '0', varianceKg: '0', sessionEarnings: '0',
          date: new Date(), completedAt: new Date(),
          sessionLots: { create: [{ lotId: lot.id, kgUsed: '0' }] },
        },
      });
      createdSessionIds.push(session.id);
      await prisma.$transaction(async (tx) => {
        await tx.packedStock.createMany({ data: [{ lotId: lot.id, bagTypeId, quantity: qty, sessionId: session.id }] });
      });
      const row = await prisma.packedStock.findFirstOrThrow({ where: { sessionId: session.id } });
      createdPackedStockIds.push(row.id);
      return row;
    }

    const olderRow = await makeSingleRow(100);
    const newerRow = await makeSingleRow(100);
    expect(olderRow.createdAt.getTime()).toBeLessThan(newerRow.createdAt.getTime());

    const orderId = await makeOrder(bagTypeId, '500.000');
    const shipment = await shipments.createShipment(
      { orderId, address: '1 Test St', nominalKg: '500.000', bags: [{ bagTypeId, quantity: 100 }] } as any,
      CLERK_ID,
    );
    createdShipmentIds.push(shipment!.id);

    const reservations = await reservationsFor(shipment!.id);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ packedStockId: olderRow.id, quantity: 100 });
  });

  it('CASE 2 — identical createdAt, different lot.dateReceived (adversarial insertion order): reserves the OLDER-received lot first', async () => {
    const bagTypeId = await makeBagType();
    const { olderRow, newerRow } = await makeTiedSiblingPair(bagTypeId, 'newest-first');

    const orderId = await makeOrder(bagTypeId, '500.000');
    const shipment = await shipments.createShipment(
      { orderId, address: '1 Test St', nominalKg: '500.000', bags: [{ bagTypeId, quantity: 100 }] } as any,
      CLERK_ID,
    );
    createdShipmentIds.push(shipment!.id);

    const reservations = await reservationsFor(shipment!.id);
    expect(reservations).toHaveLength(1);
    expect(reservations[0].packedStockId).toBe(olderRow.id);
    expect(reservations[0].packedStockId).not.toBe(newerRow.id);
  });

  it('CASE 3 — identical createdAt AND lot.dateReceived, different lot.createdAt: reserves the earlier-registered lot first', async () => {
    const bagTypeId = await makeBagType();
    const supplierId = (await prisma.supplier.findFirst())!.id;
    const worker = await prisma.user.upsert({
      where: { clerkId: 'user_test_owner' }, update: {},
      create: { clerkId: 'user_test_owner', email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });
    const sameDate = new Date('2026-08-10');

    const earlierLot = await prisma.stockLot.create({
      data: {
        charcoalType: `${TAG}_C3_EARLY`, grade: 'A', supplierId,
        kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '1.0000',
        source: 'container', dateReceived: sameDate,
      },
    });
    const laterLot = await prisma.stockLot.create({
      data: {
        charcoalType: `${TAG}_C3_LATE`, grade: 'B', supplierId,
        kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '2.0000',
        source: 'container', dateReceived: sameDate,
      },
    });
    createdLotIds.push(earlierLot.id, laterLot.id);
    expect(earlierLot.createdAt.getTime()).toBeLessThan(laterLot.createdAt.getTime());

    const session = await prisma.packingSession.create({
      data: {
        workerId: worker.id, mode: 'stock',
        kgConsumed: '0', kgOutputTotal: '0', varianceKg: '0', sessionEarnings: '0',
        date: new Date(), completedAt: new Date(),
        sessionLots: { create: [{ lotId: earlierLot.id, kgUsed: '0' }, { lotId: laterLot.id, kgUsed: '0' }] },
      },
    });
    createdSessionIds.push(session.id);

    // Adversarial: physically insert the LATER lot's row first.
    await prisma.$transaction(async (tx) => {
      await tx.packedStock.createMany({
        data: [
          { lotId: laterLot.id, bagTypeId, quantity: 100, sessionId: session.id },
          { lotId: earlierLot.id, bagTypeId, quantity: 100, sessionId: session.id },
        ],
      });
    });
    const created = await prisma.packedStock.findMany({ where: { sessionId: session.id } });
    createdPackedStockIds.push(...created.map((c) => c.id));
    expect(new Set(created.map((c) => c.createdAt.getTime())).size).toBe(1);
    const earlierRow = created.find((c) => c.lotId === earlierLot.id)!;
    const laterRow = created.find((c) => c.lotId === laterLot.id)!;

    const orderId = await makeOrder(bagTypeId, '500.000');
    const shipment = await shipments.createShipment(
      { orderId, address: '1 Test St', nominalKg: '500.000', bags: [{ bagTypeId, quantity: 100 }] } as any,
      CLERK_ID,
    );
    createdShipmentIds.push(shipment!.id);

    const reservations = await reservationsFor(shipment!.id);
    expect(reservations).toHaveLength(1);
    expect(reservations[0].packedStockId).toBe(earlierRow.id);
    expect(reservations[0].packedStockId).not.toBe(laterRow.id);
  });

  it('CASE 4 — everything tied (createdAt, lot.dateReceived, lot.createdAt): reserves the lower PackedStock.id', async () => {
    const bagTypeId = await makeBagType();
    const supplierId = (await prisma.supplier.findFirst())!.id;
    const worker = await prisma.user.upsert({
      where: { clerkId: 'user_test_owner' }, update: {},
      create: { clerkId: 'user_test_owner', email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });
    const sameDate = new Date('2026-08-12');
    const lotTypeX = `${TAG}_C4_X`;
    const lotTypeY = `${TAG}_C4_Y`;

    // Both lots via ONE createMany() batch — genuinely tied lot.createdAt too
    // (two separate create() calls do NOT tie, even inside a transaction).
    await prisma.stockLot.createMany({
      data: [
        { charcoalType: lotTypeX, grade: 'A', supplierId, kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '1.0000', source: 'container', dateReceived: sameDate },
        { charcoalType: lotTypeY, grade: 'B', supplierId, kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '2.0000', source: 'container', dateReceived: sameDate },
      ],
    });
    const lotX = await prisma.stockLot.findFirstOrThrow({ where: { charcoalType: lotTypeX } });
    const lotY = await prisma.stockLot.findFirstOrThrow({ where: { charcoalType: lotTypeY } });
    createdLotIds.push(lotX.id, lotY.id);
    expect(lotX.createdAt.getTime()).toBe(lotY.createdAt.getTime());

    const session = await prisma.packingSession.create({
      data: {
        workerId: worker.id, mode: 'stock',
        kgConsumed: '0', kgOutputTotal: '0', varianceKg: '0', sessionEarnings: '0',
        date: new Date(), completedAt: new Date(),
        sessionLots: { create: [{ lotId: lotX.id, kgUsed: '0' }, { lotId: lotY.id, kgUsed: '0' }] },
      },
    });
    createdSessionIds.push(session.id);

    await prisma.$transaction(async (tx) => {
      await tx.packedStock.createMany({
        data: [
          { lotId: lotY.id, bagTypeId, quantity: 100, sessionId: session.id },
          { lotId: lotX.id, bagTypeId, quantity: 100, sessionId: session.id },
        ],
      });
    });
    const created = await prisma.packedStock.findMany({ where: { sessionId: session.id } });
    createdPackedStockIds.push(...created.map((c) => c.id));
    expect(new Set(created.map((c) => c.createdAt.getTime())).size).toBe(1);
    const [expectedFirst] = [...created].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const orderId = await makeOrder(bagTypeId, '500.000');
    const shipment = await shipments.createShipment(
      { orderId, address: '1 Test St', nominalKg: '500.000', bags: [{ bagTypeId, quantity: 100 }] } as any,
      CLERK_ID,
    );
    createdShipmentIds.push(shipment!.id);

    const reservations = await reservationsFor(shipment!.id);
    expect(reservations).toHaveLength(1);
    expect(reservations[0].packedStockId).toBe(expectedFirst.id);
  });

  it('CASE 5 — multi-source: A=100, B=100, request=200 reserves BOTH sources with the correct split', async () => {
    const bagTypeId = await makeBagType();
    const { olderRow, newerRow } = await makeTiedSiblingPair(bagTypeId, 'newest-first', 100, 100);

    const orderId = await makeOrder(bagTypeId, '1000.000');
    const shipment = await shipments.createShipment(
      { orderId, address: '1 Test St', nominalKg: '1000.000', bags: [{ bagTypeId, quantity: 200 }] } as any,
      CLERK_ID,
    );
    createdShipmentIds.push(shipment!.id);

    const reservations = await reservationsFor(shipment!.id);
    expect(reservations).toHaveLength(2);
    const byRow = new Map(reservations.map((r) => [r.packedStockId, r.quantity]));
    expect(byRow.get(olderRow.id)).toBe(100);
    expect(byRow.get(newerRow.id)).toBe(100);
  });

  it('CASE 6 — request fits in the first (oldest) source only: second source untouched (existing greedy-FIFO behavior preserved)', async () => {
    const bagTypeId = await makeBagType();
    const { olderRow, newerRow } = await makeTiedSiblingPair(bagTypeId, 'newest-first', 300, 100);

    const orderId = await makeOrder(bagTypeId, '1000.000');
    const shipment = await shipments.createShipment(
      { orderId, address: '1 Test St', nominalKg: '1000.000', bags: [{ bagTypeId, quantity: 200 }] } as any,
      CLERK_ID,
    );
    createdShipmentIds.push(shipment!.id);

    const reservations = await reservationsFor(shipment!.id);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ packedStockId: olderRow.id, quantity: 200 });

    const untouched = await prisma.packedStock.findUniqueOrThrow({ where: { id: newerRow.id } });
    expect(untouched.reservedQuantity).toBe(0);
  });

  it('CASE 7 — insufficient stock still rejects the whole shipment (existing behavior intact)', async () => {
    const bagTypeId = await makeBagType();
    await makeTiedSiblingPair(bagTypeId, 'newest-first', 50, 50);

    const orderId = await makeOrder(bagTypeId, '1000.000');
    await expect(
      shipments.createShipment(
        { orderId, address: '1 Test St', nominalKg: '1000.000', bags: [{ bagTypeId, quantity: 200 }] } as any,
        CLERK_ID,
      ),
    ).rejects.toThrow();

    // Nothing partially reserved — the whole transaction rolled back.
    const shipmentRows = await prisma.shipment.findMany({ where: { orderId } });
    expect(shipmentRows).toHaveLength(0);
  });
});

describe('ShipmentsService.logReturn() — deterministic sibling ordering (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let shipments: ShipmentsService;

  let clientId: string;
  let ownerId: string;

  const createdBagTypeIds: string[] = [];
  const createdLotIds: string[] = [];
  const createdPackedStockIds: string[] = [];
  const createdSessionIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdShipmentIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ShipmentsModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    shipments = moduleRef.get(ShipmentsService);

    const owner = await prisma.user.upsert({
      where: { clerkId: CLERK_ID }, update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });
    ownerId = owner.id;
    const client = await prisma.client.create({
      data: { name: `Return FIFO Test Client ${Date.now()}`, type: 'restaurant', currency: 'USD' },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    if (createdShipmentIds.length) {
      await prisma.shipmentBag.deleteMany({ where: { shipmentId: { in: createdShipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: createdShipmentIds } } });
    }
    if (createdOrderIds.length) await prisma.clientOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    if (createdPackedStockIds.length) await prisma.packedStock.deleteMany({ where: { id: { in: createdPackedStockIds } } });
    if (createdSessionIds.length) {
      await prisma.packingSessionLot.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.packingSession.deleteMany({ where: { id: { in: createdSessionIds } } });
    }
    if (createdLotIds.length) await prisma.stockLot.deleteMany({ where: { id: { in: createdLotIds } } });
    if (createdBagTypeIds.length) await prisma.bagType.deleteMany({ where: { id: { in: createdBagTypeIds } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  it('adversarial: identical PackedStock.createdAt, different lot.dateReceived — a returned bag is credited to the OLDER-received lot\'s row first, regardless of physical insertion order', async () => {
    const bagType = await prisma.bagType.create({
      data: { name: `${TAG}_RET_${createdBagTypeIds.length}`, nominalKg: '5.000', costPerBag: '0.0500', workerRate: '0.1200' },
    });
    createdBagTypeIds.push(bagType.id);
    const bagTypeId = bagType.id;

    const supplierId = (await prisma.supplier.findFirst())!.id;
    const worker = await prisma.user.upsert({
      where: { clerkId: 'user_test_owner' }, update: {},
      create: { clerkId: 'user_test_owner', email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const olderLot = await prisma.stockLot.create({
      data: {
        charcoalType: `${TAG}_RET_A`, grade: 'A', supplierId,
        kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '1.0000',
        source: 'container', dateReceived: new Date('2026-08-01'),
      },
    });
    const newerLot = await prisma.stockLot.create({
      data: {
        charcoalType: `${TAG}_RET_B`, grade: 'B', supplierId,
        kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '2.0000',
        source: 'container', dateReceived: new Date('2026-08-15'),
      },
    });
    createdLotIds.push(olderLot.id, newerLot.id);

    const session = await prisma.packingSession.create({
      data: {
        workerId: worker.id, mode: 'stock',
        kgConsumed: '0', kgOutputTotal: '0', varianceKg: '0', sessionEarnings: '0',
        date: new Date(), completedAt: new Date(),
        sessionLots: { create: [{ lotId: olderLot.id, kgUsed: '0' }, { lotId: newerLot.id, kgUsed: '0' }] },
      },
    });
    createdSessionIds.push(session.id);

    // Adversarial: physically insert the NEWER lot's row first — a
    // createdAt-only order (matching physical layout for freshly-inserted
    // rows) would pick this one; the fixed order must still pick the older.
    await prisma.$transaction(async (tx) => {
      await tx.packedStock.createMany({
        data: [
          { lotId: newerLot.id, bagTypeId, quantity: 50, sessionId: session.id },
          { lotId: olderLot.id, bagTypeId, quantity: 50, sessionId: session.id },
        ],
      });
    });
    const created = await prisma.packedStock.findMany({ where: { sessionId: session.id } });
    createdPackedStockIds.push(...created.map((c) => c.id));
    expect(new Set(created.map((c) => c.createdAt.getTime())).size).toBe(1);
    const olderRow = created.find((c) => c.lotId === olderLot.id)!;
    const newerRow = created.find((c) => c.lotId === newerLot.id)!;

    // A shipment already 'delivered' with one bag line for this bagType —
    // built directly (not through createShipment()) so its reservation
    // history is irrelevant; logReturn() re-picks from ALL live PackedStock
    // rows of the bag type at return time, independent of what this
    // shipment originally drew from.
    const order = await prisma.clientOrder.create({
      data: {
        clientId, charcoalType: `${TAG}_RET_ORDER`, grade: 'A',
        totalKgRequested: '250.000', bagTypeId, pricePerBag: '4.50', currency: 'USD',
        status: 'delivered', createdById: ownerId,
      },
    });
    createdOrderIds.push(order.id);
    const shipment = await prisma.shipment.create({
      data: {
        orderId: order.id, address: '1 Test St', nominalKg: '250.000', status: 'delivered', deliveredAt: new Date(),
        bags: { create: [{ bagTypeId, quantity: 50 }] },
      },
    });
    createdShipmentIds.push(shipment.id);

    await shipments.logReturn(shipment.id, {}, { userId: CLERK_ID, role: 'owner' });

    const olderAfter = await prisma.packedStock.findUniqueOrThrow({ where: { id: olderRow.id } });
    const newerAfter = await prisma.packedStock.findUniqueOrThrow({ where: { id: newerRow.id } });
    expect(olderAfter.quantity).toBe(100); // 50 original + 50 returned
    expect(newerAfter.quantity).toBe(50); // untouched
  });
});
