'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { AssignmentSummary } from '@sda-shs/shared';
import { api, formatDate, useApi } from '@/lib/api';
import { ClassSubjectPicker } from '@/components/class-subject-picker';
import { Alert, Card, Empty, Field, Loading, PageHeader, useSubmit } from '@/components/ui';

function Assignments() {
  const params = useSearchParams();
  const [pick, setPick] = useState({ classId: params.get('classId') ?? '', subjectId: params.get('subjectId') ?? '' });
  const list = useApi<AssignmentSummary[]>('/assignments');

  const create = useSubmit(async (v, form) => {
    if (!pick.classId || !pick.subjectId) throw new Error('Choose the class and subject');
    await api('/assignments', {
      method: 'POST',
      body: {
        classId: pick.classId,
        subjectId: pick.subjectId,
        title: v.title,
        instructions: v.instructions,
        dueAt: new Date(v.dueAt).toISOString(),
        maxScore: Number(v.maxScore || 100),
        allowLateSubmissions: v.allowLate === 'on',
      },
    });
    form.reset();
    await list.reload();
    return 'Assignment set. Students and their parents have been notified.';
  });

  return (
    <>
      <PageHeader title="Assignments" description="Set work for your classes and mark submissions." />
      <Card title="Set an assignment">
        <form className="stack" onSubmit={create.onSubmit}>
          <div className="grid">
            <ClassSubjectPicker classId={pick.classId} subjectId={pick.subjectId} onChange={setPick} />
            <Field label="Title">
              <input name="title" required maxLength={160} />
            </Field>
            <Field label="Due">
              <input name="dueAt" type="datetime-local" required />
            </Field>
            <Field label="Marked out of">
              <input name="maxScore" type="number" min={1} max={1000} defaultValue={100} />
            </Field>
            <label className="row" style={{ alignSelf: 'end' }}>
              <input type="checkbox" name="allowLate" defaultChecked /> Accept late submissions
            </label>
          </div>
          <Field label="Instructions">
            <textarea name="instructions" required />
          </Field>
          <Alert>{create.error}</Alert>
          <Alert kind="success">{create.success}</Alert>
          <div>
            <button disabled={create.busy}>Set assignment</button>
          </div>
        </form>
      </Card>

      <Card title="Assignments">
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.length ? (
          <Empty>No assignments yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Class</th>
                <th>Due</th>
                <th>Submissions</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/assignments/${a.id}`}>{a.title}</Link>
                    <div className="muted">
                      {a.subjectName} · {a.teacherName}
                    </div>
                  </td>
                  <td>{a.className}</td>
                  <td>
                    {formatDate(a.dueAt, true)} {new Date(a.dueAt) < new Date() && <span className="badge">Closed</span>}
                  </td>
                  <td>{a.submissionCount ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

export default function AssignmentsPage() {
  return (
    <Suspense>
      <Assignments />
    </Suspense>
  );
}
