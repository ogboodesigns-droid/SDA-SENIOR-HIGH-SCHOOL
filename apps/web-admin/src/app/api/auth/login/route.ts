import { NextResponse } from 'next/server';
import type { AuthResponse } from '@sda-shs/shared';
import { API_URL, sameOrigin, setSession } from '@/lib/server/session';

const PORTAL_ROLES = new Set(['super_admin', 'head', 'assistant_head', 'teacher']);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': req.headers.get('user-agent') ?? 'web-admin',
      'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
    },
    body: JSON.stringify({ ...body, deviceName: 'Admin portal' }),
  });
  const data = await res.json();
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  const auth = data as AuthResponse;
  if (!PORTAL_ROLES.has(auth.user.role)) {
    // End the session we just opened: this account uses the mobile app.
    await fetch(`${API_URL}/api/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${auth.accessToken}` } });
    return NextResponse.json({ message: 'Use the SDA SHS mobile app to sign in with this account.' }, { status: 403 });
  }
  await setSession(auth);
  return NextResponse.json(auth.user);
}
