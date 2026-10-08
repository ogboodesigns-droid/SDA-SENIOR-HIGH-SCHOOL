'use client';

import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Alert, Field, useSubmit } from '@/components/ui';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { onSubmit, busy, error, setError } = useSubmit(async (v) => {
    if (v.newPassword !== v.confirm) {
      setError('The new passwords do not match');
      return;
    }
    await api('/auth/change-password', { method: 'POST', body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
    router.replace('/');
  });

  return (
    <div className="auth-page">
      <div className="auth-card stack">
        <div>
          <h1>Choose a new password</h1>
          <p className="muted">Replace your temporary password before continuing. Other devices will be signed out.</p>
        </div>
        <form className="stack" onSubmit={onSubmit}>
          <Field label="Current (temporary) password">
            <input name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint="At least 10 characters, with a letter and a number.">
            <input name="newPassword" type="password" autoComplete="new-password" minLength={10} required />
          </Field>
          <Field label="Confirm new password">
            <input name="confirm" type="password" autoComplete="new-password" required />
          </Field>
          <Alert>{error}</Alert>
          <button disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        </form>
      </div>
    </div>
  );
}
