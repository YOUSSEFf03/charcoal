import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhooksController } from './webhooks.controller';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

describe('WebhooksController', () => {
  let controller: WebhooksController;

  const mockPrisma = {
    user: {
      upsert:     fn(),
      updateMany: fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-secret') } },
      ],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);
  });

  // =========================================================================
  // AC1 — same user.created delivered twice → exactly one row
  //
  // The guarantee comes from Prisma's upsert being a single atomic statement
  // keyed on the unique clerkId index. Two concurrent deliveries both run
  // upsert; the second one hits the update arm rather than inserting a new row.
  // =========================================================================

  describe('upsertUser()', () => {
    const userData = {
      id: 'clerk_abc123',
      email_addresses: [{ id: 'em_1', email_address: 'alice@example.com' }],
      primary_email_address_id: 'em_1',
      first_name: 'Alice',
      last_name:  'Smith',
      public_metadata: { role: 'worker' },
    };

    it('AC1: two deliveries of the same event call upsert twice but are keyed on clerkId — DB cannot insert a duplicate row', async () => {
      mockPrisma.user.upsert.mockResolvedValue({
        id: 'local-uuid',
        clerkId: 'clerk_abc123',
        email: 'alice@example.com',
        name: 'Alice Smith',
        role: Role.worker,
        deletedAt: null,
      });

      // Simulate Svix delivering the same event twice (e.g. on a retry).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (controller as any).upsertUser(userData);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (controller as any).upsertUser(userData);

      expect(mockPrisma.user.upsert).toHaveBeenCalledTimes(2);

      const first = mockPrisma.user.upsert.mock.calls[0][0];
      const second = mockPrisma.user.upsert.mock.calls[1][0];

      // Both calls must use the same where key — the DB unique constraint on
      // clerkId is what prevents a second row from being created.
      expect(first.where).toEqual({ clerkId: 'clerk_abc123' });
      expect(second.where).toEqual({ clerkId: 'clerk_abc123' });
    });

    it('AC1: create arm contains all required fields', async () => {
      mockPrisma.user.upsert.mockResolvedValue({});

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (controller as any).upsertUser(userData);

      const { create } = mockPrisma.user.upsert.mock.calls[0][0];
      expect(create).toMatchObject({
        clerkId: 'clerk_abc123',
        email:   'alice@example.com',
        name:    'Alice Smith',
        role:    Role.worker,
      });
    });

    it('AC1: update arm resets deletedAt to null so a re-invited user is fully restored', async () => {
      mockPrisma.user.upsert.mockResolvedValue({});

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (controller as any).upsertUser(userData);

      const { update } = mockPrisma.user.upsert.mock.calls[0][0];
      expect(update).toMatchObject({ deletedAt: null });
    });

    it('AC1: falls back to first email when primary_email_address_id is absent', async () => {
      mockPrisma.user.upsert.mockResolvedValue({});

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (controller as any).upsertUser({
        ...userData,
        primary_email_address_id: null,
      });

      const { create } = mockPrisma.user.upsert.mock.calls[0][0];
      expect(create.email).toBe('alice@example.com');
    });

    it('AC1: uses clerkId placeholder email when no email addresses are present', async () => {
      mockPrisma.user.upsert.mockResolvedValue({});

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (controller as any).upsertUser({ id: 'clerk_abc123' });

      const { create } = mockPrisma.user.upsert.mock.calls[0][0];
      expect(create.email).toBe('clerk_abc123@unknown.local');
    });
  });

  // =========================================================================
  // AC2 — user.deleted → soft-delete without orphaning referencing rows
  //
  // Hard delete is intentionally absent: the User row is referenced by FK
  // columns in containers, packing_sessions, stock_exits, payments,
  // cash_handovers, driver_trips, stock_adjustments, and bag_purchases.
  // Removing it would violate FK constraints or orphan audit records.
  // =========================================================================

  describe('deleteUser()', () => {
    const userData = { id: 'clerk_abc123', deleted: true };

    it('AC2: sets deletedAt to a non-null Date on the matching user row', async () => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      const before = new Date();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (controller as any).deleteUser(userData);
      const after = new Date();

      expect(mockPrisma.user.updateMany).toHaveBeenCalledTimes(1);
      const { where, data } = mockPrisma.user.updateMany.mock.calls[0][0];

      expect(where).toMatchObject({ clerkId: 'clerk_abc123', deletedAt: null });
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect((data.deletedAt as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect((data.deletedAt as Date).getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('AC2: uses updateMany (not delete/deleteMany) so referencing FK rows are never touched', async () => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (controller as any).deleteUser(userData);

      // The only prisma.user method that should be called is updateMany.
      expect(mockPrisma.user.updateMany).toHaveBeenCalled();
    });

    it('AC2: user absent from DB is silently ignored — updateMany returns count:0 without throwing', async () => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((controller as any).deleteUser(userData)).resolves.not.toThrow();
    });

    it('AC2: second delivery of the same user.deleted is idempotent — where filter on deletedAt:null matches nothing', async () => {
      // First delivery soft-deletes the row (count: 1).
      // Second delivery: deletedAt is no longer null → updateMany matches nothing (count: 0).
      mockPrisma.user.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (controller as any).deleteUser(userData);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (controller as any).deleteUser(userData);

      expect(mockPrisma.user.updateMany).toHaveBeenCalledTimes(2);

      // Both calls must carry the deletedAt: null guard.
      for (const call of mockPrisma.user.updateMany.mock.calls) {
        expect(call[0].where).toMatchObject({ clerkId: 'clerk_abc123', deletedAt: null });
      }
    });
  });
});
