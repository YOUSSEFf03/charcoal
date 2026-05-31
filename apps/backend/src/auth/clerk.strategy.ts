import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { JwksClient, SigningKey } from 'jwks-rsa';

export interface ClerkUser {
  userId: string;
  role?: string;
}

/**
 * Verifies Clerk-issued JWTs using the instance JWKS endpoint and extracts the
 * userId (`sub`) and role from the token claims.
 *
 * Clerk places custom claims either at the top level (when a custom session
 * token template is used, e.g. `{ "role": "{{user.public_metadata.role}}" }`)
 * or under `publicMetadata` / `metadata`. We check all of these.
 */
@Injectable()
export class ClerkStrategy {
  private readonly logger = new Logger(ClerkStrategy.name);
  private readonly jwksClient: JwksClient;

  constructor(private readonly configService: ConfigService) {
    const jwksUri =
      this.configService.get<string>('CLERK_JWKS_URL') ??
      'https://api.clerk.com/v1/jwks';

    this.jwksClient = new JwksClient({
      jwksUri,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000, // 10 minutes
      rateLimit: true,
    });
  }

  async verify(token: string): Promise<ClerkUser> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header?.kid) {
      throw new UnauthorizedException({
        error: 'Invalid token',
        code: 'UNAUTHORIZED',
      });
    }

    let signingKey: string;
    try {
      const key: SigningKey = await this.jwksClient.getSigningKey(
        decoded.header.kid,
      );
      signingKey = key.getPublicKey();
    } catch (err) {
      this.logger.warn(`Failed to resolve JWKS signing key: ${err}`);
      throw new UnauthorizedException({
        error: 'Unable to verify token signature',
        code: 'UNAUTHORIZED',
      });
    }

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, signingKey, {
        algorithms: ['RS256'],
      }) as jwt.JwtPayload;
    } catch (err) {
      this.logger.warn(`JWT verification failed: ${err}`);
      throw new UnauthorizedException({
        error: 'Invalid or expired token',
        code: 'UNAUTHORIZED',
      });
    }

    const userId = payload.sub;
    if (!userId) {
      throw new UnauthorizedException({
        error: 'Token has no subject',
        code: 'UNAUTHORIZED',
      });
    }

    const role = this.extractRole(payload);

    return { userId, role };
  }

  private extractRole(payload: jwt.JwtPayload): string | undefined {
    if (typeof payload.role === 'string') {
      return payload.role;
    }
    const publicMetadata = payload.publicMetadata as
      | { role?: string }
      | undefined;
    if (publicMetadata?.role) {
      return publicMetadata.role;
    }
    const metadata = payload.metadata as { role?: string } | undefined;
    return metadata?.role;
  }
}
