import type { NormalizedTracking, NormalizedTrackingEvent } from './container-tracking.provider';

/**
 * Confirmed against a REAL response from GET /container/:number (live
 * TRAQO_API_KEY test, 2026-08-24 — Traqo's docs render nested tables behind
 * a collapsed viewer that doesn't expose exact shapes, so this was verified
 * against actual bytes on the wire, not inferred from documentation):
 *
 * - The entire payload is wrapped as `{ success, data: {...}, cached }` —
 *   every field lives under `.data`, never at the top level. See unwrap()
 *   below; the ORIGINAL wrapped response is still what gets stored in
 *   ContainerTracking.rawResponse, so nothing is lost.
 * - Traqo's backend is Frappe/ERPNext-based: every row in every nested
 *   table (vessels_table, locations_table, voyage_plan_table, ...) carries
 *   framework metadata including a `name` field holding an internal numeric
 *   doc ID — NOT a display name. `name` must never be treated as a
 *   candidate value key for vessel/location extraction; doing so silently
 *   substitutes a meaningless ID (e.g. "637428") for the real value.
 * - voyage_plan_table rows do not carry a voyage number at all; the real
 *   voyage (e.g. "629W") lives on each events_table entry instead.
 * - Booleans (e.g. is_delayed) are encoded as 0/1 integers, not JS booleans.
 *
 * Extraction otherwise stays tolerant of fields this hasn't been verified
 * against yet (e.g. exact event key names beyond what real events showed)
 * — falls back to null rather than fabricating a value.
 *
 * 2026-08-26 (multi-account investigation, live-verified): the top-level
 * response also carries `is_active` (0/1) and `closed_at` (timestamp|null)
 * — the confirmed shipment-lifecycle signal used to release a Traqo account
 * slot. The real shipment ID (Frappe doc `name`, e.g. "SHP-76810") is NOT a
 * top-level field; it only appears as `parent` on containers_table rows or
 * `shipment_id` on events_table rows, and is distinct from `shipment_uid`
 * (a public-share-link token, confirmed by a live 404 when used as a
 * `/shipments/{id}` lookup).
 */

function unwrapEnvelope(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    const data = (raw as Record<string, unknown>).data;
    if (data && typeof data === 'object') return data;
  }
  return raw;
}

function firstDefined(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = rec[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function asDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return null;
}

function firstArrayItem(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const arr = (obj as Record<string, unknown>)[key];
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined;
}

function normalizeEvent(entry: unknown): NormalizedTrackingEvent {
  const description =
    asString(
      firstDefined(entry, ['description', 'event', 'event_name', 'event_type', 'name', 'status']),
    ) ?? 'Update';
  const location = asString(
    firstDefined(entry, ['location', 'location_name', 'port_name', 'port', 'facility_name']),
  );
  const occurredAt = asDate(
    firstDefined(entry, ['occurred_at', 'timestamp', 'date', 'event_date', 'datetime', 'time']),
  );
  return { description, location, occurredAt, raw: entry };
}

/**
 * Normalize a raw GET /container/:number response into our persisted shape.
 * `fallbackSealine` is the SCAC we requested with — used only if the
 * response itself doesn't echo it back.
 */
export function normalizeTraqoContainerResponse(
  rawResponse: unknown,
  requestedSealine: string,
): NormalizedTracking {
  if (!rawResponse || typeof rawResponse !== 'object') {
    throw new Error('Traqo response was not a JSON object');
  }

  // Traqo wraps every response as { success, data: {...}, cached } — the
  // stored rawResponse keeps the original wrapped shape; field extraction
  // below reads from the unwrapped payload.
  const payload = unwrapEnvelope(rawResponse);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Traqo response had no usable data');
  }

  const referenceNumber = asString(
    firstDefined(payload, ['reference_number', 'container_number', 'number']),
  );
  if (!referenceNumber) {
    throw new Error('Traqo response is missing reference_number');
  }

  const vesselEntry = firstArrayItem(payload, 'vessels_table');
  const locationEntry = firstArrayItem(payload, 'locations_table');

  const eventsSource = (payload as Record<string, unknown>).events_table;
  const events = Array.isArray(eventsSource) ? eventsSource.map(normalizeEvent) : [];
  // The voyage number lives on events_table entries, not voyage_plan_table
  // (which carries phase/date rows with no voyage field at all) — use the
  // most recent event that has one.
  const voyageFromEvents = Array.isArray(eventsSource)
    ? [...eventsSource].reverse().map((e) => firstDefined(e, ['voyage'])).find((v) => v !== undefined)
    : undefined;

  // The real Traqo shipment ID (Frappe doc `name`, e.g. "SHP-76810") is not
  // a top-level field — it only appears as `parent`/`shipment_id` on nested
  // rows (confirmed live, 2026-08-26). containers_table[0].parent is the
  // most direct source; events_table[0].shipment_id is the fallback.
  const containerEntry = firstArrayItem(payload, 'containers_table');
  const firstEvent = Array.isArray(eventsSource) ? eventsSource[0] : undefined;
  const traqoShipmentName = asString(
    firstDefined(containerEntry, ['parent']) ?? firstDefined(firstEvent, ['shipment_id']),
  );

  return {
    provider: 'traqo',
    referenceNumber,
    sealine: asString(firstDefined(payload, ['sealine'])) ?? requestedSealine,
    sealineName: asString(firstDefined(payload, ['sealine_name', 'carrier_name'])),
    status: asString(firstDefined(payload, ['status'])),
    origin: asString(firstDefined(payload, ['origin'])),
    destination: asString(firstDefined(payload, ['destination'])),
    // 'name' is deliberately excluded — see file header: it's a Frappe
    // internal doc ID present on every nested-table row, not a display value.
    vessel: asString(firstDefined(vesselEntry, ['vessel', 'vessel_name'])),
    voyage: asString(voyageFromEvents),
    currentLocation: asString(
      firstDefined(payload, ['current_location']) ??
        firstDefined(locationEntry, ['location', 'location_name', 'port_name']),
    ),
    eta: asDate(firstDefined(payload, ['eta'])),
    isDelayed: asBool(firstDefined(payload, ['is_delayed'])),
    shipmentUid: asString(firstDefined(payload, ['shipment_uid'])),
    shipmentPublicUrl: asString(firstDefined(payload, ['shipment_public_url'])),
    traqoShipmentName,
    // Confirmed live (2026-08-26): is_active is a Frappe 0/1 int, same
    // encoding as is_delayed. closed_at is a nullable timestamp.
    isActive: asBool(firstDefined(payload, ['is_active'])),
    closedAt: asDate(firstDefined(payload, ['closed_at'])),
    providerUpdatedAt: asDate(firstDefined(payload, ['last_updated_at', 'updated_at'])),
    events,
    raw: rawResponse,
  };
}
