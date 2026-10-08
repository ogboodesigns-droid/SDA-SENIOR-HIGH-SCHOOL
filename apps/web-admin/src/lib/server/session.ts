import 'server-only';
import { cookies } from 'next/headers';
import type { TokenPair } from '@sda-shs/shared';

export const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const ACCESS = 'sda_admin_at';
const REFRESH = 'sda_admin_rt';
const secure = process.env.NODE_ENV === 'production';

/**
 * Tokens live only in httpOnly, SameSite=Strict cookies: page scripts never
 * see them, and the browser won't send them on cross-site requests.
 */
export async function setSession(tokens: TokenPair) {
  const jar = await cookies();
  const base = { httpOnly: true, secure, sameSite: 'strict' as const, path: '/' };
  jar.set(ACCESS, tokens.accessToken, { ...base, maxAge: tokens.expiresIn });
  jar.set(REFRESH, tokens.refreshToken, { ...base, maxAge: 30 * 86_400 });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(ACCESS);
  jar.delete(REFRESH);
}

export async function readSession() {
  const jar = await cookies();
  return { accessToken: jar.get(ACCESS)?.value, refreshToken: jar.get(REFRESH)?.value };
}

/** Rejects state-changing requests that didn't come from this site. */
export function sameOrigin(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
