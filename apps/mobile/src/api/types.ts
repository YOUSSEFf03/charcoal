/**
 * Response shapes for the Phase D mobile API
 * (apps/backend/src/mobile/mobile-container-tracking.mapper.ts).
 *
 * Deliberately hand-typed to match that file's exported interfaces field for
 * field, NOT imported from the backend package — this app has no dependency
 * on @charcoal/backend (a separate deployable, a separate runtime), so these
 * are a client-side contract snapshot. If the backend's mapper ever changes
 * shape, this file must be updated to match — it is intentionally the one
 * place in this app that encodes "what the API actually returns."
 */

export type ContainerStatus = 'port' | 'transit' | 'arrived';

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
  /** ISO 8601 timestamp string, or null if Traqo has not resolved an ETA yet. */
  eta: string | null;
  isDelayed: boolean | null;
  /** Traqo's own shipment-lifecycle signal — informational only. Never used to derive `status` on the container. */
  isActive: boolean | null;
  providerUpdatedAt: string | null;
  /** ISO 8601 timestamp string — always present once `tracking` itself is non-null. */
  lastFetchedAt: string;
}

export interface MobileContainer {
  id: string;
  containerNumber: string;
  /** The business lifecycle status — port | transit | arrived. Never derived from `tracking.isActive`. */
  status: ContainerStatus;
  /** ISO 8601 date string, or null if not yet arrived. */
  arrivalDate: string | null;
  notes: string | null;
  supplier: MobileSupplierSummary;
  sealineName: string | null;
  /** Null exactly when this container has never been successfully refreshed by the backend's tracking scheduler — a real, common state, not an error. */
  tracking: MobileTrackingSummary | null;
}

export interface MobileTrackingEvent {
  description: string;
  location: string | null;
  /** ISO 8601 timestamp string, or null. */
  occurredAt: string | null;
}

export interface MobileContainerListResponse {
  data: MobileContainer[];
  total: number;
  page: number;
  limit: number;
}

/** The backend's uniform error envelope (HttpExceptionFilter) — `{ error, code }`, occasionally `details`. */
export interface ApiErrorShape {
  status?: number;
  error: string;
  code: string;
  details?: unknown;
}

export type DevicePlatform = 'ios' | 'android';

export interface RegisterDeviceRequest {
  token: string;
  platform: DevicePlatform;
  appVersion?: string;
}

export interface RegisterDeviceResponse {
  id: string;
  platform: DevicePlatform;
  active: boolean;
}

/**
 * Phase C's push notification `data` payload shape
 * (apps/backend/src/notifications/container-notification.service.ts).
 */
export interface ContainerNotificationData {
  type: 'eta_changed' | 'arrived';
  containerId: string;
}
