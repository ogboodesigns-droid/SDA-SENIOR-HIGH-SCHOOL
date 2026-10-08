'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  gradeFor,
  shortLabel,
  summariseScores,
  type AssessmentSchemesInput,
  type GradingScaleInput,
  type ResultRow,
  type StudentSummary,
  type TermSummary,
} from '@sda-shs/shared';
import { api, errorMessage, useApi } from '@/lib/api';
import { useCan } from '@/lib/me';
import { ClassSubjectPicker } from '@/components/class-subject-picker';
import { Alert, Card, Empty, Field, Loading, PageHeader } from '@/components/ui';

interface Draft {
  /** Component key → mark as typed ('' = not entered). */
  marks: Record<string, string>;
  comment: string;
}

const blank = (): Draft => ({ marks: {}, comment: '' });

function Results() {
  const params = useSearchParams();
  const canPublish = useCan('results:publish');
  const terms = useApi<TermSummary[]>('/terms');
  const scale = useApi<GradingScaleInput>('/school/grading-scale');
  const schemes = useApi<AssessmentSchemesInput>('/school/assessment-schemes');
  const [termId, setTermId] = useState('');
  const [pick, setPick] = useState({ classId: params.get('classId') ?? '', subjectId: params.get('subjectId') ?? '' });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!termId && terms.data?.length) setTermId((terms.data.find((t) => t.isCurrent) ?? terms.data[0]).id);
  }, [terms.data, termId]);

  const term = terms.data?.find((t) => t.id === termId);
  const components = schemes.data && term ? schemes.data[term.semester === 2 ? '2' : '1'] : [];
  const ready = termId && pick.classId && pick.subjectId;
  // Only students whose option includes this subject.
  const students = useApi<StudentSummary[]>(ready ? `/classes/${pick.classId}/students?subjectId=${pick.subjectId}` : null);
  const sheet = useApi<ResultRow[]>(ready ? `/results/sheet?termId=${termId}&classId=${pick.classId}&subjectId=${pick.subjectId}` : null);

  useEffect(() => {
    const next: Record<string, Draft> = {};
    for (const r of sheet.data ?? []) {
      next[r.studentId] = {
        marks: Object.fromEntries(r.breakdown.map((b) => [b.key, b.score === null ? '' : String(b.score)])),
        comment: r.teacherComment ?? '',
      };
    }
    setDrafts(next);
    setDirty(new Set());
  }, [sheet.data]);

  const byStudent = useMemo(() => new Map(sheet.data?.map((r) => [r.studentId, r])), [sheet.data]);

  function set(studentId: string, key: string, value: string) {
    setDrafts((d) => {
      const cur = d[studentId] ?? blank();
      return { ...d, [studentId]: key === '$comment' ? { ...cur, comment: value } : { ...cur, marks: { ...cur.marks, [key]: value } } };
    });
    setDirty((s) => new Set(s).add(studentId));
  }

  async function save() {
    const entries = [...dirty].map((studentId) => {
      const d = drafts[studentId] ?? blank();
      return {
        studentId,
        scores: Object.fromEntries(components.map((c) => [c.key, d.marks[c.key] === undefined || d.marks[c.key] === '' ? null : Number(d.marks[c.key])])),
        teacherComment: d.comment || null,
      };
    });
    if (!entries.length) {
      setMessage({ kind: 'error', text: 'Nothing has changed.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const rows = await api<ResultRow[]>('/results', { method: 'PUT', body: { termId, classId: pick.classId, subjectId: pick.subjectId, entries } });
      sheet.setData(rows);
      setMessage({ kind: 'success', text: `Saved marks for ${entries.length} student(s). They stay private until the school publishes them.` });
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function publish(all: boolean) {
    if (!confirm(all ? 'Publish ALL complete results for this class? Students and parents will be notified.' : 'Publish complete results for this subject? Students and parents will be notified.')) return;
    try {
      const res = await api<{ published: number; students: number; incomplete: number }>('/results/publish', {
        method: 'POST',
        body: { termId, classId: pick.classId, ...(all ? {} : { subjectId: pick.subjectId }) },
      });
      await sheet.reload();
      setMessage({
        kind: 'success',
        text: `Published ${res.published} result(s) for ${res.students} student(s).${res.incomplete ? ` ${res.incomplete} result(s) are missing marks and were not published.` : ''}`,
      });
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) });
    }
  }

  return (
    <>
      <PageHeader
        title="Results"
        description={
          components.length
            ? `Marks per assessment: ${components.map((c) => `${shortLabel(c)} /${c.weight}`).join(' · ')}. Graded on the WASSCE scale. Marks can be entered through the semester; only complete results can be published.`
            : undefined
        }
      />
      <Card>
        <div className="grid">
          <Field label="Semester">
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
              <button onClick={save} disabled={busy || !dirty.size}>
                {busy ? 'Saving…' : dirty.size ? `Save (${dirty.size})` : 'Saved'}
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
            <Empty>No students in this class take this subject.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    {components.map((c) => (
                      <th key={c.key} title={c.label}>
                        {shortLabel(c)}
                        <div style={{ textTransform: 'none', fontWeight: 400 }}>/{c.weight}</div>
                      </th>
                    ))}
                    <th>Total</th>
                    <th>Grade</th>
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {students.data.map((s) => {
                    const d = drafts[s.id] ?? blank();
                    const numbers = Object.fromEntries(
                      components.map((c) => [c.key, d.marks[c.key] === undefined || d.marks[c.key] === '' ? null : Number(d.marks[c.key])]),
                    );
                    const summary = summariseScores(components, numbers);
                    const anyMark = Object.values(numbers).some((v) => v !== null);
                    const saved = byStudent.get(s.id);
                    return (
                      <tr key={s.id}>
                        <td>
                          {s.fullName}
                          <div className="muted">
                            {s.groupName} · {s.studentNumber}
                          </div>
                        </td>
                        {components.map((c) => (
                          <td key={c.key}>
                            <input
                              type="number"
                              step="0.5"
                              min={0}
                              max={c.weight}
                              value={d.marks[c.key] ?? ''}
                              onChange={(e) => set(s.id, c.key, e.target.value)}
                              aria-label={`${c.label} for ${s.fullName}`}
                              style={{ width: 72, minWidth: 0 }}
                            />
                          </td>
                        ))}
                        <td>
                          {anyMark ? summary.total : '—'}
                          {anyMark && !summary.complete && <div className="field-hint">incomplete</div>}
                        </td>
                        <td>
                          {anyMark && scale.data ? gradeFor(summary.total, scale.data.bands).grade : ''}
                          {saved?.published && (
                            <span className="badge ok" style={{ marginLeft: 6 }}>
                              published
                            </span>
                          )}
                        </td>
                        <td>
                          <input value={d.comment} onChange={(e) => set(s.id, '$comment', e.target.value)} maxLength={500} aria-label={`Comment for ${s.fullName}`} />
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
