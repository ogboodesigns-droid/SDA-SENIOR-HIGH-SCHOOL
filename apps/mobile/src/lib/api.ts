import type { ApiErrorBody, TokenPair } from '@sda-shs/shared';
import { getItem, removeItem, setItem } from './storage';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const BASE = `${API_URL}/api/v1`;
const ACCESS_KEY = 'sda_shs_access';
const REFRESH_KEY = 'sda_shs_refresh';
const TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues: ApiErrorBody['issues'] = [],
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: () => void = () => undefined;

/** Called by the auth provider so an expired session returns the user to sign-in. */
export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

export async function saveTokens(t: TokenPair) {
  accessToken = t.accessToken;
  await setItem(ACCESS_KEY, t.accessToken);
  await setItem(REFRESH_KEY, t.refreshToken);
}

export async function loadTokens(): Promise<boolean> {
  accessToken = await getItem(ACCESS_KEY);
  return !!accessToken || !!(await getItem(REFRESH_KEY));
}

export async function clearTokens() {
  accessToken = null;
  await removeItem(ACCESS_KEY);
  await removeItem(REFRESH_KEY);
}

async function timedFetch(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    throw new ApiError(0, (e as Error).name === 'AbortError' ? 'The connection is slow. Please try again.' : 'No internet connection. Please try again.');
  } finally {
    clearTimeout(timer);
  }
}

/** Only one refresh at a time: concurrent 401s all wait for the same attempt. */
function refreshOnce(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = await getItem(REFRESH_KEY);
    if (!refreshToken) return false;
    const res = await timedFetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => null);
    if (!res) return false;
    if (!res.ok) {
      if (res.status === 401) await clearTokens();
      return false;
    }
    await saveTokens((await res.json()) as TokenPair);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

type Body = Record<string, unknown> | FormData | undefined;

export async function api<T>(path: string, init: { method?: string; body?: Body; auth?: boolean } = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const send = () =>
    timedFetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init.body && !isForm ? { 'content-type': 'application/json' } : {}),
        ...(init.auth !== false && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: init.body ? (isForm ? (init.body as FormData) : JSON.stringify(init.body)) : undefined,
    });

  let res = await send();
  if (res.status === 401 && init.auth !== false) {
    if (await refreshOnce()) res = await send();
    else {
      onSignedOut();
      throw new ApiError(401, 'Your session has ended. Please sign in again.');
    }
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as Partial<ApiErrorBody>;
    throw new ApiError(res.status, err.message ?? 'Something went wrong', err.issues);
  }
  return data as T;
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError && e.issues?.length) return e.issues.map((i) => i.message).join('\n');
  return e instanceof Error ? e.message : String(e);
}

export function fileUrl(fileId: string) {
  return `${BASE}/files/${fileId}`;
}

export function currentAccessToken() {
  return accessToken;
}
