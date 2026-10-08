import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { hasPermission, type Permission } from '@sda-shs/shared';
import type { Request } from 'express';
import { InjectDb, type Database } from '../database/database.module';
import { sessions, users } from '../database/schema';
import type { AccessTokenPayload, AuthUser } from './auth-user';
import { ALLOW_PENDING_PASSWORD, IS_PUBLIC, PERMISSIONS_KEY } from './decorators';

/**
 * Global guard: every route requires a valid access token unless marked
 * @Public(). The user and session are re-checked on each request so that
 * deactivating an account or signing out a device takes effect immediately
 * rather than when the access token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectDb() private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in to continue');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Your session has expired');
    }

    const [row] = await this.db
      .select({ role: users.role, status: users.status, mustChangePassword: users.mustChangePassword })
      .from(users)
      .innerJoin(sessions, and(eq(sessions.userId, users.id), eq(sessions.id, payload.sid), isNull(sessions.revokedAt)))
      .where(eq(users.id, payload.sub))
      .limit(1);
    if (!row || row.status !== 'active') throw new UnauthorizedException('Your session has ended');

    if (row.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)) {
      throw new ForbiddenException('Change your temporary password to continue');
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
    if (!required.every((p) => hasPermission(row.role, p))) {
      throw new ForbiddenException('You do not have permission to do this');
    }

    req.user = { id: payload.sub, role: row.role, sessionId: payload.sid };
    return true;
  }
}
