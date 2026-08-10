import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard, isDevAuthBypassEnabled } from './auth.guard';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

/**
 * Builds a minimal ExecutionContext whose getRequest() returns the same
 * request object the test holds a reference to, so assertions can inspect
 * request.user after canActivate() resolves.
 */
function mockContext(headers: Record<string, string> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const request: any = { headers, user: undefined };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('JwtAuthGuard', () => {
  let reflector: { getAllAndOverride: ReturnType<typeof fn> };
  let clerkStrategy: { verify: ReturnType<typeof fn> };
  let prisma: { user: { upsert: ReturnType<typeof fn> } };
  let guard: JwtAuthGuard;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBypassFlag = process.env.DEV_AUTH_BYPASS_ENABLED;

  beforeEach(() => {
    reflector = { getAllAndOverride: fn() };
    clerkStrategy = { verify: fn() };
    prisma = { user: { upsert: fn() } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    guard = new JwtAuthGuard(reflector as any, clerkStrategy as any, prisma as any);
    // Default: not marked @Public().
    reflector.getAllAndOverride.mockReturnValue(false);
    // Default: the second dev-bypass gate is off, matching its safe default
    // in env.validation.ts. Individual dev-bypass tests opt in explicitly.
    delete process.env.DEV_AUTH_BYPASS_ENABLED;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalBypassFlag === undefined) {
      delete process.env.DEV_AUTH_BYPASS_ENABLED;
    } else {
      process.env.DEV_AUTH_BYPASS_ENABLED = originalBypassFlag;
    }
  });

  // ---------------------------------------------------------------------
  // @Public() bypass
  // ---------------------------------------------------------------------

  it('@Public(): skips authentication entirely when the route is marked public', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context } = mockContext(); // no Authorization header at all

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(clerkStrategy.verify).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Missing / malformed Authorization header
  // ---------------------------------------------------------------------

  it('throws UNAUTHORIZED when the Authorization header is absent', async () => {
    const { context } = mockContext({});

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UNAUTHORIZED' }),
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UNAUTHORIZED when the scheme is not "Bearer"', async () => {
    const { context } = mockContext({ authorization: 'Basic dXNlcjpwYXNz' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UNAUTHORIZED' }),
    });
  });

  it('throws UNAUTHORIZED when "Bearer" has no token value', async () => {
    const { context } = mockContext({ authorization: 'Bearer' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // ---------------------------------------------------------------------
  // Dev bypass — doubly gated: NODE_ENV !== 'production' AND
  // DEV_AUTH_BYPASS_ENABLED === 'true'. Neither condition alone may enable it.
  // ---------------------------------------------------------------------

  it('CRITICAL: dev bypass does NOT activate when NODE_ENV=production, even with DEV_AUTH_BYPASS_ENABLED=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_AUTH_BYPASS_ENABLED = 'true';
    clerkStrategy.verify.mockRejectedValue(
      new UnauthorizedException({ error: 'Invalid token', code: 'UNAUTHORIZED' }),
    );
    const { context } = mockContext({ authorization: 'Bearer dev:owner' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);

    // Proves the raw "dev:owner" string was handed to real Clerk verification,
    // not intercepted by the bypass branch.
    expect(clerkStrategy.verify).toHaveBeenCalledWith('dev:owner');
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('CRITICAL (defense-in-depth): dev bypass does NOT activate when NODE_ENV is non-production but DEV_AUTH_BYPASS_ENABLED is unset — a forgotten NODE_ENV alone can no longer expose it', async () => {
    delete process.env.NODE_ENV; // simulates the exact "forgot to set it" misconfiguration
    delete process.env.DEV_AUTH_BYPASS_ENABLED; // its safe default
    clerkStrategy.verify.mockRejectedValue(
      new UnauthorizedException({ error: 'Invalid token', code: 'UNAUTHORIZED' }),
    );
    const { context } = mockContext({ authorization: 'Bearer dev:owner' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clerkStrategy.verify).toHaveBeenCalledWith('dev:owner');
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('dev bypass does NOT activate when DEV_AUTH_BYPASS_ENABLED is explicitly "false"', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_AUTH_BYPASS_ENABLED = 'false';
    clerkStrategy.verify.mockRejectedValue(
      new UnauthorizedException({ error: 'Invalid token', code: 'UNAUTHORIZED' }),
    );
    const { context } = mockContext({ authorization: 'Bearer dev:owner' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('dev bypass activates when NODE_ENV is not set AND DEV_AUTH_BYPASS_ENABLED=true (both conditions satisfied)', async () => {
    delete process.env.NODE_ENV;
    process.env.DEV_AUTH_BYPASS_ENABLED = 'true';
    prisma.user.upsert.mockResolvedValue({});
    const { context, request } = mockContext({ authorization: 'Bearer dev:owner' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ userId: 'user_test_owner', role: 'owner' });
    expect(clerkStrategy.verify).not.toHaveBeenCalled();
  });

  // Mirrors auth.guard.ts's own clerkIdMap — sales_rep maps to "user_test_sales",
  // not the naively-pluralized "user_test_sales_rep".
  const devClerkIdByRole: Record<string, string> = {
    owner: 'user_test_owner',
    accountant: 'user_test_accountant',
    sales_rep: 'user_test_sales',
    worker: 'user_test_worker',
    driver: 'user_test_driver',
  };

  it.each(Object.keys(devClerkIdByRole))(
    'dev bypass: recognized role "%s" upserts a matching dev user and sets request.user',
    async (role) => {
      process.env.NODE_ENV = 'development';
      process.env.DEV_AUTH_BYPASS_ENABLED = 'true';
      prisma.user.upsert.mockResolvedValue({});
      const { context, request } = mockContext({ authorization: `Bearer dev:${role}` });
      const expectedClerkId = devClerkIdByRole[role];

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual({ userId: expectedClerkId, role });
      expect(prisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clerkId: expectedClerkId } }),
      );
    },
  );

  it('dev bypass: an unrecognized role suffix does NOT bypass — falls through to real verification', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_AUTH_BYPASS_ENABLED = 'true';
    clerkStrategy.verify.mockRejectedValue(
      new UnauthorizedException({ error: 'Invalid token', code: 'UNAUTHORIZED' }),
    );
    const { context } = mockContext({ authorization: 'Bearer dev:superadmin' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clerkStrategy.verify).toHaveBeenCalledWith('dev:superadmin');
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Real Clerk JWT verification path
  // ---------------------------------------------------------------------

  it('valid JWT with a role: attaches request.user and returns true', async () => {
    process.env.NODE_ENV = 'production';
    clerkStrategy.verify.mockResolvedValue({ userId: 'user_real_1', role: 'owner' });
    const { context, request } = mockContext({ authorization: 'Bearer real.jwt.token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ userId: 'user_real_1', role: 'owner' });
  });

  it('valid JWT with no role claim: throws ForbiddenException with code NO_ROLE', async () => {
    process.env.NODE_ENV = 'production';
    clerkStrategy.verify.mockResolvedValue({ userId: 'user_real_2', role: undefined });
    const { context } = mockContext({ authorization: 'Bearer real.jwt.token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NO_ROLE' }),
    });
  });

  it('propagates rejection from ClerkStrategy.verify (invalid/expired token)', async () => {
    process.env.NODE_ENV = 'production';
    clerkStrategy.verify.mockRejectedValue(
      new UnauthorizedException({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' }),
    );
    const { context } = mockContext({ authorization: 'Bearer expired.jwt.token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

// ===========================================================================
// isDevAuthBypassEnabled() — the exported defense-in-depth check reused by
// main.ts's startup warning. Tested directly so its four-quadrant truth table
// can't silently regress.
// ===========================================================================

describe('isDevAuthBypassEnabled()', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBypassFlag = process.env.DEV_AUTH_BYPASS_ENABLED;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalBypassFlag === undefined) {
      delete process.env.DEV_AUTH_BYPASS_ENABLED;
    } else {
      process.env.DEV_AUTH_BYPASS_ENABLED = originalBypassFlag;
    }
  });

  it('false when NODE_ENV=production, regardless of the flag', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_AUTH_BYPASS_ENABLED = 'true';
    expect(isDevAuthBypassEnabled()).toBe(false);
  });

  it('false when the flag is unset, regardless of NODE_ENV', () => {
    delete process.env.NODE_ENV;
    delete process.env.DEV_AUTH_BYPASS_ENABLED;
    expect(isDevAuthBypassEnabled()).toBe(false);
  });

  it('false when the flag is "false" even in a non-production environment', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_AUTH_BYPASS_ENABLED = 'false';
    expect(isDevAuthBypassEnabled()).toBe(false);
  });

  it('true only when both NODE_ENV != production AND the flag is "true"', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_AUTH_BYPASS_ENABLED = 'true';
    expect(isDevAuthBypassEnabled()).toBe(true);
  });
});
