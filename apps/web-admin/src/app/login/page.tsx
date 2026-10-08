'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Field } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: form.get('identifier'), password: form.get('password') }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message ?? 'Could not sign in');
      return;
    }
    const next = params.get('next');
    router.replace(data.mustChangePassword ? '/change-password' : next?.startsWith('/') && !next.startsWith('//') ? next : '/');
  }

  return (
    <form className="stack" onSubmit={submit}>
      <Field label="Email, phone or staff number">
        <input name="identifier" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password">
        <input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Alert>{error}</Alert>
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="auth-page">
      <div className="auth-card stack">
        <div>
          <h1>SDA SHS</h1>
          <p className="muted">Administration portal for staff. Students and parents use the mobile app.</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
