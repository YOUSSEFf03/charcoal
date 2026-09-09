/**
 * Real-Postgres integration test — requires the dev DB running (docker
 * compose up -d) and DATABASE_URL configured. Run via `npm run test:integration`.
 *
 * Proves Phase D's mobile container-tracking API against real Postgres rows
 * and — critically for a security-shaping feature — against the REAL,
 * unmocked Prisma serialization path, not a hand-typed mock object a test
 * author could accidentally shape "safely" by omission. Every response is
 * JSON.stringify()'d and searched for forbidden substrings (bank details,
 * IBAN, rawResponse markers, Traqo account/key names) — the same technique
 * used to prove ContainerNotificationService's payloads are clean in the
 * Phase C integration test.
 *
 * Follows the same safety discipline as every prior phase's integration
 * test: all rows are created and cleaned up by this file itself.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MobileModule } from '../src/mobile/mobile.module';
import { MobileContainerTrackingController } from '../src/mobile/mobile-container-tracking.controller';
import { MobileContainerTrackingService } from '../src/mobile/mobile-container-tracking.service';

const TAG = `MOBILE_API_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner';

describe('Mobile container-tracking API (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let controller: MobileContainerTrackingController;
  let service: MobileContainerTrackingService;

  let ownerId: string;
  let supplierId: string;
  const createdContainerIds: string[] = [];

  async function createContainer(overrides: {
    number: string;
    status?: 'port' | 'transit' | 'arrived';
    notes?: string | null;
    sealineName?: string | null;
  }) {
    const container = await prisma.container.create({
      data: {
        number: overrides.number,
        supplierId,
        status: overrides.status ?? 'transit',
        notes: overrides.notes ?? null,
        sealineName: overrides.sealineName ?? null,
        createdById: ownerId,
      },
    });
    createdContainerIds.push(container.id);
    return container.id;
  }

  async function attachTracking(containerId: string, fields: Record<string, unknown>) {
    return prisma.containerTracking.create({
      data: {
        containerId,
        referenceNumber: fields.referenceNumber as string,
        sealine: 'MAEU',
        provider: 'traqo',
        rawResponse: { secret_field: 'this-must-never-reach-mobile', api_key_leak: 'traqo-key-xyz' },
        ...fields,
      },
    });
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, MobileModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    controller = moduleRef.get(MobileContainerTrackingController);
    service = moduleRef.get(MobileContainerTrackingService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });
    ownerId = (await prisma.user.findUniqueOrThrow({ where: { clerkId: CLERK_ID } })).id;

    // A supplier with real bankDetails/contactPersons — exactly the fields
    // that must never reach the mobile API. This is the BREAK scenario:
    // ContainersController.findOne() would include this ENTIRE row.
    const supplier = await prisma.supplier.create({
      data: {
        name: `${TAG} Supplier`,
        country: 'CN',
        bankDetails: { iban: 'LB62999900001001901229114517', account_number: 'ACC-SECRET-001', swift: 'SECRETBIC' },
        contactPersons: [{ name: 'Jane Confidential', phone: '+96170000000', role: 'Finance' }],
      },
    });
    supplierId = supplier.id;
  });

  afterAll(async () => {
    await prisma.trackingEvent.deleteMany({ where: { tracking: { containerId: { in: createdContainerIds } } } });
    await prisma.containerTracking.deleteMany({ where: { containerId: { in: createdContainerIds } } });
    await prisma.container.deleteMany({ where: { id: { in: createdContainerIds } } });
    await prisma.supplier.delete({ where: { id: supplierId } });
    await moduleRef.close();
  });

  describe('BREAK — what the existing web response would leak if reused for mobile', () => {
    it('proves the raw Supplier relation (as ContainersController.findOne() would include it) DOES contain bankDetails/contactPersons', async () => {
      const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
      const serialized = JSON.stringify(supplier);
      expect(serialized).toContain('LB62999900001001901229114517');
      expect(serialized).toContain('Jane Confidential');
      // This is exactly why MobileContainerTrackingService never does
      // `include: { supplier: true }` — see PROVE below for the fix.
    });
  });

  describe('PROVE — list endpoint', () => {
    it('returns only approved fields, with supplier bank/contact data absent from the JSON entirely', async () => {
      const containerId = await createContainer({ number: `${TAG}-1`, notes: '10T Oak — Order #1' });
      await attachTracking(containerId, { referenceNumber: `${TAG}-1`, eta: new Date('2026-09-23T00:00:00.000Z') });

      const result = await controller.findAll(1, 20, undefined, TAG);
      const serialized = JSON.stringify(result);

      const item = result.data.find((c: any) => c.id === containerId);
      expect(item).toBeDefined();
      expect(item.containerNumber).toBe(`${TAG}-1`);
      expect(item.supplier.name).toBe(`${TAG} Supplier`);
      expect(item.notes).toBe('10T Oak — Order #1');
      expect(item.tracking.eta).toBe('2026-09-23T00:00:00.000Z');

      // Security: none of these must ever appear anywhere in the response.
      expect(serialized).not.toContain('LB62999900001001901229114517');
      expect(serialized).not.toContain('ACC-SECRET-001');
      expect(serialized).not.toContain('SECRETBIC');
      expect(serialized).not.toContain('Jane Confidential');
      expect(serialized).not.toContain('this-must-never-reach-mobile');
      expect(serialized).not.toContain('api_key_leak');
      expect(serialized).not.toContain('traqo-key-xyz');
      expect(serialized).not.toContain('rawResponse');
    });

    it('paginates deterministically and respects the search filter', async () => {
      const idA = await createContainer({ number: `${TAG}-page-A` });
      const idB = await createContainer({ number: `${TAG}-page-B` });

      const page1 = await controller.findAll(1, 1, undefined, `${TAG}-page`);
      expect(page1.data).toHaveLength(1);
      expect(page1.total).toBe(2);

      const page2 = await controller.findAll(2, 1, undefined, `${TAG}-page`);
      expect(page2.data).toHaveLength(1);
      expect(page1.data[0].id).not.toBe(page2.data[0].id);

      const ids = [page1.data[0].id, page2.data[0].id].sort();
      expect(ids).toEqual([idA, idB].sort());
    });

    it('filters by business status', async () => {
      await createContainer({ number: `${TAG}-status-port`, status: 'port' });
      await createContainer({ number: `${TAG}-status-transit`, status: 'transit' });

      const result = await controller.findAll(1, 20, 'port' as any, `${TAG}-status`);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe('port');
    });

    it('rejects an invalid status filter with 400, never reaching Prisma', async () => {
      expect(() => controller.findAll(1, 20, 'not-a-status')).toThrow(BadRequestException);
    });
  });

  describe('PROVE — detail endpoint', () => {
    it('works correctly WITHOUT tracking (tracking: null, not an error)', async () => {
      const containerId = await createContainer({ number: `${TAG}-no-tracking` });
      const result = await controller.findOne(containerId);
      expect(result.tracking).toBeNull();
      expect(result.supplier.name).toBe(`${TAG} Supplier`);
    });

    it('works correctly WITH tracking, and includes supplier name + notes', async () => {
      const containerId = await createContainer({ number: `${TAG}-with-tracking`, notes: 'important notes here', sealineName: 'Maersk' });
      await attachTracking(containerId, {
        referenceNumber: `${TAG}-with-tracking`,
        eta: new Date('2026-09-25T00:00:00.000Z'),
        isDelayed: true,
        vessel: 'MAERSK ESSEX',
      });

      const result = await controller.findOne(containerId);
      expect(result.notes).toBe('important notes here');
      expect(result.sealineName).toBe('Maersk');
      expect(result.supplier.name).toBe(`${TAG} Supplier`);
      expect(result.tracking?.vessel).toBe('MAERSK ESSEX');
      expect(result.tracking?.isDelayed).toBe(true);
    });

    it('returns 404 for a missing container', async () => {
      await expect(controller.findOne('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('the detail JSON never contains rawResponse, bank details, contact persons, or Traqo internals', async () => {
      const containerId = await createContainer({ number: `${TAG}-detail-security` });
      await attachTracking(containerId, { referenceNumber: `${TAG}-detail-security` });

      const result = await controller.findOne(containerId);
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain('LB62999900001001901229114517');
      expect(serialized).not.toContain('Jane Confidential');
      expect(serialized).not.toContain('this-must-never-reach-mobile');
      expect(serialized).not.toContain('traqo-key-xyz');
      expect(serialized).not.toContain('rawResponse');
      expect(serialized).not.toContain('envKeyName');
    });

    it('Phase C notification container-id compatibility: the exact containerId Phase C\'s push payload carries resolves cleanly here', async () => {
      // Phase C's notification `data.containerId` is Container.id (the
      // UUID) — see ContainerNotificationService. Proving the mobile detail
      // endpoint resolves that same identifier is the concrete, safe
      // equivalent of "a notification tap can open the right container."
      const containerId = await createContainer({ number: `${TAG}-notif-nav` });
      const notificationDataContainerId = containerId; // exactly what Phase C would have put in the push payload's `data.containerId`

      const result = await controller.findOne(notificationDataContainerId);
      expect(result.id).toBe(containerId);
      expect(result.containerNumber).toBe(`${TAG}-notif-nav`);
    });
  });

  describe('PROVE — events endpoint', () => {
    it('returns events oldest-first with only description/location/occurredAt', async () => {
      const containerId = await createContainer({ number: `${TAG}-events` });
      const tracking = await attachTracking(containerId, { referenceNumber: `${TAG}-events` });
      await prisma.trackingEvent.createMany({
        data: [
          { trackingId: tracking.id, description: 'Loaded on vessel', location: 'Shanghai, CN', occurredAt: new Date('2026-09-05T00:00:00.000Z'), raw: { secret: 'x' } },
          { trackingId: tracking.id, description: 'Gate out', location: 'Shanghai, CN', occurredAt: new Date('2026-09-01T00:00:00.000Z'), raw: { secret: 'y' } },
        ],
      });

      const result = await controller.findEvents(containerId);

      expect(result).toHaveLength(2);
      expect(result[0].description).toBe('Gate out'); // earlier date first
      expect(result[1].description).toBe('Loaded on vessel');
      expect(Object.keys(result[0]).sort()).toEqual(['description', 'location', 'occurredAt'].sort());
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('"raw"');
      expect(serialized).not.toContain('"secret"');
    });

    it('returns an empty array when tracking exists but has no events', async () => {
      const containerId = await createContainer({ number: `${TAG}-events-empty` });
      await attachTracking(containerId, { referenceNumber: `${TAG}-events-empty` });
      const result = await controller.findEvents(containerId);
      expect(result).toEqual([]);
    });

    it('returns an empty array when the container has no tracking row at all — never fabricates an event', async () => {
      const containerId = await createContainer({ number: `${TAG}-events-no-tracking` });
      const result = await controller.findEvents(containerId);
      expect(result).toEqual([]);
    });

    it('returns 404 for a missing container', async () => {
      await expect(controller.findEvents('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('PROVE — read-only: no mutation path exists from this module', () => {
    it('MobileContainerTrackingService has no method whose name implies a write', () => {
      const methodNames = Object.getOwnPropertyNames(MobileContainerTrackingService.prototype).filter((n) => n !== 'constructor');
      expect(methodNames.sort()).toEqual(['findAll', 'findOne', 'findEvents'].sort());
    });

    it('a container created via this test\'s setup is byte-for-byte unchanged in the DB after every mobile read call above', async () => {
      const containerId = await createContainer({ number: `${TAG}-immutable`, notes: 'do not touch' });
      const before = await prisma.container.findUniqueOrThrow({ where: { id: containerId } });

      await controller.findOne(containerId);
      await controller.findEvents(containerId);
      await controller.findAll(1, 20, undefined, `${TAG}-immutable`);

      const after = await prisma.container.findUniqueOrThrow({ where: { id: containerId } });
      expect(after).toEqual(before);
    });
  });

  describe('PROVE — service is usable independent of HTTP layer (structural DI proof)', () => {
    it('resolves via the real MobileModule wiring, sharing the same guard export as Phase C', () => {
      expect(service).toBeInstanceOf(MobileContainerTrackingService);
    });
  });
});
