'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { gradeFor, type GradingScaleInput, type ResultRow, type StudentSummary, type TermSummary } from '@sda-shs/shared';
import { api, errorMessage, useApi } from '@/lib/api';
import { useCan } from '@/lib/me';
import { ClassSubjectPicker } from '@/components/class-subject-picker';
import { Alert, Card, Empty, Field, Loading, PageHeader } from '@/components/ui';

interface Draft {
  ca: string;
  exam: string;
  comment: string;
}

function Results() {
  const params = useSearchParams();
  const canPublish = useCan('results:publish');
  const terms = useApi<TermSummary[]>('/terms');
  const scale = useApi<GradingScaleInput>('/school/grading-scale');
  const [termId, setTermId] = useState('');
  const [pick, setPick] = useState({ classId: params.get('classId') ?? '', subjectId: params.get('subjectId') ?? '' });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!termId && terms.data?.length) setTermId((terms.data.find((t) => t.isCurrent) ?? terms.data[0]).id);
  }, [terms.data, termId]);

  const ready = termId && pick.classId && pick.subjectId;
  const students = useApi<StudentSummary[]>(pick.classId ? `/classes/${pick.classId}/students` : null);
  const sheet = useApi<ResultRow[]>(ready ? `/results/sheet?termId=${termId}&classId=${pick.classId}&subjectId=${pick.subjectId}` : null);

  useEffect(() => {
    const next: Record<string, Draft> = {};
    for (const r of sheet.data ?? []) next[r.studentId] = { ca: String(r.caScore), exam: String(r.examScore), comment: r.teacherComment ?? '' };
    setDrafts(next);
  }, [sheet.data]);

  const byStudent = useMemo(() => new Map(sheet.data?.map((r) => [r.studentId, r])), [sheet.data]);
  const anyPublished = sheet.data?.some((r) => r.published);

  async function save() {
    const entries = Object.entries(drafts)
      .filter(([, d]) => d.ca !== '' && d.exam !== '')
      .map(([studentId, d]) => ({ studentId, caScore: Number(d.ca), examScore: Number(d.exam), teacherComment: d.comment || null }));
    if (!entries.length) {
      setMessage({ kind: 'error', text: 'Enter at least one complete row (CA and exam).' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const rows = await api<ResultRow[]>('/results', { method: 'PUT', body: { termId, classId: pick.classId, subjectId: pick.subjectId, entries } });
      sheet.setData(rows);
      setMessage({ kind: 'success', text: `Saved ${entries.length} result(s). They stay private until the school publishes them.` });
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function publish(all: boolean) {
    if (!confirm(all ? 'Publish ALL saved subjects for this class? Students and parents will be notified.' : 'Publish this subject for this class? Students and parents will be notified.')) return;
    try {
      const res = await api<{ published: number; students: number }>('/results/publish', {
        method: 'POST',
        body: { termId, classId: pick.classId, ...(all ? {} : { subjectId: pick.subjectId }) },
      });
      await sheet.reload();
      setMessage({ kind: 'success', text: `Published ${res.published} result(s) for ${res.students} student(s).` });
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) });
    }
  }

  const set = (id: string, key: keyof Draft, value: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? { ca: '', exam: '', comment: '' }), [key]: value } }));

  return (
    <>
      <PageHeader
        title="Results"
        description={
          scale.data
            ? `Continuous assessment out of ${scale.data.caMax}, examination out of ${scale.data.examMax}. Grades are calculated from the school's grading scale.`
            : undefined
        }
      />
      <Card>
        <div className="grid">
          <Field label="Term">
            <select value={termId} onChange={(e) => setTermId(e.target.value)}>
              {terms.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.academicYearName} — {t.name}
                </option>
              ))}
            </select>
          </Field>
          <ClassSubjectPicker classId={pick.classId} subjectId={pick.subjectId} onChange={setPick} />
        </div>
      </Card>

      {ready && (
        <Card
          title="Mark sheet"
          actions={
            <div className="row">
              {anyPublished && <span className="badge ok">Published</span>}
              <button onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              {canPublish && (
                <>
                  <button className="secondary" onClick={() => publish(false)}>
                    Publish subject
                  </button>
                  <button className="secondary" onClick={() => publish(true)}>
                    Publish whole class
                  </button>
                </>
              )}
            </div>
          }
        >
          {message && <Alert kind={message.kind}>{message.text}</Alert>}
          {students.loading || sheet.loading ? (
            <Loading />
          ) : !students.data?.length ? (
            <Empty>No students in this class.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>CA</th>
                    <th>Exam</th>
                    <th>Total</th>
                    <th>Grade</th>
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {students.data.map((s) => {
                    const d = drafts[s.id] ?? { ca: '', exam: '', comment: '' };
                    const total = d.ca !== '' && d.exam !== '' ? Number(d.ca) + Number(d.exam) : null;
                    const preview = total !== null && scale.data ? gradeFor(total, scale.data.bands).grade : '';
                    const saved = byStudent.get(s.id);
                    return (
                      <tr key={s.id}>
                        <td>
                          {s.fullName}
                          <div className="muted">{s.studentNumber}</div>
                        </td>
                        <td>
                          <input type="number" step="0.5" min={0} max={scale.data?.caMax} value={d.ca} onChange={(e) => set(s.id, 'ca', e.target.value)} aria-label={`CA for ${s.fullName}`} />
                        </td>
                        <td>
                          <input type="number" step="0.5" min={0} max={scale.data?.examMax} value={d.exam} onChange={(e) => set(s.id, 'exam', e.target.value)} aria-label={`Exam for ${s.fullName}`} />
                        </td>
                        <td>{total ?? '—'}</td>
                        <td>
                          {preview}
                          {saved?.published && <span className="badge ok" style={{ marginLeft: 6 }}>published</span>}
                        </td>
                        <td>
                          <input value={d.comment} onChange={(e) => set(s.id, 'comment', e.target.value)} maxLength={500} aria-label={`Comment for ${s.fullName}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

export default function ResultsPage() {
  return (
    <Suspense>
      <Results />
    </Suspense>
  );
}
