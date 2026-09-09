import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { TraqoTrackingProvider } from './traqo-tracking.provider';
import { TrackingProviderError, TraqoCredentials } from './container-tracking.provider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

const CREDS: TraqoCredentials = { apiKey: 'test-key-123' };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('TraqoTrackingProvider', () => {
  const originalFetch = global.fetch;
  let mockFetch: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeEach(() => {
    mockFetch = fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('authentication', () => {
    it('sends Authorization: Bearer <key> and the sealine query param', async () => {
      mockFetch.mockResolvedValue(jsonResponse(200, { reference_number: 'MRSU6859427' }));
      const provider = new TraqoTrackingProvider();

      await provider.trackContainer('MRSU6859427', 'MAEU', CREDS);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://traqocontainer.com/api/v1/container/MRSU6859427?sealine=MAEU',
      );
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer test-key-123',
      );
    });

    it('uses the account-specific baseUrl override when given', async () => {
      mockFetch.mockResolvedValue(jsonResponse(200, { reference_number: 'MRSU6859427' }));
      const provider = new TraqoTrackingProvider();

      await provider.trackContainer('MRSU6859427', 'MAEU', {
        apiKey: 'k',
        baseUrl: 'https://sandbox.example.com/api/v1/',
      });

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://sandbox.example.com/api/v1/container/MRSU6859427?sealine=MAEU');
    });

    it('throws missing_api_key and never calls fetch when apiKey is empty', async () => {
      const provider = new TraqoTrackingProvider();

      await expect(
        provider.trackContainer('MRSU6859427', 'MAEU', { apiKey: '' }),
      ).rejects.toMatchObject({ kind: 'missing_api_key' });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('successful lookup', () => {
    it('normalizes a 200 response', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(200, { reference_number: 'MRSU6859427', status: 'IN_TRANSIT' }),
      );
      const provider = new TraqoTrackingProvider();

      const result = await provider.trackContainer('MRSU6859427', 'MAEU', CREDS);

      expect(result.referenceNumber).toBe('MRSU6859427');
      expect(result.status).toBe('IN_TRANSIT');
      expect(result.provider).toBe('traqo');
    });
  });

  describe('error status mapping', () => {
    const cases: Array<[number, string]> = [
      [401, 'unauthorized'],
      [402, 'payment_required'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [400, 'bad_request'],
      [502, 'upstream_error'],
      [500, 'upstream_error'],
    ];

    for (const [status, kind] of cases) {
      it(`maps HTTP ${status} to TrackingProviderError(${kind})`, async () => {
        mockFetch.mockResolvedValue(jsonResponse(status, { statusCode: status }));
        const provider = new TraqoTrackingProvider();

        await expect(
          provider.trackContainer('MRSU6859427', 'MAEU', CREDS),
        ).rejects.toBeInstanceOf(TrackingProviderError);
        await expect(provider.trackContainer('MRSU6859427', 'MAEU', CREDS)).rejects.toMatchObject({
          kind,
        });
      });
    }

    it('maps 429 to rate_limited and carries Retry-After as retryAfterSeconds', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(429, { statusCode: 429 }, { 'retry-after': '42' }),
      );
      const provider = new TraqoTrackingProvider();

      await expect(provider.trackContainer('MRSU6859427', 'MAEU', CREDS)).rejects.toMatchObject({
        kind: 'rate_limited',
        retryAfterSeconds: 42,
      });
    });

    it('never leaks the raw provider error body in the thrown error message', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(401, { statusCode: 401, statusMessage: 'secret internal detail xyz' }),
      );
      const provider = new TraqoTrackingProvider();

      await expect(provider.trackContainer('MRSU6859427', 'MAEU', CREDS)).rejects.not.toMatchObject({
        message: expect.stringContaining('secret internal detail xyz'),
      });
    });
  });

  describe('network and malformed responses', () => {
    it('maps a fetch rejection (network failure/timeout) to network_error', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNRESET'));
      const provider = new TraqoTrackingProvider();

      await expect(provider.trackContainer('MRSU6859427', 'MAEU', CREDS)).rejects.toMatchObject({
        kind: 'network_error',
      });
    });

    it('maps a 200 response with unparsable JSON to invalid_response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.reject(new Error('not json')),
      });
      const provider = new TraqoTrackingProvider();

      await expect(provider.trackContainer('MRSU6859427', 'MAEU', CREDS)).rejects.toMatchObject({
        kind: 'invalid_response',
      });
    });

    it('maps a 200 response missing reference_number to invalid_response', async () => {
      mockFetch.mockResolvedValue(jsonResponse(200, { status: 'IN_TRANSIT' }));
      const provider = new TraqoTrackingProvider();

      await expect(provider.trackContainer('MRSU6859427', 'MAEU', CREDS)).rejects.toMatchObject({
        kind: 'invalid_response',
      });
    });
  });

  describe('listCarriers', () => {
    it('handles a bare array response', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(200, [{ scac: 'MAEU', name: 'Maersk' }]),
      );
      const provider = new TraqoTrackingProvider();

      const result = await provider.listCarriers(CREDS);
      expect(result).toEqual([{ scac: 'MAEU', name: 'Maersk' }]);
    });

    it('handles a { carriers: [...] } wrapped response', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(200, { carriers: [{ scac: 'MSCU', name: 'MSC' }] }),
      );
      const provider = new TraqoTrackingProvider();

      const result = await provider.listCarriers(CREDS, 'MSC');
      expect(result).toEqual([{ scac: 'MSCU', name: 'MSC' }]);
    });
  });
});
