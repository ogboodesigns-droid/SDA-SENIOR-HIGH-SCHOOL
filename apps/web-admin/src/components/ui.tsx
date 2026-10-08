'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '@/lib/api';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info'; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <p className="muted">{what}…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/**
 * Wraps a submit handler with busy/error/success state. The handler receives
 * the form's values as a plain object of strings.
 */
export function useSubmit(handler: (values: Record<string, string>, form: HTMLFormElement) => Promise<string | void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(Array.from(new FormData(form).entries()).map(([k, v]) => [k, String(v)]));
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const msg = await handler(values, form);
      if (msg) setSuccess(msg);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return { onSubmit, busy, error, success, setError };
}

/** Turns empty strings into null so optional API fields are omitted rather than sent blank. */
export function blankToNull(v: string | undefined): string | null {
  return v && v.trim() ? v.trim() : null;
}
