import { NextResponse } from 'next/server';
import { API_URL, clearSession, readSession, sameOrigin } from '@/lib/server/session';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const { accessToken } = await readSession();
  if (accessToken) {
    await fetch(`${API_URL}/api/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } }).catch(() => undefined);
  }
  await clearSession();
  return new NextResponse(null, { status: 204 });
}
