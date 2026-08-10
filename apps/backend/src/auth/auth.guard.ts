import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ClerkStrategy } from './clerk.strategy';
import { PrismaService } from '../prisma/prisma.service';

/**
 * True only when BOTH independent gates for the dev auth bypass hold:
 *   1. NODE_ENV !== 'production'
 *   2. DEV_AUTH_BYPASS_ENABLED === 'true' (defaults to 'false' — must be
 *      explicitly opted into per-environment; see env.validation.ts).
 *
 * Neither condition alone can enable the bypass — a forgotten or
 * misconfigured NODE_ENV is no longer sufficient on its own. Exported so
 * main.ts can log a loud startup warning using the exact same check; the
 * guard logic and the visibility check must never drift apart.
 */
export function isDevAuthBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEV_AUTH_BYPASS_ENABLED === 'true'
  );
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly clerkStrategy: ClerkStrategy,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException({
        error: 'Missing or malformed Authorization header',
        code: 'UNAUTHORIZED',
      });
    }

    // Dev bypass — doubly gated, see isDevAuthBypassEnabled() above.
    if (isDevAuthBypassEnabled() && token.startsWith('dev:')) {
      const role = token.slice(4);
      const clerkIdMap: Record<string, string> = {
        owner: 'user_test_owner',
        accountant: 'user_test_accountant',
        sales_rep: 'user_test_sales',
        worker: 'user_test_worker',
        driver: 'user_test_driver',
      };
      const emailMap: Record<string, string> = {
        owner: 'owner@charcoal.com',
        accountant: 'accountant@charcoal.com',
        sales_rep: 'sales@charcoal.com',
        worker: 'worker@charcoal.com',
        driver: 'driver@charcoal.com',
      };
      if (clerkIdMap[role]) {
        await this.prisma.user.upsert({
          where: { clerkId: clerkIdMap[role] },
          update: {},
          create: {
            clerkId: clerkIdMap[role],
            email: emailMap[role],
            name: `Dev ${role}`,
            role: role as any,
          },
        });
        (request as any).user = { userId: clerkIdMap[role], role };
        return true;
      }
    }

    const user = await this.clerkStrategy.verify(token);

    if (!user.role) {
      throw new ForbiddenException({
        error: 'No role assigned to this user',
        code: 'NO_ROLE',
      });
    }

    // Attach the validated identity for downstream guards / handlers.
    (request as Request & { user: typeof user }).user = user;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) {
      return undefined;
    }
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) {
      return undefined;
    }
    return value;
  }
}
