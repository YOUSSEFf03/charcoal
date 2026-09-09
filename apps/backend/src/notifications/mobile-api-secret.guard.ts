import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

/**
 * Protects the mobile-facing endpoints with a single, static, high-entropy
 * shared secret instead of a Clerk session — mirrors
 * webhooks/webhooks.controller.ts's existing shape exactly: that route is
 * marked @Public() (skips the global JwtAuthGuard/RolesGuard) and instead
 * verifies its OWN credential (a Svix signature there, a shared secret
 * here). Every mobile route must combine @Public() with @UseGuards(this)
 * the same way.
 *
 * This is the resolved architecture from the mobile-app product decision:
 * the app is private, single-user, and has NO login screen — there is no
 * Clerk session to attach to a mobile request at all, so the normal
 * JwtAuthGuard path is not merely unused here, it is structurally
 * inapplicable. The secret is generated once, stored server-side as
 * MOBILE_API_SECRET (env var only — same pattern as CLERK_WEBHOOK_SECRET /
 * TRAQO_API_KEY_*, never in the database, never logged), and baked into the
 * mobile app at build time — never typed by a user, never a login step.
 */
@Injectable()
export class MobileApiSecretGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.configService.get<string>('MOBILE_API_SECRET');
    if (!secret) {
      // Mirrors TraqoKeyResolver's "not configured" business error — the
      // mobile app is an optional add-on; the rest of the server must keep
      // working with this unset, but the mobile surface fails cleanly
      // rather than silently accepting anything (or crashing at boot).
      throw new ServiceUnavailableException({
        error: 'Mobile API is not configured on this server.',
        code: 'MOBILE_API_NOT_CONFIGURED',
      });
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-mobile-api-secret'];

    if (typeof provided !== 'string' || !safeEquals(secret, provided)) {
      throw new UnauthorizedException({
        error: 'Invalid mobile API credential.',
        code: 'UNAUTHORIZED',
      });
    }

    return true;
  }
}

/** Constant-time string comparison — a plain `===` would leak timing information proportional to the matching-prefix length. */
function safeEquals(expected: string, provided: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
