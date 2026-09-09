import { Injectable, NotFoundException } from '@nestjs/common';
import { ContainerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ContainerForMobile,
  MobileContainerDetail,
  MobileContainerListItem,
  MobileTrackingEvent,
  mapContainer,
  mapTrackingEvent,
} from './mobile-container-tracking.mapper';

/**
 * The single `select` shape used by both the list and detail queries below —
 * defined once so the two endpoints can never drift apart on what counts as
 * "safe." Deliberately a `select`, never an `include`: `include` would pull
 * in every scalar Prisma later adds to Container/Supplier/ContainerTracking
 * (e.g. a future accounting field) automatically; `select` only ever
 * returns exactly these named fields, so a schema change can't silently
 * widen what mobile receives. This mirrors ContainersService.findAll()'s
 * own existing "tracking: { select: {...} }" pattern (excludes rawResponse/
 * events for the exact same list-safety reason), extended here to also
 * scope the Supplier relation (the web's findOne() includes the FULL
 * Supplier row — bankDetails, contactPersons and all — which is exactly why
 * this module exists instead of reusing that endpoint).
 */
const MOBILE_CONTAINER_SELECT = {
  id: true,
  number: true,
  status: true,
  arrivalDate: true,
  notes: true,
  sealineName: true,
  supplier: { select: { name: true, country: true } },
  tracking: {
    select: {
      status: true,
      origin: true,
      destination: true,
      vessel: true,
      voyage: true,
      currentLocation: true,
      eta: true,
      isDelayed: true,
      isActive: true,
      providerUpdatedAt: true,
      lastFetchedAt: true,
    },
  },
} satisfies Prisma.ContainerSelect;

export interface MobileContainerListResult {
  data: MobileContainerListItem[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class MobileContainerTrackingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param status Optional exact-match filter on the business status enum
   *   (port/transit/arrived) — never on any Traqo-derived tracking field.
   * @param search Optional case-insensitive substring match on the
   *   container number, mirroring ContainersService.findAll()'s existing
   *   `search` behavior exactly.
   */
  async findAll(page: number, limit: number, status?: ContainerStatus, search?: string): Promise<MobileContainerListResult> {
    const where: Prisma.ContainerWhereInput = {
      ...(status ? { status } : {}),
      ...(search ? { number: { contains: search, mode: 'insensitive' } } : {}),
    };

    // Same default ordering ContainersService.findAll() already uses for
    // the equivalent web list — reusing the existing convention rather than
    // inventing a mobile-specific one (e.g. "by tracking freshness" would
    // also need to define NULLS ordering for never-refreshed containers,
    // which createdAt desc avoids entirely).
    const [containers, total] = await this.prisma.$transaction([
      this.prisma.container.findMany({
        where,
        select: MOBILE_CONTAINER_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.container.count({ where }),
    ]);

    return {
      data: (containers as ContainerForMobile[]).map(mapContainer),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string): Promise<MobileContainerDetail> {
    const container = await this.prisma.container.findUnique({
      where: { id },
      select: MOBILE_CONTAINER_SELECT,
    });

    if (!container) {
      throw new NotFoundException({ error: 'Container not found', code: 'NOT_FOUND' });
    }

    // No special-casing needed for "tracking not yet available" — mapContainer()
    // already renders a null `tracking` relation as `tracking: null` in the
    // response, a safe, explicit "not yet available" shape rather than an
    // error. See mapContainer()'s doc comment.
    return mapContainer(container as ContainerForMobile);
  }

  async findEvents(id: string): Promise<MobileTrackingEvent[]> {
    const container = await this.prisma.container.findUnique({
      where: { id },
      select: { tracking: { select: { id: true } } },
    });

    if (!container) {
      throw new NotFoundException({ error: 'Container not found', code: 'NOT_FOUND' });
    }

    // No tracking row yet (never refreshed) — a real, common state, not an
    // error. Same "no data invented" principle as findOne(): an empty
    // timeline, not a 404 or a fabricated event.
    if (!container.tracking) {
      return [];
    }

    // Oldest-first — reuses TRACKING_EVENTS_ORDER's exact convention from
    // ContainerTrackingService.getTracking() (the web's own equivalent
    // fetch), rather than inventing a different mobile ordering. Reminder
    // (see TrackingEvent's own schema comment): these rows are replaced in
    // full on every successful refresh, never appended — this is "the
    // current known timeline as of the last refresh," not a durable
    // historical log. The mobile UI must not present it as one.
    const events = await this.prisma.trackingEvent.findMany({
      where: { trackingId: container.tracking.id },
      select: { description: true, location: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    });

    return events.map(mapTrackingEvent);
  }
}
