'use client';

import { use } from 'react';
import type { AssignmentSummary, SubmissionSummary } from '@sda-shs/shared';
import { api, formatDate, useApi } from '@/lib/api';
import { Alert, Card, Empty, Loading, PageHeader, useSubmit } from '@/components/ui';

function GradeForm({ sub, max, onDone }: { sub: SubmissionSummary; max: number; onDone: () => void }) {
  const grade = useSubmit(async (v) => {
    await api(`/submissions/${sub.id}/grade`, { method: 'POST', body: { score: Number(v.score), feedback: v.feedback || null } });
    onDone();
  });
  return (
    <form className="row" onSubmit={grade.onSubmit}>
      <input name="score" type="number" step="0.5" min={0} max={max} defaultValue={sub.score ?? ''} required style={{ maxWidth: 90 }} aria-label="Score" />
      <span className="muted">/ {max}</span>
      <input name="feedback" defaultValue={sub.feedback ?? ''} placeholder="Feedback (optional)" style={{ maxWidth: 260 }} aria-label="Feedback" />
      <button disabled={grade.busy}>{sub.status === 'graded' ? 'Update' : 'Mark'}</button>
      {grade.error && <span className="badge danger">{grade.error}</span>}
    </form>
  );
}

export default function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const assignment = useApi<AssignmentSummary>(`/assignments/${id}`);
  const subs = useApi<SubmissionSummary[]>(`/assignments/${id}/submissions`);

  if (assignment.loading && !assignment.data) return <Loading />;
  if (!assignment.data) return <Alert>{assignment.error}</Alert>;
  const a = assignment.data;

  return (
    <>
      <PageHeader title={a.title} description={`${a.subjectName} · ${a.className} · due ${formatDate(a.dueAt, true)}`} />
      <Card title="Instructions">
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{a.instructions}</p>
      </Card>
      <Card title={`Submissions (${subs.data?.length ?? 0})`}>
        <Alert>{subs.error}</Alert>
        {!subs.data?.length ? (
          <Empty>No submissions yet.</Empty>
        ) : (
          <div className="stack">
            {subs.data.map((s) => (
              <div key={s.id} className="card" style={{ marginBottom: 0 }}>
                <div className="card-head">
                  <h2>{s.studentName}</h2>
                  <span className={`badge ${s.status === 'graded' ? 'ok' : s.status === 'late' ? 'warn' : ''}`}>
                    {s.status} · {formatDate(s.submittedAt, true)}
                  </span>
                </div>
                {s.textResponse && <p style={{ whiteSpace: 'pre-wrap' }}>{s.textResponse}</p>}
                {s.file && (
                  <p>
                    <a href={`/api/proxy/files/${s.file.id}`}>Download {s.file.fileName}</a> ({Math.ceil(s.file.sizeBytes / 1024)} KB)
                  </p>
                )}
                <GradeForm sub={s} max={a.maxScore} onDone={subs.reload} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
