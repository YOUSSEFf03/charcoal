import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ExpoPushProvider } from './expo-push.provider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe('ExpoPushProvider', () => {
  let provider: ExpoPushProvider;
  let configService: any;
  const originalFetch = global.fetch;

  beforeEach(() => {
    configService = { get: fn() };
    provider = new ExpoPushProvider(configService as unknown as ConfigService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns an empty array without calling fetch when there are no tokens', async () => {
    global.fetch = fn();
    const result = await provider.send([], { title: 't', body: 'b' });
    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends one message per token and maps a successful ticket to status "ok"', async () => {
    global.fetch = fn().mockResolvedValue(jsonResponse({ data: [{ status: 'ok' }, { status: 'ok' }] }));

    const result = await provider.send(['tok-1', 'tok-2'], { title: 'Container ETA Updated', body: 'MSCU1234567 — new ETA 23 Sep 2026' });

    expect(result).toEqual([
      { token: 'tok-1', status: 'ok', invalidToken: false },
      { token: 'tok-2', status: 'ok', invalidToken: false },
    ]);
    const [, options] = (global.fetch as any).mock.calls[0];
    const sentBody = JSON.parse(options.body);
    expect(sentBody).toEqual([
      { to: 'tok-1', title: 'Container ETA Updated', body: 'MSCU1234567 — new ETA 23 Sep 2026', data: {} },
      { to: 'tok-2', title: 'Container ETA Updated', body: 'MSCU1234567 — new ETA 23 Sep 2026', data: {} },
    ]);
  });

  it('flags invalidToken only for a ticket whose details.error is DeviceNotRegistered', async () => {
    global.fetch = fn().mockResolvedValue(
      jsonResponse({
        data: [
          { status: 'error', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', message: 'some other transient issue' },
        ],
      }),
    );

    const result = await provider.send(['dead-token', 'flaky-token'], { title: 't', body: 'b' });

    expect(result[0]).toEqual({ token: 'dead-token', status: 'error', invalidToken: true });
    expect(result[1]).toEqual({ token: 'flaky-token', status: 'error', invalidToken: false });
  });

  it('never deactivates on a network error — reports every token as a plain (non-invalid) error', async () => {
    global.fetch = fn().mockRejectedValue(new Error('network down'));
    const result = await provider.send(['tok-1'], { title: 't', body: 'b' });
    expect(result).toEqual([{ token: 'tok-1', status: 'error', invalidToken: false }]);
  });

  it('never deactivates on a non-2xx HTTP response', async () => {
    global.fetch = fn().mockResolvedValue(jsonResponse({}, false, 500));
    const result = await provider.send(['tok-1'], { title: 't', body: 'b' });
    expect(result).toEqual([{ token: 'tok-1', status: 'error', invalidToken: false }]);
  });

  it('never deactivates on an unparsable response body', async () => {
    global.fetch = fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
    const result = await provider.send(['tok-1'], { title: 't', body: 'b' });
    expect(result).toEqual([{ token: 'tok-1', status: 'error', invalidToken: false }]);
  });

  it('includes an Authorization header only when EXPO_ACCESS_TOKEN is configured', async () => {
    configService.get.mockReturnValue('expo-secret-token');
    global.fetch = fn().mockResolvedValue(jsonResponse({ data: [{ status: 'ok' }] }));

    await provider.send(['tok-1'], { title: 't', body: 'b' });

    const [, options] = (global.fetch as any).mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer expo-secret-token');
  });

  it('omits the Authorization header when EXPO_ACCESS_TOKEN is not configured', async () => {
    configService.get.mockReturnValue(undefined);
    global.fetch = fn().mockResolvedValue(jsonResponse({ data: [{ status: 'ok' }] }));

    await provider.send(['tok-1'], { title: 't', body: 'b' });

    const [, options] = (global.fetch as any).mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('chunks more than 100 tokens into multiple batches', async () => {
    global.fetch = fn().mockImplementation(async (_url: string, options: any) => {
      const sent = JSON.parse(options.body);
      return jsonResponse({ data: sent.map(() => ({ status: 'ok' })) });
    });

    const tokens = Array.from({ length: 150 }, (_, i) => `tok-${i}`);
    const result = await provider.send(tokens, { title: 't', body: 'b' });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(150);
    expect(result.every((r: any) => r.status === 'ok')).toBe(true);
  });
});
