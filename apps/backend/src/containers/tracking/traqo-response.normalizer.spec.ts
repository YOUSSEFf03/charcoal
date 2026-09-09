import { describe, it, expect } from '@jest/globals';
import { normalizeTraqoContainerResponse } from './traqo-response.normalizer';

describe('normalizeTraqoContainerResponse', () => {
  // Payload shape confirmed against a REAL response from a live
  // TRAQO_API_KEY call to GET /container/MRSU6859427?sealine=MAEU
  // (2026-08-24) — including the Frappe/ERPNext-style `name` metadata field
  // present on every nested-table row, which must never be mistaken for the
  // real vessel/location value.
  const payload = {
    reference_number: 'MRSU6859427',
    origin: 'Shanghai, China',
    destination: 'Antwerp, Belgium',
    sealine: 'MAEU',
    sealine_name: 'Maersk',
    status: 'IN_TRANSIT',
    eta: '2026-09-21 06:00:00',
    last_updated_at: '2026-08-24 07:49:44.299522',
    is_delayed: 1,
    shipment_uid: 'fa66b5e1cac9819660bb34529fe73ca4',
    shipment_public_url: 'https://containers.traqo.io/ocean/share-shipment?shipment_uid=fa66b5e1cac9819660bb34529fe73ca4',
    // Confirmed live (2026-08-26, multi-account investigation): these two
    // are the real shipment-lifecycle fields, plus the real shipment ID
    // ("name") lives on containers_table rows as `parent`, not top-level.
    is_active: 1,
    closed_at: null,
    voyage_plan_table: [
      { name: 1520873, phase: 'prepol', location_id: 1, date: '2026-07-27 13:35:00' },
      { name: 1520875, phase: 'pod', location_id: 3, date: '2026-09-21 06:00:00' },
    ],
    containers_table: [
      { name: 108007, container: 'CNT-77415', container_number: 'MRSU6859427', parent: 'SHP-76810' },
    ],
    locations_table: [
      { name: 899354, location: 'Shanghai', country: 'China' },
      { name: 899356, location: 'Antwerp', country: 'Belgium' },
    ],
    vessels_table: [
      { name: 637428, vessel: 'MAERSK ELBA', imo: '9458078', is_current: 1 },
      { name: 637429, vessel: 'KASSIAKOS', imo: '9386471', is_current: 0 },
    ],
    events_table: [
      { name: 4272738, description: 'Container empty to shipper', location: 'Shanghai', timestamp: '2026-07-27 13:35:00' },
      { name: 4272743, description: 'Vessel departure from T/S', location: 'Tangier', timestamp: '2026-09-13 09:00:00', voyage: '637N' },
      { name: 4272744, description: 'Vessel arrival at final POD', location: 'Antwerp', timestamp: '2026-09-21 06:00:00', voyage: '637N' },
    ],
  };
  // Traqo wraps every response this way — { success, data, cached }.
  const fullResponse = { success: true, data: payload, cached: false };

  it('unwraps the { success, data, cached } envelope Traqo actually returns', () => {
    const result = normalizeTraqoContainerResponse(fullResponse, 'MAEU');
    expect(result.referenceNumber).toBe('MRSU6859427');
    expect(result.status).toBe('IN_TRANSIT');
  });

  it('also accepts an already-unwrapped payload (defensive)', () => {
    const result = normalizeTraqoContainerResponse(payload, 'MAEU');
    expect(result.referenceNumber).toBe('MRSU6859427');
  });

  it('preserves the ORIGINAL wrapped response verbatim in raw, not the unwrapped payload', () => {
    const result = normalizeTraqoContainerResponse(fullResponse, 'MAEU');
    expect(result.raw).toBe(fullResponse);
  });

  it('maps all top-level fields', () => {
    const result = normalizeTraqoContainerResponse(fullResponse, 'MAEU');
    expect(result.origin).toBe('Shanghai, China');
    expect(result.destination).toBe('Antwerp, Belgium');
    expect(result.sealine).toBe('MAEU');
    expect(result.sealineName).toBe('Maersk');
    expect(result.shipmentUid).toBe('fa66b5e1cac9819660bb34529fe73ca4');
    expect(result.shipmentPublicUrl).toBe(
      'https://containers.traqo.io/ocean/share-shipment?shipment_uid=fa66b5e1cac9819660bb34529fe73ca4',
    );
  });

  describe('Traqo lifecycle signal (is_active / closed_at) — the confirmed release detector', () => {
    it('extracts isActive===true and closedAt===null for a still-tracked shipment', () => {
      const result = normalizeTraqoContainerResponse(fullResponse, 'MAEU');
      expect(result.isActive).toBe(true);
      expect(result.closedAt).toBeNull();
    });

    it('decodes is_active from the 0/1 integer encoding (same as is_delayed), not just JS booleans', () => {
      const closed = { ...payload, is_active: 0 };
      const result = normalizeTraqoContainerResponse({ success: true, data: closed }, 'MAEU');
      expect(result.isActive).toBe(false);
    });

    it('extracts a non-null closed_at as a real Date', () => {
      const closed = { ...payload, is_active: 0, closed_at: '2026-09-22 10:00:00' };
      const result = normalizeTraqoContainerResponse({ success: true, data: closed }, 'MAEU');
      expect(result.closedAt).toBeInstanceOf(Date);
      expect(result.closedAt?.toISOString()).toContain('2026-09-22');
    });
  });

  describe('traqoShipmentName (the real Traqo shipment ID, distinct from shipmentUid)', () => {
    it('extracts it from containers_table[0].parent', () => {
      const result = normalizeTraqoContainerResponse(fullResponse, 'MAEU');
      expect(result.traqoShipmentName).toBe('SHP-76810');
      // Never confused with shipmentUid (a public-share-link token).
      expect(result.traqoShipmentName).not.toBe(result.shipmentUid);
    });

    it('falls back to events_table[0].shipment_id when containers_table is absent', () => {
      const { containers_table, ...withoutContainersTable } = payload as any;
      const withEventShipmentId = {
        ...withoutContainersTable,
        events_table: [{ ...payload.events_table[0], shipment_id: 'SHP-99999' }],
      };
      const result = normalizeTraqoContainerResponse({ success: true, data: withEventShipmentId }, 'MAEU');
      expect(result.traqoShipmentName).toBe('SHP-99999');
    });

    it('is null (never fabricated) when neither source is present', () => {
      const result = normalizeTraqoContainerResponse({ reference_number: 'ABCU1234567' }, 'MAEU');
      expect(result.traqoShipmentName).toBeNull();
    });
  });

  it('extracts the real vessel/location values, never the Frappe internal `name` doc ID', () => {
    const result = normalizeTraqoContainerResponse(fullResponse, 'MAEU');
    expect(result.vessel).toBe('MAERSK ELBA');
    expect(result.vessel).not.toBe('637428');
    expect(result.currentLocation).toBe('Shanghai');
    expect(result.currentLocation).not.toBe('899354');
  });

  it('extracts voyage from events_table (voyage_plan_table carries no voyage field)', () => {
    const result = normalizeTraqoContainerResponse(fullResponse, 'MAEU');
    expect(result.voyage).toBe('637N');
  });

  it('decodes is_delayed from Traqo\'s 0/1 integer encoding, not just JS booleans', () => {
    expect(normalizeTraqoContainerResponse(fullResponse, 'MAEU').isDelayed).toBe(true);
    const notDelayed = { ...payload, is_delayed: 0 };
    expect(normalizeTraqoContainerResponse({ success: true, data: notDelayed }, 'MAEU').isDelayed).toBe(false);
  });

  it('normalizes events_table entries tolerating different key names per event', () => {
    const result = normalizeTraqoContainerResponse(fullResponse, 'MAEU');
    expect(result.events).toHaveLength(3);
    expect(result.events[0]).toMatchObject({ description: 'Container empty to shipper', location: 'Shanghai' });
    expect(result.events[0].occurredAt).not.toBeNull();
    expect(result.events[2]).toMatchObject({ description: 'Vessel arrival at final POD', location: 'Antwerp' });
  });

  it('falls back to the requested sealine when the response omits it', () => {
    const { sealine, ...withoutSealine } = payload;
    const result = normalizeTraqoContainerResponse({ success: true, data: withoutSealine }, 'MSCU');
    expect(result.sealine).toBe('MSCU');
  });

  it('returns nulls (never fabricated values) for fields absent from the response', () => {
    const result = normalizeTraqoContainerResponse({ reference_number: 'ABCU1234567' }, 'MAEU');
    expect(result.vessel).toBeNull();
    expect(result.voyage).toBeNull();
    expect(result.currentLocation).toBeNull();
    expect(result.eta).toBeNull();
    expect(result.status).toBeNull();
    expect(result.isDelayed).toBeNull();
    expect(result.isActive).toBeNull();
    expect(result.closedAt).toBeNull();
    expect(result.traqoShipmentName).toBeNull();
    expect(result.events).toEqual([]);
  });

  it('throws when the response has no reference_number/container_number/number', () => {
    expect(() => normalizeTraqoContainerResponse({ status: 'IN_TRANSIT' }, 'MAEU')).toThrow(
      /reference_number/,
    );
  });

  it('throws when the response is not a JSON object', () => {
    expect(() => normalizeTraqoContainerResponse(null, 'MAEU')).toThrow();
    expect(() => normalizeTraqoContainerResponse('oops', 'MAEU')).toThrow();
  });

  it('ignores an invalid eta string rather than throwing', () => {
    const result = normalizeTraqoContainerResponse(
      { reference_number: 'ABCU1234567', eta: 'not-a-date' },
      'MAEU',
    );
    expect(result.eta).toBeNull();
  });
});
