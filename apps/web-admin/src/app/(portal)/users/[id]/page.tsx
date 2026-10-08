'use client';

import { use, useState } from 'react';
import { ROLE_LABELS, type Me, type Paginated, type UserListItem } from '@sda-shs/shared';
import { api, formatDate, useApi } from '@/lib/api';
import { useCan } from '@/lib/me';
import { Alert, Card, Field, Loading, PageHeader, useSubmit } from '@/components/ui';

interface UserDetail extends Me {
  status: 'active' | 'deactivated';
  createdAt: string;
  lastLoginAt: string | null;
  guardians: { id: string; fullName: string; phone: string | null; email: string | null; relationship: string }[];
}

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canManage = useCan('users:manage');
  const user = useApi<UserDetail>(`/users/${id}`);
  const classes = useApi<{ id: string; name: string }[]>(user.data?.role === 'student' ? '/classes' : null);
  const [parentSearch, setParentSearch] = useState('');
  const parents = useApi<Paginated<UserListItem>>(
    canManage && user.data?.role === 'student' && parentSearch.length > 1 ? `/users?role=parent&search=${encodeURIComponent(parentSearch)}` : null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useSubmit(async (v, form) => {
    await api(`/users/${id}/reset-password`, { method: 'POST', body: { temporaryPassword: v.temporaryPassword } });
    form.reset();
    return 'Password reset. The user has been signed out everywhere and must choose a new password.';
  });

  const link = useSubmit(async (v) => {
    await api('/guardian-links', { method: 'POST', body: { guardianUserId: v.guardianUserId, studentId: user.data!.student!.id, relationship: v.relationship } });
    await user.reload();
    return 'Parent/guardian linked.';
  });

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    setMessage(null);
    try {
      await fn();
      await user.reload();
      setMessage(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (user.loading && !user.data) return <Loading />;
  if (!user.data) return <Alert>{user.error}</Alert>;
  const u = user.data;

  return (
    <>
      <PageHeader
        title={u.fullName}
        description={`${ROLE_LABELS[u.role]} · created ${formatDate(u.createdAt)} · last sign-in ${formatDate(u.lastLoginAt, true)}`}
        actions={
          canManage && (
            <button
              className={u.status === 'active' ? 'danger' : ''}
              onClick={() =>
                act(
                  () => api(`/users/${id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'deactivated' : 'active' } }),
                  u.status === 'active' ? 'Account deactivated and signed out.' : 'Account reactivated.',
                )
              }
            >
              {u.status === 'active' ? 'Deactivate account' : 'Reactivate account'}
            </button>
          )
        }
      />
      <Alert>{error}</Alert>
      <Alert kind="success">{message}</Alert>

      <Card title="Details">
        <div className="grid">
          <div>
            <div className="field-label">Status</div>
            <span className={`badge ${u.status === 'active' ? 'ok' : 'danger'}`}>{u.status}</span>
          </div>
          <div>
            <div className="field-label">Email</div>
            {u.email ?? '—'}
          </div>
          <div>
            <div className="field-label">Phone</div>
            {u.phone ?? '—'}
          </div>
          {u.student && (
            <>
              <div>
                <div className="field-label">Student number</div>
                {u.student.studentNumber}
              </div>
              <div>
                <div className="field-label">Class</div>
                {u.student.className} ({u.student.programmeName})
              </div>
            </>
          )}
        </div>
        {u.student && canManage && (
          <div className="row" style={{ marginTop: 14 }}>
            <Field label="Move to class">
              <select
                defaultValue={u.student.classId}
                onChange={(e) => act(() => api(`/users/${id}`, { method: 'PATCH', body: { classId: e.target.value } }), 'Class updated.')}
              >
                {classes.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </Card>

      {u.role === 'parent' && (
        <Card title="Children">
          {u.children.length ? (
            <ul>
              {u.children.map((c) => (
                <li key={c.id}>
                  {c.fullName} — {c.className} ({c.studentNumber})
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">Not linked to any student yet. Link from the student&apos;s page.</p>
          )}
        </Card>
      )}

      {u.role === 'student' && (
        <Card title="Parents / guardians">
          {u.guardians.length ? (
            <table>
              <tbody>
                {u.guardians.map((g) => (
                  <tr key={g.id}>
                    <td>{g.fullName}</td>
                    <td>{g.relationship}</td>
                    <td>{g.phone ?? g.email}</td>
                    {canManage && (
                      <td>
                        <button
                          className="secondary"
                          onClick={() => act(() => api(`/guardian-links/${g.id}/${u.student!.id}`, { method: 'DELETE' }), 'Guardian unlinked.')}
                        >
                          Unlink
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty">No parent or guardian linked.</p>
          )}
          {canManage && (
            <form className="stack" onSubmit={link.onSubmit} style={{ marginTop: 14 }}>
              <div className="grid">
                <Field label="Find parent account">
                  <input value={parentSearch} onChange={(e) => setParentSearch(e.target.value)} placeholder="Type a name or phone" />
                </Field>
                <Field label="Parent">
                  <select name="guardianUserId" required>
                    {parents.data?.items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} {p.phone ? `(${p.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Relationship">
                  <input name="relationship" placeholder="Mother, Father, Guardian…" required />
                </Field>
              </div>
              <Alert>{link.error}</Alert>
              <Alert kind="success">{link.success}</Alert>
              <div>
                <button disabled={link.busy}>Link parent/guardian</button>
              </div>
            </form>
          )}
        </Card>
      )}

      {canManage && (
        <Card title="Reset password">
          <form className="row" onSubmit={reset.onSubmit}>
            <input name="temporaryPassword" placeholder="New temporary password" minLength={10} required style={{ maxWidth: 300 }} autoComplete="new-password" />
            <button disabled={reset.busy}>Reset</button>
          </form>
          <Alert>{reset.error}</Alert>
          <Alert kind="success">{reset.success}</Alert>
        </Card>
      )}
    </>
  );
}
