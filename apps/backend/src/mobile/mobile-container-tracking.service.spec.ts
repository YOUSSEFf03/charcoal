import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { MobileContainerTrackingService } from './mobile-container-tracking.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

const CONTAINER_ROW = {
  id: 'container-1',
  number: 'MSCU1234567',
  status: 'transit',
  arrivalDate: null,
  notes: 'Order #245',
  sealineName: 'Maersk',
  supplier: { name: 'ABC Charcoal Trading', country: 'CN' },
  tracking: {
    status: 'IN_TRANSIT', origin: 'Shanghai, CN', destination: 'Beirut, LB',
    vessel: 'MAERSK ESSEX', voyage: '412W', currentLocation: 'Port Said, EG',
    eta: new Date('2026-09-23T00:00:00.000Z'), isDelayed: false, isActive: true,
    providerUpdatedAt: new Date('2026-09-20T00:00:00.000Z'), lastFetchedAt: new Date('2026-09-20T01:00:00.000Z'),
  },
};

describe('MobileContainerTrackingService', () => {
  let service: MobileContainerTrackingService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      container: { findMany: fn(), count: fn(), findUnique: fn() },
      trackingEvent: { findMany: fn() },
      $transaction: fn().mockImplementation((ops: any[]) => Promise.all(ops)),
    };
    service = new MobileContainerTrackingService(prisma as unknown as PrismaService);
  });

  describe('findAll', () => {
    it('queries with the safe select shape, default ordering, and pagination', async () => {
      prisma.container.findMany.mockResolvedValue([CONTAINER_ROW]);
      prisma.container.count.mockResolvedValue(1);

      const result = await service.findAll(2, 10);

      expect(prisma.container.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: { createdAt: 'desc' },
          skip: 10,
          take: 10,
          select: expect.objectContaining({
            id: true, number: true, status: true, arrivalDate: true, notes: true, sealineName: true,
            supplier: { select: { name: true, country: true } },
          }),
        }),
      );
      expect(result).toEqual({ data: [expect.objectContaining({ id: 'container-1', containerNumber: 'MSCU1234567' })], total: 1, page: 2, limit: 10 });
    });

    it('never selects rawResponse, events, Traqo account fields, or supplier bankDetails/contactPersons', async () => {
      prisma.container.findMany.mockResolvedValue([]);
      prisma.container.count.mockResolvedValue(0);

      await service.findAll(1, 20);

      const call = prisma.container.findMany.mock.calls[0][0];
      const selectStr = JSON.stringify(call.select);
      expect(selectStr).not.toContain('rawResponse');
      expect(selectStr).not.toContain('bankDetails');
      expect(selectStr).not.toContain('contactPersons');
      expect(selectStr).not.toContain('events');
      expect(selectStr).not.toContain('traqoAccount');
      expect(selectStr).not.toContain('trackingAssignments');
      expect(selectStr).not.toContain('expenses');
      expect(selectStr).not.toContain('productLines');
      expect(selectStr).not.toContain('supplierPayments');
    });

    it('applies a status filter when provided', async () => {
      prisma.container.findMany.mockResolvedValue([]);
      prisma.container.count.mockResolvedValue(0);
      await service.findAll(1, 20, 'arrived' as any);
      expect(prisma.container.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'arrived' } }));
    });

    it('applies a case-insensitive search filter on container number when provided', async () => {
      prisma.container.findMany.mockResolvedValue([]);
      prisma.container.count.mockResolvedValue(0);
      await service.findAll(1, 20, undefined, 'msc');
      expect(prisma.container.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { number: { contains: 'msc', mode: 'insensitive' } } }),
      );
    });

    it('combines status and search filters', async () => {
      prisma.container.findMany.mockResolvedValue([]);
      prisma.container.count.mockResolvedValue(0);
      await service.findAll(1, 20, 'transit' as any, 'msc');
      expect(prisma.container.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'transit', number: { contains: 'msc', mode: 'insensitive' } } }),
      );
    });

    it('returns an empty data array with correct total when there are no containers', async () => {
      prisma.container.findMany.mockResolvedValue([]);
      prisma.container.count.mockResolvedValue(0);
      const result = await service.findAll(1, 20);
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });
  });

  describe('findOne', () => {
    it('returns the mapped detail shape for an existing container', async () => {
      prisma.container.findUnique.mockResolvedValue(CONTAINER_ROW);
      const result = await service.findOne('container-1');
      expect(result.id).toBe('container-1');
      expect(result.supplier.name).toBe('ABC Charcoal Trading');
      expect(result.tracking?.eta).toBe('2026-09-23T00:00:00.000Z');
    });

    it('throws NotFoundException for a missing container', async () => {
      prisma.container.findUnique.mockResolvedValue(null);
      await expect(service.findOne('does-not-exist')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns tracking: null (not an error) when the container has never been refreshed', async () => {
      prisma.container.findUnique.mockResolvedValue({ ...CONTAINER_ROW, tracking: null });
      const result = await service.findOne('container-1');
      expect(result.tracking).toBeNull();
    });

    it('never selects rawResponse or full supplier fields for the detail query either', async () => {
      prisma.container.findUnique.mockResolvedValue(CONTAINER_ROW);
      await service.findOne('container-1');
      const call = prisma.container.findUnique.mock.calls[0][0];
      const selectStr = JSON.stringify(call.select);
      expect(selectStr).not.toContain('rawResponse');
      expect(selectStr).not.toContain('bankDetails');
      expect(selectStr).not.toContain('contactPersons');
    });
  });

  describe('findEvents', () => {
    it('throws NotFoundException for a missing container', async () => {
      prisma.container.findUnique.mockResolvedValue(null);
      await expect(service.findEvents('does-not-exist')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.trackingEvent.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty array (not an error) when the container has no tracking row yet', async () => {
      prisma.container.findUnique.mockResolvedValue({ tracking: null });
      const result = await service.findEvents('container-1');
      expect(result).toEqual([]);
      expect(prisma.trackingEvent.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty array when the tracking row has zero events', async () => {
      prisma.container.findUnique.mockResolvedValue({ tracking: { id: 'trk-1' } });
      prisma.trackingEvent.findMany.mockResolvedValue([]);
      const result = await service.findEvents('container-1');
      expect(result).toEqual([]);
    });

    it('orders events oldest-first (occurredAt asc) — matching ContainerTrackingService.getTracking()\'s existing convention', async () => {
      prisma.container.findUnique.mockResolvedValue({ tracking: { id: 'trk-1' } });
      prisma.trackingEvent.findMany.mockResolvedValue([
        { description: 'Gate out', location: 'Shanghai, CN', occurredAt: new Date('2026-09-01T00:00:00.000Z') },
      ]);

      await service.findEvents('container-1');

      expect(prisma.trackingEvent.findMany).toHaveBeenCalledWith({
        where: { trackingId: 'trk-1' },
        select: { description: true, location: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
      });
    });

    it('never selects the raw field', async () => {
      prisma.container.findUnique.mockResolvedValue({ tracking: { id: 'trk-1' } });
      prisma.trackingEvent.findMany.mockResolvedValue([]);
      await service.findEvents('container-1');
      const call = prisma.trackingEvent.findMany.mock.calls[0][0];
      expect(JSON.stringify(call.select)).not.toContain('"raw"');
    });
  });
});
