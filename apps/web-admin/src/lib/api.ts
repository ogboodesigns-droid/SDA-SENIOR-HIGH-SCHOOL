'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiErrorBody } from '@sda-shs/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues: ApiErrorBody['issues'] = [],
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Calls the API through this site's proxy (which holds the session cookies). */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const doFetch = () =>
    fetch(`/api/proxy${path}`, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });

  let res = await doFetch();
  if (res.status === 401) {
    // Another request may be refreshing the session at this moment; retry once with the new cookie.
    await sleep(400);
    res = await doFetch();
  }
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as Partial<ApiErrorBody>;
    if (res.status === 403 && err.message?.includes('temporary password') && typeof window !== 'undefined') {
      window.location.href = '/change-password';
    }
    throw new ApiError(res.status, err.message ?? 'Something went wrong', err.issues);
  }
  return data as T;
}

/** Uploads a file (multipart field "file") and returns the JSON reply. */
export async function upload<T>(path: string, file: File): Promise<T> {
  const send = () => {
    const body = new FormData();
    body.append('file', file);
    return fetch(`/api/proxy${path}`, { method: 'POST', body, cache: 'no-store' });
  };
  let res = await send();
  if (res.status === 401) {
    await sleep(400);
    res = await send();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as Partial<ApiErrorBody>;
    throw new ApiError(res.status, err.message ?? 'Something went wrong', err.issues);
  }
  return data as T;
}

/** Downloads a file from the API and saves it under the name the API gives. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api/proxy${path}`, { cache: 'no-store' });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, err.message ?? 'The file could not be downloaded');
  }
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const fileName = name ? decodeURIComponent(name) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Loads a resource and exposes a reload function; pass null to skip loading. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(path));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && e.issues?.length) {
    return `${e.message}: ${e.issues.map((i) => (i.path ? `${i.path} — ${i.message}` : i.message)).join('; ')}`;
  }
  return e instanceof Error ? e.message : String(e);
}

export function formatDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Africa/Accra',
  });
}
