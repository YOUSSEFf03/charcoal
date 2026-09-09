import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { DeviceRegistryService } from './device-registry.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

describe('DeviceRegistryService', () => {
  let service: DeviceRegistryService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      deviceToken: {
        upsert: fn(),
        findMany: fn(),
        updateMany: fn(),
        findUnique: fn(),
        update: fn(),
      },
    };
    service = new DeviceRegistryService(prisma as unknown as PrismaService);
  });

  describe('register', () => {
    it('upserts by token (idempotent — same token never creates a duplicate row)', async () => {
      prisma.deviceToken.upsert.mockResolvedValue({ id: 'dev-1', platform: 'ios', active: true, token: 'ExponentPushToken[abc]' });

      await service.register({ token: 'ExponentPushToken[abc]', platform: 'ios' as any });

      expect(prisma.deviceToken.upsert).toHaveBeenCalledWith({
        where: { token: 'ExponentPushToken[abc]' },
        update: expect.objectContaining({ platform: 'ios', active: true }),
        create: expect.objectContaining({ token: 'ExponentPushToken[abc]', platform: 'ios' }),
      });
    });

    it('reactivates a previously-inactive device on re-registration', async () => {
      prisma.deviceToken.upsert.mockResolvedValue({ id: 'dev-1', platform: 'ios', active: true, token: 'ExponentPushToken[abc]' });

      await service.register({ token: 'ExponentPushToken[abc]', platform: 'ios' as any });

      expect(prisma.deviceToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ active: true }) }),
      );
    });

    it('never returns the raw token in its response', async () => {
      prisma.deviceToken.upsert.mockResolvedValue({ id: 'dev-1', platform: 'ios', active: true, token: 'ExponentPushToken[super-secret-ish]' });

      const result = await service.register({ token: 'ExponentPushToken[super-secret-ish]', platform: 'ios' as any });

      expect(result).toEqual({ id: 'dev-1', platform: 'ios', active: true });
      expect(JSON.stringify(result)).not.toContain('super-secret-ish');
    });
  });

  describe('findActiveTokens', () => {
    it('queries only active devices and returns just their tokens', async () => {
      prisma.deviceToken.findMany.mockResolvedValue([{ token: 'a' }, { token: 'b' }]);
      const tokens = await service.findActiveTokens();
      expect(prisma.deviceToken.findMany).toHaveBeenCalledWith({ where: { active: true }, select: { token: true } });
      expect(tokens).toEqual(['a', 'b']);
    });
  });

  describe('deactivateTokens', () => {
    it('marks the given tokens inactive', async () => {
      await service.deactivateTokens(['bad-token']);
      expect(prisma.deviceToken.updateMany).toHaveBeenCalledWith({
        where: { token: { in: ['bad-token'] } },
        data: { active: false },
      });
    });

    it('is a no-op for an empty list — never issues a pointless query', async () => {
      await service.deactivateTokens([]);
      expect(prisma.deviceToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('listAll', () => {
    it('selects only safe fields — never the token', async () => {
      prisma.deviceToken.findMany.mockResolvedValue([
        { id: 'dev-1', platform: 'ios', appVersion: '1.0.0', active: true, createdAt: new Date(), updatedAt: new Date(), lastSeenAt: new Date() },
      ]);

      const result = await service.listAll();

      expect(prisma.deviceToken.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          platform: true,
          appVersion: true,
          active: true,
          createdAt: true,
          updatedAt: true,
          lastSeenAt: true,
        },
      });
      expect(result).toHaveLength(1);
      expect(JSON.stringify(result)).not.toMatch(/ExponentPushToken|token/i);
    });
  });

  describe('revoke', () => {
    it('deactivates an existing active device and returns a minimal, token-free shape', async () => {
      prisma.deviceToken.findUnique.mockResolvedValue({ id: 'dev-1', active: true, token: 'ExponentPushToken[secret]' });

      const result = await service.revoke('dev-1');

      expect(prisma.deviceToken.update).toHaveBeenCalledWith({ where: { id: 'dev-1' }, data: { active: false } });
      expect(result).toEqual({ id: 'dev-1', active: false });
      expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('is idempotent — revoking an already-inactive device succeeds without issuing a redundant update', async () => {
      prisma.deviceToken.findUnique.mockResolvedValue({ id: 'dev-1', active: false, token: 'x' });

      const result = await service.revoke('dev-1');

      expect(prisma.deviceToken.update).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'dev-1', active: false });
    });

    it('throws NotFoundException for an unknown device id — never silently succeeds', async () => {
      prisma.deviceToken.findUnique.mockResolvedValue(null);

      await expect(service.revoke('does-not-exist')).rejects.toThrow(NotFoundException);
      expect(prisma.deviceToken.update).not.toHaveBeenCalled();
    });
  });
});
