'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATUSES,
  isLeadership,
  type AttendanceOverviewRow,
  type AttendanceRegister,
  type AttendanceStatus,
  type AttendanceSummaryRow,
  type TermSummary,
} from '@sda-shs/shared';
import { api, errorMessage, formatDate, useApi } from '@/lib/api';
import { useMe } from '@/lib/me';
import { Alert, Card, Empty, Field, Loading, PageHeader } from '@/components/ui';

const today = () => new Date().toISOString().slice(0, 10);

function Register({ classId, date }: { classId: string; date: string }) {
  const reg = useApi<AttendanceRegister>(`/attendance/register?classId=${classId}&date=${date}`);
  const [marks, setMarks] = useState<Record<string, { status: AttendanceStatus | null; note: string }>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    // The register is keyed by class and date, so a new one starts with no message.
    setMarks(Object.fromEntries((reg.data?.students ?? []).map((s) => [s.studentId, { status: s.status, note: s.note ?? '' }])));
  }, [reg.data]);

  const counts = useMemo(() => {
    const c: Record<AttendanceStatus | 'unmarked', number> = { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 };
    for (const m of Object.values(marks)) c[m.status ?? 'unmarked'] += 1;
    return c;
  }, [marks]);

  const set = (id: string, patch: Partial<{ status: AttendanceStatus | null; note: string }>) => setMarks((m) => ({ ...m, [id]: { ...m[id], ...patch } }));

  async function save() {
    const entries = Object.entries(marks)
      .filter(([, m]) => m.status)
      .map(([studentId, m]) => ({ studentId, status: m.status, note: m.note || null }));
    if (counts.unmarked && !confirm(`${counts.unmarked} student(s) are not marked. Save the rest?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      reg.setData(await api<AttendanceRegister>('/attendance/register', { method: 'PUT', body: { classId, date, entries } }));
      setMessage({
        kind: 'success',
        text: `Register saved.${date === today() && counts.absent ? ' Parents/guardians of students newly marked absent have been notified.' : ''}`,
      });
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  if (reg.error) return <Alert>{reg.error}</Alert>;
  if (!reg.data) return <Loading />;
  if (!reg.data.students.length) return <Empty>No students in this class.</Empty>;

  return (
    <Card
      title={`${reg.data.className} — ${formatDate(date)}`}
      actions={
        <div className="row">
          <button
            className="secondary"
            onClick={() => setMarks((m) => Object.fromEntries(Object.entries(m).map(([id, v]) => [id, { ...v, status: v.status ?? 'present' }])))}
          >
            Mark the rest present
          </button>
          <button onClick={save} disabled={busy || counts.unmarked === reg.data.students.length}>
            {busy ? 'Saving…' : 'Save register'}
          </button>
        </div>
      }
    >
      <p className="muted">
        {reg.data.taken ? `Taken by ${reg.data.takenBy}. Changes are saved over the earlier marks.` : 'Not taken yet.'}{' '}
        <span className="badge ok">{counts.present} present</span> <span className="badge warn">{counts.late} late</span>{' '}
        <span className="badge danger">{counts.absent} absent</span> <span className="badge">{counts.excused} excused</span>
        {counts.unmarked > 0 && <> · {counts.unmarked} not marked</>}
      </p>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Mark</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {reg.data.students.map((s) => {
              const m = marks[s.studentId] ?? { status: null, note: '' };
              return (
                <tr key={s.studentId}>
                  <td>
                    {s.fullName}
                    <div className="muted">
                      {s.groupName} · {s.studentNumber}
                    </div>
                  </td>
                  <td>
                    <div className="att-marks" role="radiogroup" aria-label={`Mark for ${s.fullName}`}>
                      {ATTENDANCE_STATUSES.map((st) => (
                        <button
                          key={st}
                          type="button"
                          role="radio"
                          aria-checked={m.status === st}
                          className={`att-mark att-${st}${m.status === st ? ' on' : ''}`}
                          onClick={() => set(s.studentId, { status: st })}
                        >
                          {ATTENDANCE_LABELS[st]}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>
                    <input
                      value={m.note}
                      onChange={(e) => set(s.studentId, { note: e.target.value })}
                      maxLength={200}
                      placeholder={m.status === 'excused' ? 'Reason, e.g. sick bay' : ''}
                      aria-label={`Note for ${s.fullName}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Summary({ classId, termId }: { classId: string; termId: string }) {
  const rows = useApi<AttendanceSummaryRow[]>(`/attendance/summary?classId=${classId}&termId=${termId}`);
  if (rows.error) return <Alert>{rows.error}</Alert>;
  if (!rows.data) return <Loading />;
  return (
    <Card title="Semester summary">
      {!rows.data.length ? (
        <Empty>No students in this class.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Present</th>
                <th>Late</th>
                <th>Absent</th>
                <th>Excused</th>
                <th>Days</th>
                <th>Attendance</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((r) => (
                <tr key={r.studentId}>
                  <td>
                    {r.fullName}
                    <div className="muted">{r.studentNumber}</div>
                  </td>
                  <td>{r.present}</td>
                  <td>{r.late}</td>
                  <td>{r.absent}</td>
                  <td>{r.excused}</td>
                  <td>{r.days}</td>
                  <td>
                    {r.percentage === null ? (
                      '—'
                    ) : (
                      <span className={`badge ${r.percentage >= 90 ? 'ok' : r.percentage >= 75 ? 'warn' : 'danger'}`}>{r.percentage}%</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Overview({ date, onOpen }: { date: string; onOpen: (classId: string) => void }) {
  const rows = useApi<AttendanceOverviewRow[]>(`/attendance/overview?date=${date}`);
  if (!rows.data) return rows.error ? <Alert>{rows.error}</Alert> : <Loading />;
  const done = rows.data.filter((r) => r.marked >= r.students).length;
  return (
    <Card title={`Registers on ${formatDate(date)}: ${done} of ${rows.data.length} classes taken`}>
      {!rows.data.length ? (
        <Empty>No classes have students yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Class</th>
                <th>Marked</th>
                <th>Absent</th>
                <th>Late</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.data.map((r) => (
                <tr key={r.classId}>
                  <td>{r.className}</td>
                  <td>
                    <span className={`badge ${r.marked >= r.students ? 'ok' : r.marked ? 'warn' : 'danger'}`}>
                      {r.marked} / {r.students}
                    </span>
                  </td>
                  <td>{r.absent}</td>
                  <td>{r.late}</td>
                  <td>
                    <button className="secondary" onClick={() => onOpen(r.classId)}>
                      Open register
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function AttendancePage() {
  const me = useMe();
  const leader = isLeadership(me.role);
  const classes = useApi<{ id: string; name: string; isFormClass: boolean }[]>('/attendance/classes');
  const terms = useApi<TermSummary[]>('/terms');
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(today());
  const [view, setView] = useState<'register' | 'summary'>('register');
  const [termId, setTermId] = useState('');

  useEffect(() => {
    // Form masters start on their own class.
    const own = classes.data?.find((c) => c.isFormClass);
    if (!classId && own) setClassId(own.id);
  }, [classes.data, classId]);
  useEffect(() => {
    if (!termId && terms.data?.length) setTermId((terms.data.find((t) => t.isCurrent) ?? terms.data[0]).id);
  }, [terms.data, termId]);

  return (
    <>
      <PageHeader
        title="Attendance"
        description="The daily class register. Late counts as present; excused is an approved absence. Parents/guardians are notified the same day when a child is marked absent."
      />
      <Card>
        <div className="grid">
          <Field label="Class">
            <select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">{leader ? 'All classes (overview)' : 'Choose a class'}</option>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isFormClass ? ' (form class)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="View">
            <select value={view} onChange={(e) => setView(e.target.value as 'register' | 'summary')} disabled={!classId}>
              <option value="register">Register for a day</option>
              <option value="summary">Semester summary</option>
            </select>
          </Field>
          {view === 'register' || !classId ? (
            <Field label="Date">
              <input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
          ) : (
            <Field label="Semester">
              <select value={termId} onChange={(e) => setTermId(e.target.value)}>
                {terms.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.academicYearName} — {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {classes.data && !classes.data.length && <Alert kind="info">You don&apos;t teach any class yet, so there is no register for you to take.</Alert>}
      </Card>

      {!classId && leader && (
        <Overview
          date={date}
          onOpen={(id) => {
            setClassId(id);
            setView('register');
          }}
        />
      )}
      {classId && view === 'register' && <Register key={`${classId}:${date}`} classId={classId} date={date} />}
      {classId && view === 'summary' && termId && <Summary key={`${classId}:${termId}`} classId={classId} termId={termId} />}
    </>
  );
}
