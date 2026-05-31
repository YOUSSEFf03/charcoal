import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { ClerkUser } from '../../auth/clerk.strategy';

/**
 * Injects the authenticated user ({ userId, role }) attached by JwtAuthGuard.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof ClerkUser | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: ClerkUser }>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
