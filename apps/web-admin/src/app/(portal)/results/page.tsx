'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  gradeFor,
  shortLabel,
  summariseScores,
  type AssessmentSchemesInput,
  type GradeImportReport,
  type GradingScaleInput,
  type ResultRow,
  type StudentSummary,
  type TermSummary,
} from '@sda-shs/shared';
import { api, download, errorMessage, upload, useApi } from '@/lib/api';
import { useCan } from '@/lib/me';
import { ClassSubjectPicker } from '@/components/class-subject-picker';
import { IssueTable } from '@/components/import-issues';
import { Alert, Card, Empty, Field, Loading, PageHeader } from '@/components/ui';

interface Draft {
  /** Component key → mark as typed ('' = not entered). */
  marks: Record<string, string>;
  comment: string;
}

const blank = (): Draft => ({ marks: {}, comment: '' });

/** Download the class's score sheet (the school's Grade Import layout) and upload it back. */
function ScoreSheet({ termId, classId, subjectId, onSaved }: { termId: string; classId: string; subjectId: string; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [report, setReport] = useState<GradeImportReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    setError(null);
  }, [termId, classId, subjectId]);

  async function act(what: string, fn: () => Promise<void>) {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const send = (dryRun: boolean) =>
    act(dryRun ? 'check' : 'save', async () => {
      const r = await upload<GradeImportReport>(`/imports/results?dryRun=${dryRun}&overwrite=${overwrite}`, file!);
      setReport(r);
      if (!dryRun) onSaved();
    });

  return (
    <Card title="Score sheet (Excel)">
      <p className="muted">
        Download the score sheet for this class and subject, enter the marks in Excel and upload it here. Blank marks are left as they are, so a sheet can be
        uploaded more than once during the semester.
      </p>
      <div className="row">
        <button
          className="secondary"
          disabled={busy !== null}
          onClick={() => act('template', () => download(`/imports/results/template?termId=${termId}&classId=${classId}&subjectId=${subjectId}`, 'score-sheet.xlsx'))}
        >
          {busy === 'template' ? 'Preparing…' : 'Download score sheet'}
        </button>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setReport(null);
          }}
        />
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={overwrite} onChange={(e) => (setOverwrite(e.target.checked), setReport(null))} />
          Replace existing marks
        </label>
        <button disabled={!file || busy !== null} onClick={() => send(true)}>
          {busy === 'check' ? 'Checking…' : 'Check sheet'}
        </button>
      </div>
      <Alert>{error}</Alert>
      {report && (
        <>
          <p>
            {report.className} · {report.subjectName} · {report.academicYear} {report.semester}{' '}
            <span className="badge ok">{report.valid} ready</span>{' '}
            {report.total - report.valid > 0 && <span className="badge danger">{report.total - report.valid} with problems</span>}
          </p>
          {report.dryRun ? (
            <button disabled={!report.valid || busy !== null} onClick={() => send(false)}>
              {busy === 'save' ? 'Saving…' : `Save marks for ${report.valid} student(s)`}
            </button>
          ) : (
            <Alert kind="success">
              Saved marks for {report.saved} student(s). They stay private until the school publishes them.
              {report.total - report.valid > 0 ? ` ${report.total - report.valid} row(s) with problems were skipped.` : ''}
            </Alert>
          )}
          {report.errors.length > 0 && <IssueTable issues={report.errors} kind="error" />}
          {report.dryRun && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Student</th>
                    <th>Total</th>
                    <th>Grade</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>
                        {r.fullName || '—'}
                        <div className="muted">{r.admissionNo}</div>
                      </td>
                      <td>{r.total ?? '—'}</td>
                      <td>{r.grade ?? (r.total !== null ? <span className="muted">incomplete</span> : '—')}</td>
                      <td>
                        {!r.ok ? (
                          <span className="badge danger">Skipped</span>
                        ) : r.hasExisting ? (
                          <span className="badge warn">Replaces marks</span>
                        ) : (
                          <span className="badge ok">Ready</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

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
            ? `Marks per assessment: ${components.map((c) => `${shortLabel(c)} /${c.weight}`).join(' · ')}. Graded on the school's scale (A1 80–100 … F9 0–39). Marks can be entered through the semester; only complete results can be published.`
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

      {ready && <ScoreSheet termId={termId} classId={pick.classId} subjectId={pick.subjectId} onSaved={() => void sheet.reload()} />}

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
                          {summary.complete && scale.data ? gradeFor(summary.total, scale.data.bands).grade : ''}
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
