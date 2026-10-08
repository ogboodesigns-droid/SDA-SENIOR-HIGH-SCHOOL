import type { Role } from '@sda-shs/shared';

/** The signed-in user attached to each authenticated request. */
export interface AuthUser {
  id: string;
  role: Role;
  sessionId: string;
}

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  sid: string;
}
