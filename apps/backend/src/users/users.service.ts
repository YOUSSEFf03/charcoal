import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { clerkClient } from '@clerk/clerk-sdk-node';
import { Role } from '@prisma/client';
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
   */
  async deleteLocal(id: string) {
    const user = await this.findOne(id);
    if (!user.clerkId.startsWith('local_')) {
      throw new BadRequestException({
        error: 'Cannot delete a Clerk-linked user from here. Remove them in Clerk.',
        code: 'NOT_LOCAL_USER',
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
