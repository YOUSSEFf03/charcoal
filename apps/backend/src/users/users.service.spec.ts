import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
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
