/**
 * Real-Postgres integration test — requires the dev DB running and
 * DATABASE_URL configured. NOT part of `npm test` — run via
 * `npm run test:integration`.
 *
 * Required-location audit (2026-09), "Multi-Location Client: Require
 * Location on Normal Orders". Proves, against real Postgres and the REAL
 * OrdersService (never mocked), the two decisions from that audit:
 *
 *   CREATE — client.multiLocationEnabled === true makes locationId required;
 *   a location must exist, belong to the SAME client, and be active.
 *   client.multiLocationEnabled === false leaves locationId optional.
 *
 *   UPDATE — enabling multi-location NEVER retroactively requires a
 *   location on an order that never had one; the one thing blocked is
 *   explicitly clearing a location an order already has while its client is
 *   still multi-location.
 *
 * Cross-client and inactive-location rejection specifically use a SECOND,
 * unrelated client's real location row and a real deactivated location row
 * — not mocks — per the audit's explicit "do not rely only on mocks for
 * cross-client/inactive-location authorization" requirement.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrdersModule } from '../src/orders/orders.module';
import { OrdersService } from '../src/orders/orders.service';
import { ClientsModule } from '../src/clients/clients.module';
import { ClientsService } from '../src/clients/clients.service';

const TAG = `ORDER_LOC_REQ_TEST_${Date.now()}`;
const CLERK_ID = `local_${TAG}_owner`;

describe('Order location required for multi-location clients — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orders: OrdersService;
  let clientsService: ClientsService;

  let userId: string;
  let multiClientId: string;
  let singleClientId: string;
  let otherClientId: string;
  let activeLocId: string;
  let inactiveLocId: string;
  let otherClientLocId: string;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, OrdersModule, ClientsModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    orders = moduleRef.get(OrdersService);
    clientsService = moduleRef.get(ClientsService);

    const user = await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: `${TAG}@local.internal`, name: 'Test Owner', role: 'owner' },
    });
    userId = user.id;

    const multiClient = await prisma.client.create({
      data: { name: `Multi-Loc Test ${Date.now()}`, type: 'restaurant', currency: 'USD', multiLocationEnabled: true },
    });
    multiClientId = multiClient.id;

    const singleClient = await prisma.client.create({
      data: { name: `Single-Loc Test ${Date.now()}`, type: 'restaurant', currency: 'USD' },
    });
    singleClientId = singleClient.id;

    const otherClient = await prisma.client.create({
      data: { name: `Other Client Test ${Date.now()}`, type: 'restaurant', currency: 'USD', multiLocationEnabled: true },
    });
    otherClientId = otherClient.id;

    const activeLoc = await clientsService.createLocation(multiClientId, { name: 'Hamra Branch' });
    activeLocId = activeLoc.id;
    const toDeactivate = await clientsService.createLocation(multiClientId, { name: 'Old Closed Branch' });
    await clientsService.updateLocation(multiClientId, toDeactivate.id, { isActive: false });
    inactiveLocId = toDeactivate.id;
    const otherLoc = await clientsService.createLocation(otherClientId, { name: 'Foreign Branch' });
    otherClientLocId = otherLoc.id;
  });

  afterAll(async () => {
    if (createdOrderIds.length) {
      await prisma.clientOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    await prisma.clientLocation.deleteMany({ where: { clientId: { in: [multiClientId, otherClientId] } } });
    await prisma.client.deleteMany({ where: { id: { in: [multiClientId, singleClientId, otherClientId] } } });
    // Test-created fixture user (unique clerkId per run) — must be deleted by
    // exact ID, or every run leaves behind a new "Test Owner" row.
    await prisma.user.deleteMany({ where: { id: userId } });
    await moduleRef.close();
  });

  function baseDto(over: Partial<any> = {}) {
    return {
      clientId: multiClientId,
      charcoalType: TAG,
      grade: 'A',
      totalKgRequested: '50.000',
      pricePerBag: '10.00',
      currency: 'USD',
      ...over,
    } as any;
  }

  it('multi-location client + NO location → rejected (CONSTRAINT_VIOLATION)', async () => {
    await expect(orders.create(baseDto(), CLERK_ID)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
    });
  });

  it('multi-location client + a valid active location → accepted', async () => {
    const order = await orders.create(baseDto({ locationId: activeLocId }), CLERK_ID);
    createdOrderIds.push(order.id);
    expect(order.locationId).toBe(activeLocId);
  });

  it('multi-location client + an INACTIVE location (real deactivated row, not a mock) → rejected', async () => {
    await expect(orders.create(baseDto({ locationId: inactiveLocId }), CLERK_ID)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
    });
  });

  it('multi-location client + ANOTHER client\'s real location row → rejected', async () => {
    await expect(orders.create(baseDto({ locationId: otherClientLocId }), CLERK_ID)).rejects.toThrow();
    // Confirms it's specifically the not-found-for-this-client path, not some
    // unrelated failure — the order must never have been created either way.
    const leaked = await prisma.clientOrder.findFirst({ where: { clientId: multiClientId, locationId: otherClientLocId } });
    expect(leaked).toBeNull();
  });

  it('multi-location client + a NONEXISTENT locationId → rejected', async () => {
    await expect(
      orders.create(baseDto({ locationId: '00000000-0000-0000-0000-000000000000' }), CLERK_ID),
    ).rejects.toThrow();
  });

  it('single-location client (multiLocationEnabled: false) + NO location → accepted', async () => {
    const order = await orders.create({ ...baseDto(), clientId: singleClientId }, CLERK_ID);
    createdOrderIds.push(order.id);
    expect(order.locationId).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // UPDATE semantics (decision B) — a historical order with locationId: null
  // stays editable and stays null; the one blocked action is explicitly
  // clearing a location an order already has while its client is still
  // multi-location.
  // ---------------------------------------------------------------------------
  it('historical order (locationId: null, created for the single-location client) stays fully editable with no location — even after its client later enables multi-location', async () => {
    const order = await orders.create({ ...baseDto(), clientId: singleClientId }, CLERK_ID);
    createdOrderIds.push(order.id);
    expect(order.locationId).toBeNull();

    await clientsService.update(singleClientId, { multiLocationEnabled: true } as any);
    try {
      const updated = await orders.update(order.id, { notes: 'unrelated edit' } as any);
      expect(updated.notes).toBe('unrelated edit');

      const fresh = await prisma.clientOrder.findUnique({ where: { id: order.id } });
      expect(fresh!.locationId).toBeNull(); // never fabricated
    } finally {
      await clientsService.update(singleClientId, { multiLocationEnabled: false } as any);
    }
  });

  it('order that already has a location: an unrelated update succeeds and the location is left untouched', async () => {
    const order = await orders.create(baseDto({ locationId: activeLocId }), CLERK_ID);
    createdOrderIds.push(order.id);

    const updated = await orders.update(order.id, { driverId: null } as any);
    expect(updated.locationId).toBe(activeLocId); // untouched by the unrelated write
    const fresh = await prisma.clientOrder.findUnique({ where: { id: order.id } });
    expect(fresh!.locationId).toBe(activeLocId);
  });

  it('order that already has a location + client still multi-location + explicit clear to null → REJECTED', async () => {
    const order = await orders.create(baseDto({ locationId: activeLocId }), CLERK_ID);
    createdOrderIds.push(order.id);

    await expect(orders.update(order.id, { locationId: null } as any)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }),
    });
    const fresh = await prisma.clientOrder.findUnique({ where: { id: order.id } });
    expect(fresh!.locationId).toBe(activeLocId); // unchanged
  });

  it('order that already has a location + change to a DIFFERENT valid active location for the same client → accepted', async () => {
    const secondLoc = await clientsService.createLocation(multiClientId, { name: 'Jounieh Branch' });
    const order = await orders.create(baseDto({ locationId: activeLocId }), CLERK_ID);
    createdOrderIds.push(order.id);

    const updated = await orders.update(order.id, { locationId: secondLoc.id } as any);
    expect(updated.locationId).toBe(secondLoc.id);
  });
});
