jest.mock('./config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001/api/v1',
    mobileApiSecret: 'test-secret-value',
  },
}));

import { api } from './client';

// axios doesn't expose a public way to invoke a registered interceptor
// directly, so we reach into the internal `.handlers` array — the standard
// pattern for unit-testing interceptor logic without a live network call.
function runRequestInterceptor(config: any) {
  return (api.interceptors.request as any).handlers[0].fulfilled(config);
}

function runResponseErrorInterceptor(err: any) {
  return (api.interceptors.response as any).handlers[0].rejected(err);
}

describe('mobile api client - request interceptor', () => {
  it('attaches the shared secret as X-Mobile-Api-Secret', () => {
    const headers = new Map<string, string>();
    const config = { headers: { set: (k: string, v: string) => headers.set(k, v) } };
    runRequestInterceptor(config);
    expect(headers.get('X-Mobile-Api-Secret')).toBe('test-secret-value');
  });
});

describe('mobile api client - response interceptor', () => {
  it('normalizes a backend error envelope', async () => {
    const err = {
      response: { status: 404, data: { error: 'Container not found', code: 'NOT_FOUND' } },
    };
    await expect(runResponseErrorInterceptor(err)).rejects.toEqual({
      status: 404,
      error: 'Container not found',
      code: 'NOT_FOUND',
      details: undefined,
    });
  });

  it('normalizes a network error with no response', async () => {
    const err = { request: {} };
    await expect(runResponseErrorInterceptor(err)).rejects.toEqual({
      status: undefined,
      error: 'Network error',
      code: 'NETWORK_ERROR',
      details: undefined,
    });
  });
});
