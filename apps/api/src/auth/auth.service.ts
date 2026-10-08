import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from 'argon2';
import { and, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthResponse, ChangePasswordInput, LoginInput, TokenPair } from '@sda-shs/shared';
import { config } from '../config';
import { InjectDb, type Database } from '../database/database.module';
import { sessions, staffProfiles, students, users } from '../database/schema';
import type { AccessTokenPayload, AuthUser } from '../common/auth-user';
import { AuditService } from '../common/audit.service';
import { MeService } from './me.service';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AuthService {
  /** Verified against when the account doesn't exist, so response time doesn't reveal valid identifiers. */
  private dummyHash: Promise<string> = hash(randomBytes(16).toString('hex'));

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly me: MeService,
    private readonly audit: AuditService,
  ) {}

  private async findByIdentifier(identifier: string) {
    const id = identifier.trim();
    const [row] = await this.db
      .select({ user: users })
      .from(users)
      .leftJoin(students, eq(students.userId, users.id))
      .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
      .where(
        or(
          sql`lower(${users.email}) = lower(${id})`,
          eq(users.phone, id),
          eq(students.studentNumber, id.toUpperCase()),
          eq(staffProfiles.staffNumber, id.toUpperCase()),
        ),
      )
      .limit(1);
    return row?.user;
  }

  async login(input: LoginInput, client: ClientInfo): Promise<AuthResponse> {
    const user = await this.findByIdentifier(input.identifier);
    const invalid = new UnauthorizedException('The sign-in details are incorrect');

    if (!user) {
      await verify(await this.dummyHash, input.password).catch(() => false);
      throw invalid;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Too many failed attempts. Try again in a few minutes.');
    }

    const ok = await verify(user.passwordHash, input.password);
    if (!ok) {
      const failures = user.failedLoginCount + 1;
      const lock = failures >= MAX_FAILED_LOGINS;
      await this.db
        .update(users)
        .set({
          failedLoginCount: lock ? 0 : failures,
          lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
      await this.audit.record({ actorId: user.id, action: lock ? 'auth.locked' : 'auth.login_failed', entityType: 'user', entityId: user.id, ip: client.ip });
      throw invalid;
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException('This account has been deactivated. Contact the school office.');
    }

    await this.db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    const tokens = await this.startSession(user.id, user.role, input.deviceName ?? null, client);
    await this.audit.record({ actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ip: client.ip });
    return { ...tokens, user: await this.me.build(user.id) };
  }

  private newRefreshToken() {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: sha256(token) };
  }

  private refreshExpiry() {
    return new Date(Date.now() + config().REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }

  private async accessToken(userId: string, role: AuthUser['role'], sessionId: string) {
    const payload: AccessTokenPayload = { sub: userId, role, sid: sessionId };
    return this.jwt.signAsync(payload);
  }

  private async startSession(userId: string, role: AuthUser['role'], deviceName: string | null, client: ClientInfo): Promise<TokenPair> {
    const refresh = this.newRefreshToken();
    const [session] = await this.db
      .insert(sessions)
      .values({
        userId,
        tokenHash: refresh.hash,
        deviceName,
        userAgent: client.userAgent?.slice(0, 300) ?? null,
        ipAddress: client.ip,
        expiresAt: this.refreshExpiry(),
      })
      .returning({ id: sessions.id });
    return {
      accessToken: await this.accessToken(userId, role, session.id),
      refreshToken: refresh.token,
      expiresIn: config().ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    const presented = sha256(refreshToken);
    const expired = new UnauthorizedException('Your session has ended. Please sign in again.');

    const [session] = await this.db
      .select({ session: sessions, role: users.role, status: users.status })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(or(eq(sessions.tokenHash, presented), eq(sessions.previousTokenHash, presented)))
      .limit(1);
    if (!session || session.session.revokedAt) throw expired;

    if (session.session.tokenHash !== presented) {
      // An old token was replayed: whoever holds it is not the legitimate device.
      await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.session.id));
      await this.audit.record({
        actorId: session.session.userId,
        action: 'auth.refresh_reuse_detected',
        entityType: 'session',
        entityId: session.session.id,
        ip: client.ip,
      });
      throw expired;
    }
    if (session.session.expiresAt <= new Date() || session.status !== 'active') throw expired;

    const next = this.newRefreshToken();
    const updated = await this.db
      .update(sessions)
      .set({
        tokenHash: next.hash,
        previousTokenHash: presented,
        expiresAt: this.refreshExpiry(),
        lastUsedAt: new Date(),
        ipAddress: client.ip,
      })
      // Guards against two concurrent refreshes with the same token both succeeding.
      .where(and(eq(sessions.id, session.session.id), eq(sessions.tokenHash, presented)))
      .returning({ id: sessions.id });
    if (!updated.length) throw expired;

    return {
      accessToken: await this.accessToken(session.session.userId, session.role, session.session.id),
      refreshToken: next.token,
      expiresIn: config().ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async logout(user: AuthUser, everywhere: boolean) {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, user.id),
          isNull(sessions.revokedAt),
          everywhere ? undefined : eq(sessions.id, user.sessionId),
        ),
      );
  }

  async listSessions(user: AuthUser) {
    const rows = await this.db
      .select({
        id: sessions.id,
        deviceName: sessions.deviceName,
        userAgent: sessions.userAgent,
        lastUsedAt: sessions.lastUsedAt,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(sql`${sessions.lastUsedAt} desc`);
    return rows.map((r) => ({ ...r, current: r.id === user.sessionId }));
  }

  async revokeSession(user: AuthUser, sessionId: string) {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, user.id)));
  }

  async changePassword(user: AuthUser, input: ChangePasswordInput, client: ClientInfo) {
    const [row] = await this.db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id));
    if (!row || !(await verify(row.passwordHash, input.currentPassword))) {
      throw new UnauthorizedException('Your current password is incorrect');
    }
    if (input.currentPassword === input.newPassword) {
      throw new UnauthorizedException('Choose a password different from the current one');
    }
    await this.db
      .update(users)
      .set({ passwordHash: await hash(input.newPassword), mustChangePassword: false })
      .where(eq(users.id, user.id));
    // Sign out every other device.
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, user.id), ne(sessions.id, user.sessionId), isNull(sessions.revokedAt)));
    await this.audit.record({ actorId: user.id, action: 'auth.password_changed', entityType: 'user', entityId: user.id, ip: client.ip });
    return this.me.build(user.id);
  }
}
