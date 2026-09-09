import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { TraqoAccountsService } from './traqo-accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { TraqoKeyResolver } from '../containers/tracking/traqo-key-resolver.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

describe('TraqoAccountsService', () => {
  let service: TraqoAccountsService;
  let prisma: any;
  let keyResolver: any;

  beforeEach(() => {
    prisma = {
      traqoAccount: { findMany: fn(), findUnique: fn(), update: fn() },
      containerTrackingAssignment: { groupBy: fn() },
    };
    keyResolver = { resolve: fn() };
    service = new TraqoAccountsService(prisma as unknown as PrismaService, keyResolver as unknown as TraqoKeyResolver);
  });

  describe('listWithUsage', () => {
    it('never includes a raw key value — only envKeyName and a keyConfigured boolean', async () => {
      prisma.traqoAccount.findMany.mockResolvedValue([
        { id: 'a1', name: 'Account 1', envKeyName: 'TRAQO_API_KEY_1', active: true, status: 'healthy', priority: 1, maxContainers: 4, unavailableUntil: null, lastFailureAt: null, lastFailureKind: null },
      ]);
      prisma.containerTrackingAssignment.groupBy.mockResolvedValue([]);
      keyResolver.resolve.mockReturnValue('sk_real_secret_value_should_never_appear');

      const result = await service.listWithUsage();

      const json = JSON.stringify(result);
      expect(json).not.toContain('sk_real_secret_value_should_never_appear');
      expect(result[0]).toMatchObject({ envKeyName: 'TRAQO_API_KEY_1', keyConfigured: true });
      expect(result[0]).not.toHaveProperty('apiKey');
      expect(result[0]).not.toHaveProperty('key');
    });

    it('reports keyConfigured: false when the resolver finds no value', async () => {
      prisma.traqoAccount.findMany.mockResolvedValue([
        { id: 'a2', name: 'Account 2', envKeyName: 'TRAQO_API_KEY_2', active: true, status: 'healthy', priority: 2, maxContainers: 4, unavailableUntil: null, lastFailureAt: null, lastFailureKind: null },
      ]);
      prisma.containerTrackingAssignment.groupBy.mockResolvedValue([]);
      keyResolver.resolve.mockReturnValue(undefined);

      const result = await service.listWithUsage();
      expect(result[0].keyConfigured).toBe(false);
    });

    it('computes activeContainers from the groupBy count, per account', async () => {
      prisma.traqoAccount.findMany.mockResolvedValue([
        { id: 'a1', name: 'Account 1', envKeyName: 'TRAQO_API_KEY_1', active: true, status: 'healthy', priority: 1, maxContainers: 4, unavailableUntil: null, lastFailureAt: null, lastFailureKind: null },
        { id: 'a2', name: 'Account 2', envKeyName: 'TRAQO_API_KEY_2', active: true, status: 'healthy', priority: 2, maxContainers: 4, unavailableUntil: null, lastFailureAt: null, lastFailureKind: null },
      ]);
      prisma.containerTrackingAssignment.groupBy.mockResolvedValue([
        { traqoAccountId: 'a1', _count: { _all: 4 } },
      ]);
      keyResolver.resolve.mockReturnValue('x');

      const result = await service.listWithUsage();
      expect(result.find((r) => r.id === 'a1')?.activeContainers).toBe(4);
      expect(result.find((r) => r.id === 'a2')?.activeContainers).toBe(0);
    });
  });

  describe('setActive', () => {
    it('throws NotFoundException for an unknown account id', async () => {
      prisma.traqoAccount.findUnique.mockResolvedValue(null);
      await expect(service.setActive('missing', false)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.traqoAccount.update).not.toHaveBeenCalled();
    });

    it('toggles active on/off', async () => {
      prisma.traqoAccount.findUnique.mockResolvedValue({ id: 'a1' });
      await service.setActive('a1', false);
      expect(prisma.traqoAccount.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { active: false } });
    });
  });
});
