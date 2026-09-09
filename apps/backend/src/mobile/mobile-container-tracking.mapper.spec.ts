import { describe, it, expect } from '@jest/globals';
import { mapContainer, mapTrackingEvent, ContainerForMobile, TrackingEventForMobile } from './mobile-container-tracking.mapper';

function baseContainer(overrides: Partial<ContainerForMobile> = {}): ContainerForMobile {
  return {
    id: 'container-uuid-1',
    number: 'MSCU1234567',
    status: 'transit',
    arrivalDate: null,
    notes: '10T Oak + 10T Ayin — Order #245',
    sealineName: 'Maersk',
    supplier: { name: 'ABC Charcoal Trading', country: 'CN' },
    tracking: null,
    ...overrides,
  };
}

describe('mapContainer', () => {
  it('maps a container with no tracking yet to tracking: null (not an error, not fabricated data)', () => {
    const result = mapContainer(baseContainer());
    expect(result.tracking).toBeNull();
    expect(result.id).toBe('container-uuid-1');
    expect(result.containerNumber).toBe('MSCU1234567');
    expect(result.supplier).toEqual({ name: 'ABC Charcoal Trading', country: 'CN' });
    expect(result.notes).toBe('10T Oak + 10T Ayin — Order #245');
  });

  it('maps every tracking field and serializes Dates to ISO strings', () => {
    const eta = new Date('2026-09-23T00:00:00.000Z');
    const providerUpdatedAt = new Date('2026-09-20T12:00:00.000Z');
    const lastFetchedAt = new Date('2026-09-20T13:00:00.000Z');

    const result = mapContainer(
      baseContainer({
        tracking: {
          status: 'IN_TRANSIT',
          origin: 'Shanghai, CN',
          destination: 'Beirut, LB',
          vessel: 'MAERSK ESSEX',
          voyage: '412W',
          currentLocation: 'Port Said, EG',
          eta,
          isDelayed: true,
          isActive: true,
          providerUpdatedAt,
          lastFetchedAt,
        },
      }),
    );

    expect(result.tracking).toEqual({
      status: 'IN_TRANSIT',
      origin: 'Shanghai, CN',
      destination: 'Beirut, LB',
      vessel: 'MAERSK ESSEX',
      voyage: '412W',
      currentLocation: 'Port Said, EG',
      eta: '2026-09-23T00:00:00.000Z',
      isDelayed: true,
      isActive: true,
      providerUpdatedAt: '2026-09-20T12:00:00.000Z',
      lastFetchedAt: '2026-09-20T13:00:00.000Z',
    });
  });

  it('serializes a null eta/providerUpdatedAt as null, not "null" or an error', () => {
    const result = mapContainer(
      baseContainer({
        tracking: {
          status: null, origin: null, destination: null, vessel: null, voyage: null,
          currentLocation: null, eta: null, isDelayed: null, isActive: null,
          providerUpdatedAt: null, lastFetchedAt: new Date('2026-09-20T13:00:00.000Z'),
        },
      }),
    );
    expect(result.tracking?.eta).toBeNull();
    expect(result.tracking?.providerUpdatedAt).toBeNull();
  });

  it('serializes arrivalDate to an ISO string when present, null otherwise', () => {
    const arrived = mapContainer(baseContainer({ status: 'arrived', arrivalDate: new Date('2026-09-25T00:00:00.000Z') }));
    expect(arrived.arrivalDate).toBe('2026-09-25T00:00:00.000Z');

    const notArrived = mapContainer(baseContainer({ arrivalDate: null }));
    expect(notArrived.arrivalDate).toBeNull();
  });

  it('the returned object contains ONLY the documented fields — no accidental extra keys can leak through', () => {
    const result = mapContainer(baseContainer());
    expect(Object.keys(result).sort()).toEqual(
      ['id', 'containerNumber', 'status', 'arrivalDate', 'notes', 'supplier', 'sealineName', 'tracking'].sort(),
    );
    expect(Object.keys(result.supplier).sort()).toEqual(['name', 'country'].sort());
  });

  it('never contains rawResponse, bankDetails, contactPersons, or any Traqo/account field — even if a caller mistakenly passed them in', () => {
    const withExtraStuff = {
      ...baseContainer(),
      // Simulates what would happen if a future refactor accidentally used
      // `include` instead of `select` upstream and passed the wider object
      // straight through — mapContainer() must still only read named fields.
      rawResponse: { secret: 'traqo-internal-blob' },
      supplier: { name: 'ABC', country: 'CN', bankDetails: { iban: 'LB00...' }, contactPersons: [{ name: 'X' }] },
    } as unknown as ContainerForMobile;

    const result = mapContainer(withExtraStuff);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('rawResponse');
    expect(serialized).not.toContain('bankDetails');
    expect(serialized).not.toContain('contactPersons');
    expect(serialized).not.toContain('traqo-internal-blob');
    expect(serialized).not.toContain('LB00');
  });
});

describe('mapTrackingEvent', () => {
  function baseEvent(overrides: Partial<TrackingEventForMobile> = {}): TrackingEventForMobile {
    return { description: 'Gate out', location: 'Shanghai, CN', occurredAt: new Date('2026-09-01T00:00:00.000Z'), ...overrides };
  }

  it('maps description/location/occurredAt only, ISO-formatting the date', () => {
    const result = mapTrackingEvent(baseEvent());
    expect(result).toEqual({ description: 'Gate out', location: 'Shanghai, CN', occurredAt: '2026-09-01T00:00:00.000Z' });
    expect(Object.keys(result).sort()).toEqual(['description', 'location', 'occurredAt'].sort());
  });

  it('never exposes `raw` even if present on the input object', () => {
    const eventWithRaw = { ...baseEvent(), raw: { internal: 'provider-blob' } } as unknown as TrackingEventForMobile;
    const result = mapTrackingEvent(eventWithRaw);
    expect(JSON.stringify(result)).not.toContain('provider-blob');
    expect(result).not.toHaveProperty('raw');
  });

  it('handles a null occurredAt/location safely', () => {
    const result = mapTrackingEvent(baseEvent({ location: null, occurredAt: null }));
    expect(result.location).toBeNull();
    expect(result.occurredAt).toBeNull();
  });
});
