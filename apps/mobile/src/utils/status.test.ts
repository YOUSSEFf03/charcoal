import { routeLine, STATUS_LABEL } from './status';

describe('STATUS_LABEL', () => {
  it('matches the web app wording exactly', () => {
    expect(STATUS_LABEL.port).toBe('At port');
    expect(STATUS_LABEL.transit).toBe('In transit');
    expect(STATUS_LABEL.arrived).toBe('Arrived');
  });
});

describe('routeLine', () => {
  it('returns null when tracking is missing', () => {
    expect(routeLine(null)).toBeNull();
    expect(routeLine(undefined)).toBeNull();
  });

  it('joins origin and destination', () => {
    expect(routeLine({ origin: 'Shanghai', destination: 'Beirut' })).toBe('Shanghai → Beirut');
  });

  it('falls back to whichever half is known', () => {
    expect(routeLine({ origin: 'Shanghai', destination: null })).toBe('Shanghai');
    expect(routeLine({ origin: null, destination: 'Beirut' })).toBe('Beirut');
    expect(routeLine({ origin: null, destination: null })).toBeNull();
  });
});
