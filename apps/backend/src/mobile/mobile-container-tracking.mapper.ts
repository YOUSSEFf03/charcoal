import { ContainerStatus } from '@prisma/client';

/**
 * Explicit mobile response shapes — deliberately NOT the Prisma Container/
 * ContainerTracking/TrackingEvent types, and never returned by spreading a
 * Prisma result directly (see the map* functions below). This is the same
 * "explicit interface + pure mapper function" shape
 * traqo-response.normalizer.ts already uses for NormalizedTracking — chosen
 * here for the same reason: a named field list that a future schema change
 * cannot silently widen, and that is trivially reviewable for what it does
 * NOT contain (rawResponse, bankDetails, contactPersons, any Traqo/account
 * internals, any accounting field).
 */

export interface MobileSupplierSummary {
  name: string;
  country: string;
}

export interface MobileTrackingSummary {
  status: string | null;
  origin: string | null;
  destination: string | null;
  vessel: string | null;
  voyage: string | null;
  currentLocation: string | null;
  eta: string | null;
  isDelayed: boolean | null;
  /** Traqo's own shipment-lifecycle signal — informational only, mirrors the distinction ContainerDetail.tsx already renders on the web. Never used to derive `status` below. */
  isActive: boolean | null;
  providerUpdatedAt: string | null;
  lastFetchedAt: string;
}

export interface MobileContainerListItem {
  id: string;
  containerNumber: string;
  /** The business lifecycle status (port/transit/arrived) — never derived from `tracking.isActive`. */
  status: ContainerStatus;
  arrivalDate: string | null;
  notes: string | null;
  supplier: MobileSupplierSummary;
  sealineName: string | null;
  /** Null exactly when this container has never been successfully refreshed — see "tracking unavailable" handling in the service. */
  tracking: MobileTrackingSummary | null;
}

export type MobileContainerDetail = MobileContainerListItem;

export interface MobileTrackingEvent {
  description: string;
  location: string | null;
  occurredAt: string | null;
}

/** The exact shape a Prisma query must produce for mapContainer() below — enforced at the call site via `select`, never `include`. */
export interface ContainerForMobile {
  id: string;
  number: string;
  status: ContainerStatus;
  arrivalDate: Date | null;
  notes: string | null;
  sealineName: string | null;
  supplier: { name: string; country: string };
  tracking: {
    status: string | null;
    origin: string | null;
    destination: string | null;
    vessel: string | null;
    voyage: string | null;
    currentLocation: string | null;
    eta: Date | null;
    isDelayed: boolean | null;
    isActive: boolean | null;
    providerUpdatedAt: Date | null;
    lastFetchedAt: Date;
  } | null;
}

export function mapContainer(container: ContainerForMobile): MobileContainerListItem {
  return {
    id: container.id,
    containerNumber: container.number,
    status: container.status,
    arrivalDate: container.arrivalDate?.toISOString() ?? null,
    notes: container.notes,
    supplier: { name: container.supplier.name, country: container.supplier.country },
    sealineName: container.sealineName,
    tracking: container.tracking
      ? {
          status: container.tracking.status,
          origin: container.tracking.origin,
          destination: container.tracking.destination,
          vessel: container.tracking.vessel,
          voyage: container.tracking.voyage,
          currentLocation: container.tracking.currentLocation,
          eta: container.tracking.eta?.toISOString() ?? null,
          isDelayed: container.tracking.isDelayed,
          isActive: container.tracking.isActive,
          providerUpdatedAt: container.tracking.providerUpdatedAt?.toISOString() ?? null,
          lastFetchedAt: container.tracking.lastFetchedAt.toISOString(),
        }
      : null,
  };
}

export interface TrackingEventForMobile {
  description: string;
  location: string | null;
  occurredAt: Date | null;
}

export function mapTrackingEvent(event: TrackingEventForMobile): MobileTrackingEvent {
  return {
    description: event.description,
    location: event.location,
    occurredAt: event.occurredAt?.toISOString() ?? null,
  };
}
