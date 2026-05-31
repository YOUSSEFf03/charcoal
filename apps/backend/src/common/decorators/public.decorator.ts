import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as public so the global JwtAuthGuard skips authentication.
 * Used for /health and /webhooks/clerk.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
