'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ROLE_LABELS, ROLES, type House, type Paginated, type Role, type SubjectCombination, type UserListItem } from '@sda-shs/shared';
import { api, formatDate, useApi } from '@/lib/api';
import { useCan, useMe } from '@/lib/me';
import { Alert, blankToNull, Card, Empty, Field, Loading, PageHeader, useSubmit } from '@/components/ui';

interface ClassOption {
  id: string;
  name: string;
  programmeId: string;
  stream: number | null;
}

function CreateUser({ onCreated }: { onCreated: () => void }) {
  const me = useMe();
  const [role, setRole] = useState<Role>('student');
  const [classId, setClassId] = useState('');
  const classes = useApi<ClassOption[]>('/classes');
  const houses = useApi<House[]>('/houses');
  const cls = classes.data?.find((c) => c.id === classId);
  const combos = useApi<SubjectCombination[]>(cls ? `/combinations?programmeId=${cls.programmeId}` : null);
  const options = combos.data?.filter((c) => cls?.stream == null || c.stream === cls.stream) ?? [];
  const roles = ROLES.filter((r) => r !== 'super_admin' || me.role === 'super_admin');

  const { onSubmit, busy, error, success } = useSubmit(async (v, form) => {
    await api('/users', {
      method: 'POST',
      body: {
        fullName: v.fullName,
        role,
        email: blankToNull(v.email),
        phone: blankToNull(v.phone),
        temporaryPassword: v.temporaryPassword,
        student:
          role === 'student'
            ? {
                studentNumber: v.studentNumber,
                classId,
                combinationId: blankToNull(v.combinationId),
                houseId: blankToNull(v.houseId),
                dateOfBirth: blankToNull(v.dateOfBirth),
              }
            : undefined,
        staff: role !== 'student' && role !== 'parent' && v.staffNumber ? { staffNumber: v.staffNumber } : undefined,
      },
    });
    form.reset();
    onCreated();
    return `Account created. Give ${v.fullName} the temporary password privately; they must change it at first sign-in.`;
  });

  return (
    <Card title="Create an account">
      <form className="stack" onSubmit={onSubmit}>
        <div className="grid">
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Full name">
            <input name="fullName" required />
          </Field>
          <Field label="Email" hint={role === 'student' ? 'Optional for students' : undefined}>
            <input name="email" type="email" />
          </Field>
          <Field label="Phone" hint="e.g. +233241234567">
            <input name="phone" inputMode="tel" />
          </Field>
          {role === 'student' && (
            <>
              <Field label="Student number">
                <input name="studentNumber" required />
              </Field>
              <Field label="Class">
                <select required value={classId} onChange={(e) => setClassId(e.target.value)}>
                  <option value="" disabled>
                    Choose a class
                  </option>
                  {classes.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Option (subject combination)" hint={cls && !options.length ? 'No options set up for this class' : undefined}>
                <select name="combinationId" defaultValue="" key={classId}>
                  <option value="">Not chosen yet</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {`${cls?.name ?? ''}${o.letter}`} · Option {o.option}: {o.electives.map((e) => e.name).join(', ')}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="House">
                <select name="houseId" defaultValue="">
                  <option value="">Not assigned</option>
                  {houses.data?.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date of birth">
                <input name="dateOfBirth" type="date" />
              </Field>
            </>
          )}
          {role !== 'student' && role !== 'parent' && (
            <Field label="Staff number">
              <input name="staffNumber" />
            </Field>
          )}
          <Field label="Temporary password" hint="10+ characters with a letter and a number">
            <input name="temporaryPassword" required minLength={10} autoComplete="new-password" />
          </Field>
        </div>
        <Alert>{error}</Alert>
        <Alert kind="success">{success}</Alert>
        <div>
          <button disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </div>
      </form>
    </Card>
  );
}

export default function UsersPage() {
  const canManage = useCan('users:manage');
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), ...(role ? { role } : {}), ...(search ? { search } : {}) });
  const list = useApi<Paginated<UserListItem>>(`/users?${qs}`);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="People" description="Students, parents/guardians and staff accounts" />
      {canManage && <CreateUser onCreated={list.reload} />}
      <Card
        title="Accounts"
        actions={
          <div className="row">
            <select value={role} onChange={(e) => (setRole(e.target.value), setPage(1))} aria-label="Filter by role">
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <input placeholder="Search name, number, email…" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} aria-label="Search" />
          </div>
        }
      >
        <Alert>{list.error}</Alert>
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty>No accounts match.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Number</th>
                  <th>Class</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/users/${u.id}`}>{u.fullName}</Link>
                      <div className="muted">{u.email ?? u.phone}</div>
                    </td>
                    <td>{ROLE_LABELS[u.role]}</td>
                    <td>{u.studentNumber ?? u.staffNumber ?? '—'}</td>
                    <td>{u.className ?? '—'}</td>
                    <td>
                      <span className={`badge ${u.status === 'active' ? 'ok' : 'danger'}`}>{u.status}</span>
                    </td>
                    <td>{formatDate(u.lastLoginAt, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="muted">
            Page {page} of {pages} · {list.data?.total ?? 0} accounts
          </span>
          <button className="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      </Card>
    </>
  );
}
