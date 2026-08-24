import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// PR 6 (Cash Management System, Phase 1) — the new validateCashCapable() check
// that LedgerWriteService.creditAccount() now calls before writing anything.
// Only this new method is covered here; the rest of UsersService is untouched
// by PR 6 and out of scope for this file.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

describe('UsersService.validateCashCapable()', () => {
  let service: UsersService;
  const mockPrisma = { user: { findUnique: fn() } };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(mockPrisma as any);
  });

  it('resolves without throwing when the user exists and is not soft-deleted', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', deletedAt: null });

    await expect(service.validateCashCapable('user-1')).resolves.toBeUndefined();
  });

  it('throws NotFoundException when the user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(service.validateCashCapable('nonexistent-id')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.validateCashCapable('nonexistent-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_FOUND' }),
    });
  });

  it('throws NotFoundException when the user is soft-deleted', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-2', deletedAt: new Date('2026-01-01') });

    await expect(service.validateCashCapable('user-2')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('looks up the user by the exact id passed in', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-3', deletedAt: null });

    await service.validateCashCapable('user-3');

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-3' } });
  });
});

// ---------------------------------------------------------------------------
// Receiver deletion safety (Finding #13 fix) — UserAccount/AccountEntry
// cascade-delete with the User row (schema.prisma), so deleteLocal() must
// refuse to delete a local user who still has an outstanding balance —
// otherwise that balance and its entire AccountEntry audit trail are
// silently and irrecoverably destroyed.
// ---------------------------------------------------------------------------

describe('UsersService.deleteLocal()', () => {
  let service: UsersService;
  const mockPrisma = {
    user: { findUnique: fn(), delete: fn() },
    userAccount: { findUnique: fn() },
    worker: { findUnique: fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no linked worker, so the pre-existing tests below (written
    // before the LINKED_TO_WORKER guard existed) keep exercising exactly the
    // balance/local-user paths they were written for.
    mockPrisma.worker.findUnique.mockResolvedValue(null);
    service = new UsersService(mockPrisma as any);
  });

  it('rejects deletion when the local receiver has a non-zero UserAccount balance', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'receiver-1', clerkId: 'local_abc' });
    mockPrisma.userAccount.findUnique.mockResolvedValue({
      id: 'acct-1', userId: 'receiver-1', balance: { toString: () => '340.00' },
    });

    await expect(service.deleteLocal('receiver-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteLocal('receiver-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'OUTSTANDING_BALANCE' }),
    });
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('allows deletion when the local receiver has a UserAccount with a zero balance', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'receiver-2', clerkId: 'local_abc' });
    mockPrisma.userAccount.findUnique.mockResolvedValue({
      id: 'acct-2', userId: 'receiver-2', balance: { toString: () => '0.00' },
    });
    mockPrisma.user.delete.mockResolvedValue({ id: 'receiver-2' });

    await expect(service.deleteLocal('receiver-2')).resolves.toEqual({ id: 'receiver-2' });
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'receiver-2' } });
  });

  it('allows deletion when the local user has no UserAccount at all — preserves existing behavior', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-4', clerkId: 'local_xyz' });
    mockPrisma.userAccount.findUnique.mockResolvedValue(null);
    mockPrisma.user.delete.mockResolvedValue({ id: 'user-4' });

    await expect(service.deleteLocal('user-4')).resolves.toEqual({ id: 'user-4' });
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-4' } });
  });

  it('rejects deletion of a non-local (Clerk-linked) user — existing behavior preserved, balance never checked', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-5', clerkId: 'clerk_real_id' });

    await expect(service.deleteLocal('user-5')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteLocal('user-5')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_LOCAL_USER' }),
    });
    expect(mockPrisma.userAccount.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the user does not exist — existing findOne() behavior preserved', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(service.deleteLocal('nonexistent-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.userAccount.findUnique).not.toHaveBeenCalled();
  });

  it('checks the balance by the exact userId — same lookup key convention as LedgerWriteService', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'receiver-6', clerkId: 'local_abc' });
    mockPrisma.userAccount.findUnique.mockResolvedValue(null);
    mockPrisma.user.delete.mockResolvedValue({ id: 'receiver-6' });

    await service.deleteLocal('receiver-6');

    expect(mockPrisma.userAccount.findUnique).toHaveBeenCalledWith({ where: { userId: 'receiver-6' } });
  });

  // -------------------------------------------------------------------------
  // Final-audit regression: a worker's linked account (Worker.userId, see the
  // 20260821000000_add_worker_user_link migration) has a synthetic clerkId
  // `local_worker_<id>` — which also starts with 'local_', so it passed the
  // NOT_LOCAL_USER check and was deletable from the generic "Users & roles"
  // admin list with no guard. Worker.userId is ON DELETE SET NULL, so this
  // silently unlinked the worker (no FK error) and reintroduced the exact bug
  // that migration fixed, with no visible connection in that UI warning the
  // owner they'd just broken it.
  // -------------------------------------------------------------------------

  it('rejects deletion of a user linked to a Worker, even with zero balance and a local_ clerkId', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-7', clerkId: 'local_worker_w1' });
    mockPrisma.worker.findUnique.mockResolvedValue({ id: 'w1', name: 'Hassan Mahmoud', userId: 'user-7' });

    await expect(service.deleteLocal('user-7')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteLocal('user-7')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'LINKED_TO_WORKER' }),
    });
    expect(mockPrisma.worker.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-7' } });
    // The balance check and the actual delete must never even run once the
    // worker link is found — deletion is refused outright.
    expect(mockPrisma.userAccount.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('still allows deleting a local user with NO linked worker (e.g. a role=receiver account)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'receiver-8', clerkId: 'local_abc' });
    mockPrisma.worker.findUnique.mockResolvedValue(null);
    mockPrisma.userAccount.findUnique.mockResolvedValue(null);
    mockPrisma.user.delete.mockResolvedValue({ id: 'receiver-8' });

    await expect(service.deleteLocal('receiver-8')).resolves.toEqual({ id: 'receiver-8' });
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'receiver-8' } });
  });
});
