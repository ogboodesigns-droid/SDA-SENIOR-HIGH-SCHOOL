import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@sda-shs/shared';
import type { Request } from 'express';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC = 'isPublic';
export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';
export const PERMISSIONS_KEY = 'permissions';

/** Route needs no signed-in user. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route is reachable while the user still has to replace a temporary password. */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

/** Signed-in user must hold every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
  return req.user;
});

export function clientIp(req: Request): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}
