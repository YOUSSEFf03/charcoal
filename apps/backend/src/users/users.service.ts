import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { clerkClient } from '@clerk/clerk-sdk-node';
import { Role } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(page: number, limit: number, role?: Role) {
    const skip = (page - 1) * limit;
    const where = role ? { role } : {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    return user;
  }

  /**
   * Cash Management System (Phase 1, PR 6) — validates that a user id is a real,
   * currently-eligible cash holder before a ledger write is allowed to reference
   * it. Temporary home: this check moves to CashHolderService once the dedicated
   * CashHolder entity lands in Phase 2 (see CASH_MANAGEMENT_FINAL_BLUEPRINT.md §6).
   *
   * "Eligible" here means: exists, and not soft-deleted. No Role restriction is
   * applied — any user can be a ledger holder, matching today's behavior where
   * owner/accountant/sales_rep/worker can all be picked as a receiver/collector.
   */
  async validateCashCapable(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new NotFoundException({ error: 'Receiver not found', code: 'NOT_FOUND' });
    }
  }

  /**
   * Create a local (non-Clerk) user — used for receivers and other internal-only accounts.
   * Generates a synthetic clerkId so the unique constraint is satisfied without a real Clerk account.
   */
  async createLocal(name: string, role: Role, phone?: string) {
    const syntheticClerkId = `local_${crypto.randomUUID()}`;
    const syntheticEmail = `${syntheticClerkId}@local.internal`;
    return this.prisma.user.create({
      data: {
        clerkId: syntheticClerkId,
        email: syntheticEmail,
        name: name.trim(),
        role,
        phone: phone?.trim() ?? null,
      },
    });
  }

  /**
   * Delete a local user (clerkId starts with 'local_').
   * Refuses to delete Clerk-linked users to prevent auth breakage.
   *
   * UserAccount and AccountEntry cascade-delete with the User row
   * (schema.prisma: onDelete: Cascade on both). A receiver with an
   * outstanding balance must never be deleted through this path — doing so
   * would silently and irrecoverably destroy their cash balance and their
   * entire AccountEntry audit trail, with no way to recover either. Same
   * balance-read pattern (userAccount.findUnique by userId, compared via
   * Decimal) already used by BalanceQueryService.getReceiverBalance() and
   * LedgerWriteService's upsert calls.
   */
  async deleteLocal(id: string) {
    const user = await this.findOne(id);
    if (!user.clerkId.startsWith('local_')) {
      throw new BadRequestException({
        error: 'Cannot delete a Clerk-linked user from here. Remove them in Clerk.',
        code: 'NOT_LOCAL_USER',
      });
    }

    const account = await this.prisma.userAccount.findUnique({ where: { userId: id } });
    if (account && !new Decimal(account.balance.toString()).isZero()) {
      throw new BadRequestException({
        error: `Cannot delete this receiver — they have an outstanding balance of $${account.balance.toString()}. Settle or transfer the balance before deleting.`,
        code: 'OUTSTANDING_BALANCE',
      });
    }

    return this.prisma.user.delete({ where: { id } });
  }

  async updateRole(id: string, role: Role) {
    const user = await this.findOne(id);

    if (process.env.NODE_ENV === 'production' && !user.clerkId.startsWith('local_')) {
      try {
        await clerkClient.users.updateUser(user.clerkId, { publicMetadata: { role } });
      } catch (err) {
        this.logger.error(`Failed to update Clerk metadata: ${err}`);
        throw new InternalServerErrorException({ error: 'Failed to update role in Clerk', code: 'INTERNAL_ERROR' });
      }
    }

    return this.prisma.user.update({ where: { id }, data: { role } });
  }

  async updateName(id: string, name: string, phone?: string | null) {
    const user = await this.findOne(id);
    return this.prisma.user.update({
      where: { id },
      data: {
        name: name.trim(),
        ...(phone !== undefined ? { phone: phone?.trim() ?? null } : {}),
      },
    });
  }
}
