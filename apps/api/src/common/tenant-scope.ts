import type { AuthUser } from './auth-user';

/**
 * The minimal identity every data-access method requires. Services take it as
 * their first argument and add `workspaceId` to every Prisma `where` clause.
 * It is always derived from the verified JWT, never from request bodies or
 * LLM output.
 */
export type TenantScope = Pick<AuthUser, 'workspaceId' | 'userId'>;
