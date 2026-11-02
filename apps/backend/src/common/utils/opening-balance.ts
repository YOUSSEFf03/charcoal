import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { SetOpeningBalanceDto } from '../dto/set-opening-balance.dto';

/**
 * Shared write-side rules for ClientOpeningBalance / SupplierOpeningBalance —
 * the two go-live carry-forward records have identical validation, only the
 * owning party differs.
 */

/**
 * Opening balances are owner-only (same gate as PUT /:id/opening-balance).
 * Used by the create endpoints, which other roles may call without one.
 */
export function assertCanSetOpeningBalance(role: string | undefined): void {
  if (role !== 'owner') {
    throw new ForbiddenException({
      error: 'Only the owner can set an opening balance',
      code: 'FORBIDDEN',
    });
  }
}

/** Validates a SetOpeningBalanceDto and returns the Prisma write payload (minus the party FK). */
export async function buildOpeningBalanceData(
  prisma: PrismaService,
  dto: SetOpeningBalanceDto,
  clerkUserId: string,
) {
  const amount = new Decimal(dto.amount);
  // A zero opening balance carries nothing forward — clear it instead (DELETE).
  if (amount.isZero()) {
    throw new BadRequestException({
      message: 'Opening balance cannot be zero — remove it instead',
      error: 'Opening balance cannot be zero — remove it instead',
      code: 'CONSTRAINT_VIOLATION',
    });
  }
  const user = await prisma.user.findUnique({ where: { clerkId: clerkUserId } });
  if (!user) throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });

  return {
    amount: amount.toFixed(2),
    date: new Date(dto.date),
    notes: dto.notes?.trim() ? dto.notes.trim() : null,
    setById: user.id,
  };
}

/** API shape for an opening-balance row (Decimal → fixed-2 string, setBy name only). */
export function serializeOpeningBalance(
  row: { amount: { toString(): string }; date: Date; notes: string | null; updatedAt: Date; setBy?: { name: string } | null } | null,
) {
  if (!row) return null;
  return {
    amount: new Decimal(row.amount.toString()).toFixed(2),
    date: row.date,
    notes: row.notes,
    setByName: row.setBy?.name ?? null,
    updatedAt: row.updatedAt,
  };
}
