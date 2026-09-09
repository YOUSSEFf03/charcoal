import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TraqoKeyResolver } from '../containers/tracking/traqo-key-resolver.service';

/**
 * Admin-facing view of the 3 Traqo accounts, for the owner-only Settings
 * panel. Deliberately never touches or returns a raw key value — only
 * `envKeyName` (a label like "TRAQO_API_KEY_2") and a `keyConfigured`
 * boolean (computed via TraqoKeyResolver, never the value itself). See
 * TraqoAccountAllocationService for the allocation/release logic this
 * surfaces a read view of.
 */
@Injectable()
export class TraqoAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keyResolver: TraqoKeyResolver,
  ) {}

  async listWithUsage() {
    const accounts = await this.prisma.traqoAccount.findMany({ orderBy: { priority: 'asc' } });
    const counts = await this.prisma.containerTrackingAssignment.groupBy({
      by: ['traqoAccountId'],
      where: { traqoAccountId: { in: accounts.map((a) => a.id) }, releasedAt: null },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.traqoAccountId, c._count._all]));

    return accounts.map((a) => ({
      id: a.id,
      name: a.name,
      envKeyName: a.envKeyName,
      keyConfigured: !!this.keyResolver.resolve(a.envKeyName),
      active: a.active,
      status: a.status,
      priority: a.priority,
      maxContainers: a.maxContainers,
      activeContainers: countMap.get(a.id) ?? 0,
      unavailableUntil: a.unavailableUntil,
      lastFailureAt: a.lastFailureAt,
      lastFailureKind: a.lastFailureKind,
    }));
  }

  async setActive(id: string, active: boolean) {
    const account = await this.prisma.traqoAccount.findUnique({ where: { id } });
    if (!account) {
      throw new NotFoundException({ error: 'Traqo account not found', code: 'NOT_FOUND' });
    }
    await this.prisma.traqoAccount.update({ where: { id }, data: { active } });
    return { id, active };
  }
}
