import { describe, it, expect, jest } from '@jest/globals';
import { ServiceUnavailableException, UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MobileApiSecretGuard } from './mobile-api-secret.guard';

const REAL_SECRET = 'a-very-long-high-entropy-shared-secret-value-1234567890';

function mockContext(headers: Record<string, string | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function makeGuard(secret: string | undefined): MobileApiSecretGuard {
  const configService = { get: jest.fn().mockReturnValue(secret) } as unknown as ConfigService;
  return new MobileApiSecretGuard(configService);
}

describe('MobileApiSecretGuard', () => {
  it('allows a request whose X-Mobile-Api-Secret header exactly matches the configured secret', () => {
    const guard = makeGuard(REAL_SECRET);
    const context = mockContext({ 'x-mobile-api-secret': REAL_SECRET });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a request with a wrong secret', () => {
    const guard = makeGuard(REAL_SECRET);
    const context = mockContext({ 'x-mobile-api-secret': 'totally-wrong-value' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a request with a wrong secret of the SAME length (proves it is not a naive length-only check)', () => {
    const guard = makeGuard(REAL_SECRET);
    const wrongSameLength = 'b'.repeat(REAL_SECRET.length);
    const context = mockContext({ 'x-mobile-api-secret': wrongSameLength });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a request with no header at all', () => {
    const guard = makeGuard(REAL_SECRET);
    const context = mockContext({});
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a non-string header value defensively', () => {
    const guard = makeGuard(REAL_SECRET);
    const context = mockContext({ 'x-mobile-api-secret': undefined });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('fails cleanly with 503 when MOBILE_API_SECRET is not configured on the server — never silently accepts', () => {
    const guard = makeGuard(undefined);
    const context = mockContext({ 'x-mobile-api-secret': 'anything' });
    expect(() => guard.canActivate(context)).toThrow(ServiceUnavailableException);
  });
});
