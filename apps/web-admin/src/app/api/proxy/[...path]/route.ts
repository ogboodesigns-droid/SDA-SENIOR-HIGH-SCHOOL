import { NextResponse } from 'next/server';
import type { TokenPair } from '@sda-shs/shared';
import { API_URL, clearSession, readSession, sameOrigin, setSession } from '@/lib/server/session';

/**
 * Forwards browser requests to the API, attaching the access token from the
 * httpOnly cookie and transparently refreshing it once when it has expired.
 */
async function forward(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const { path } = await ctx.params;
  if (path[0] === 'auth' && ['login', 'refresh'].includes(path[1] ?? '')) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }
  const search = new URL(req.url).search;
  const target = `${API_URL}/api/v1/${path.map(encodeURIComponent).join('/')}${search}`;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();

  const send = (token?: string) =>
    fetch(target, {
      method: req.method,
      headers: {
        ...(req.headers.get('content-type') ? { 'content-type': req.headers.get('content-type')! } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
      },
      body,
      cache: 'no-store',
    });

  const session = await readSession();
  let res = await send(session.accessToken);

  if (res.status === 401 && session.refreshToken) {
    const refreshed = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (refreshed.ok) {
      const tokens = (await refreshed.json()) as TokenPair;
      await setSession(tokens);
      res = await send(tokens.accessToken);
    } else {
      await clearSession();
    }
  }

  const headers = new Headers();
  for (const h of ['content-type', 'content-disposition', 'content-length']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('cache-control', 'no-store');
  return new NextResponse(res.status === 204 ? null : res.body, { status: res.status, headers });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
