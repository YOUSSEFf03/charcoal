import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given roles. Combined with RolesGuard.
 * Routes without @Roles() are authenticated but not role-restricted.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
