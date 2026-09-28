import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The authenticated principal. `workspaceId` comes from the verified JWT and is
 * the only source of tenant scope anywhere in the API (including AI tools).
 */
export interface AuthUser {
  userId: string;
  workspaceId: string;
  email: string;
  name: string;
}

export type AuthenticatedRequest = Request & { user: AuthUser };

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

export const IS_PUBLIC = 'isPublic';
/** Marks a route as accessible without a bearer token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
