/**
 * Provider-agnostic contract for external container-tracking lookups.
 *
 * ContainerTrackingService depends only on this interface — never on a
 * concrete provider class — so swapping Traqo for a different provider, or
 * adding a second one, never touches ContainersController, the DB schema,
 * or the frontend. See TraqoTrackingProvider for the current implementation.
 */

export interface NormalizedTrackingEvent {
  description: string;
  location: string | null;
  occurredAt: Date | null;
  /** Original provider event object, kept for future normalization fixes. */
  raw: unknown;
}

export interface NormalizedTracking {
  provider: string;
  referenceNumber: string;
  sealine: string;
  sealineName: string | null;
  status: string | null;
  origin: string | null;
  destination: string | null;
  vessel: string | null;
  voyage: string | null;
  currentLocation: string | null;
  eta: Date | null;
  isDelayed: boolean | null;
  shipmentUid: string | null;
  shipmentPublicUrl: string | null;
  /**
   * The real Traqo shipment identifier (Frappe doc name, e.g. "SHP-76810"),
   * distinct from shipmentUid (a public-share-link token — confirmed by a
   * live GET /shipments/{shipmentUid} 404 during the multi-account
   * investigation, 2026-08-26). Nullable: only present if found in the
   * response's nested rows.
   */
  traqoShipmentName: string | null;
  /**
   * Traqo's own shipment-lifecycle fields, live-verified on GET
   * /container/:number (2026-08-26). isActive === false or closedAt !== null
   * is the confirmed signal that Traqo has closed/removed this shipment —
   * never inferred from a 404 or from our own Container.status.
   */
  isActive: boolean | null;
  closedAt: Date | null;
  /** The provider's own "last updated" timestamp for this shipment, if given. */
  providerUpdatedAt: Date | null;
  events: NormalizedTrackingEvent[];
  /** Full provider response, stored verbatim in ContainerTracking.rawResponse. */
  raw: unknown;
}

/** Resolved, ready-to-use credentials for one Traqo account — never logged. */
export interface TraqoCredentials {
  apiKey: string;
  baseUrl?: string;
}

export interface CarrierOption {
  scac: string;
  name: string;
}

/**
 * Discriminates provider failures into the business-friendly buckets
 * ContainerTrackingService maps to user-facing messages. Never carries the
 * provider's raw response body or stack — those stay server-side (logged,
 * never persisted, never returned to the frontend).
 */
export type TrackingErrorKind =
  | 'missing_api_key'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'payment_required'
  | 'rate_limited'
  | 'upstream_error'
  | 'invalid_response'
  | 'network_error'
  // A real Traqo 400 — confirmed live (2026-08-24) to mean the container
  // number or sealine we sent was rejected (e.g. "Invalid container number
  // format...", "Unknown sealine code..."). Distinct from invalid_response
  // (which means TRAQO'S response to us was unparsable): this is a
  // permanent, actionable problem with OUR request, not a transient
  // provider issue — retrying without changing input will always fail the
  // same way, so it must not be told "temporarily unavailable, try again".
  | 'bad_request';

export class TrackingProviderError extends Error {
  constructor(
    public readonly kind: TrackingErrorKind,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'TrackingProviderError';
  }
}

/** DI token — bind the active provider implementation to this in the module. */
export const TRACKING_PROVIDER = Symbol('TRACKING_PROVIDER');

export interface ContainerTrackingProvider {
  /**
   * Look up live tracking data for one container, using the given account's
   * resolved credentials (which account to use is decided per-container by
   * TraqoAccountAllocationService, not fixed per provider instance).
   * Throws TrackingProviderError on any failure.
   */
  trackContainer(
    containerNumber: string,
    sealine: string,
    credentials: TraqoCredentials,
  ): Promise<NormalizedTracking>;

  /** List/search supported carriers, for the container-edit carrier picker. */
  listCarriers(credentials: TraqoCredentials, search?: string): Promise<CarrierOption[]>;
}
