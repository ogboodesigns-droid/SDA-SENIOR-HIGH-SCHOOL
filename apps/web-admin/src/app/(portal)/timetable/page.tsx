'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  activityAt,
  schoolClock,
  WEEKDAY_LABELS,
  type BellSchedule,
  type SubjectWithTeacher,
  type TermSummary,
  type TimetableSlot,
} from '@sda-shs/shared';
import { api, errorMessage, useApi } from '@/lib/api';
import { Alert, Card, Empty, Field, Loading, PageHeader, useSubmit } from '@/components/ui';

interface ClassRow {
  id: string;
  name: string;
  formMasterName: string | null;
}

const overlaps = (s: TimetableSlot, startsAt: string, endsAt: string) => s.startsAt < endsAt && s.endsAt > startsAt;

function AddLesson({
  subjects,
  taken,
  onAdd,
}: {
  subjects: SubjectWithTeacher[];
  taken: string[];
  onAdd: (subjectId: string) => void;
}) {
  const choices = subjects.filter((s) => !taken.includes(s.subjectId));
  if (!choices.length) return null;
  return (
    <select
      value=""
      aria-label="Add a lesson"
      onChange={(e) => e.target.value && onAdd(e.target.value)}
      style={{ fontSize: '.8rem', padding: '2px 4px', marginTop: 4, color: 'var(--muted)' }}
    >
      <option value="">{taken.length ? '+ split with…' : '+ add lesson'}</option>
      {choices.map((s) => (
        <option key={s.subjectId} value={s.subjectId}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

function SchoolDayEditor({ schedule, onSaved }: { schedule: BellSchedule; onSaved: () => void }) {
  const [draft, setDraft] = useState(schedule);
  useEffect(() => setDraft(schedule), [schedule]);
  const save = useSubmit(async () => {
    await api('/school/bell-schedule', { method: 'PUT', body: draft });
    onSaved();
    return 'School day saved.';
  });
  const setPeriod = (i: number, patch: Partial<BellSchedule['periods'][number]>) =>
    setDraft({ ...draft, periods: draft.periods.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setActivity = (i: number, patch: Partial<BellSchedule['activities'][number]>) =>
    setDraft({ ...draft, activities: draft.activities.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  return (
    <form className="stack" onSubmit={save.onSubmit}>
      <table>
        <thead>
          <tr>
            <th>Period</th>
            <th>Starts</th>
            <th>Ends</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          {draft.periods.map((p, i) => (
            <tr key={p.key}>
              <td>
                <input value={p.label} onChange={(e) => setPeriod(i, { label: e.target.value })} aria-label="Period name" style={{ maxWidth: 180 }} />
              </td>
              <td>
                <input type="time" value={p.startsAt} onChange={(e) => setPeriod(i, { startsAt: e.target.value })} aria-label="Starts" />
              </td>
              <td>
                <input type="time" value={p.endsAt} onChange={(e) => setPeriod(i, { endsAt: e.target.value })} aria-label="Ends" />
              </td>
              <td>{p.kind === 'lesson' ? 'Lesson' : 'Break'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>School-wide activities</h2>
      <table>
        <tbody>
          {draft.activities.map((a, i) => (
            <tr key={i}>
              <td>
                <select value={a.day} onChange={(e) => setActivity(i, { day: Number(e.target.value) })} aria-label="Day">
                  {draft.days.map((d) => (
                    <option key={d} value={d}>
                      {WEEKDAY_LABELS[d]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input value={a.label} onChange={(e) => setActivity(i, { label: e.target.value })} aria-label="Activity" />
              </td>
              <td>
                <input type="time" value={a.startsAt} onChange={(e) => setActivity(i, { startsAt: e.target.value })} aria-label="Starts" />
              </td>
              <td>
                <input type="time" value={a.endsAt} onChange={(e) => setActivity(i, { endsAt: e.target.value })} aria-label="Ends" />
              </td>
              <td>
                <button type="button" className="secondary" onClick={() => setDraft({ ...draft, activities: draft.activities.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button
          type="button"
          className="secondary"
          onClick={() => setDraft({ ...draft, activities: [...draft.activities, { day: 5, label: '', startsAt: '14:00', endsAt: '15:00' }] })}
        >
          Add activity
        </button>
        <button disabled={save.busy}>Save school day</button>
      </div>
      <Alert>{save.error}</Alert>
      <Alert kind="success">{save.success}</Alert>
    </form>
  );
}

export default function TimetablePage() {
  const terms = useApi<TermSummary[]>('/terms');
  const classes = useApi<ClassRow[]>('/classes');
  const bell = useApi<BellSchedule>('/school/bell-schedule');
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [note, setNote] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [showDay, setShowDay] = useState(false);
  useEffect(() => {
    if (!termId && terms.data?.length) setTermId((terms.data.find((t) => t.isCurrent) ?? terms.data[0]).id);
  }, [terms.data, termId]);

  const slots = useApi<TimetableSlot[]>(classId && termId ? `/timetable/class/${classId}?termId=${termId}` : null);
  const subjects = useApi<SubjectWithTeacher[]>(classId ? `/classes/${classId}/subjects` : null);
  const cls = classes.data?.find((c) => c.id === classId);
  const term = terms.data?.find((t) => t.id === termId);

  async function add(day: number, startsAt: string, endsAt: string, subjectId: string) {
    setNote(null);
    try {
      const res = await api<{ id: string; warnings: string[] }>('/timetable', {
        method: 'POST',
        body: { termId, classId, subjectId, dayOfWeek: day, startsAt, endsAt },
      });
      if (res.warnings.length) setNote({ kind: 'info', text: `Added, but check: ${res.warnings.join('; ')}.` });
      await slots.reload();
    } catch (e) {
      setNote({ kind: 'error', text: errorMessage(e) });
    }
  }

  async function remove(id: string) {
    setNote(null);
    await api(`/timetable/${id}`, { method: 'DELETE' });
    await slots.reload();
  }

  // Periods per week for each subject, like the "(n/4)" on the printed timetable.
  const perWeek = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slots.data ?? []) m.set(s.subjectId, (m.get(s.subjectId) ?? 0) + 1);
    return m;
  }, [slots.data]);

  const schedule = bell.data;
  return (
    <>
      <PageHeader
        title="Timetable"
        description="Pick a lesson for each period. Two electives for different option groups can share a period (e.g. GEOGRAPHY / COMPUTING); you'll be warned if an option takes both."
        actions={
          <button className="secondary" onClick={() => setShowDay(!showDay)}>
            {showDay ? 'Hide school day' : 'School day & breaks'}
          </button>
        }
      />
      {showDay && schedule && (
        <Card title="School day">
          <SchoolDayEditor schedule={schedule} onSaved={bell.reload} />
        </Card>
      )}
      <Card>
        <div className="row">
          <Field label="Semester">
            <select value={termId} onChange={(e) => setTermId(e.target.value)}>
              {terms.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.academicYearName} — {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Class">
            <select value={classId} onChange={(e) => (setClassId(e.target.value), setNote(null))}>
              <option value="">Choose a class</option>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {!terms.data?.length && <Alert kind="info">Create a semester under Classes &amp; subjects first.</Alert>}
      </Card>

      {classId && termId && schedule && (
        <Card
          title={`${term?.academicYearName ?? ''} timetable — ${cls?.name ?? ''}`}
          actions={<span className="muted">Form parent: {cls?.formMasterName ?? '—'}</span>}
        >
          {note && <Alert kind={note.kind}>{note.text}</Alert>}
          {slots.loading || subjects.loading ? (
            <Loading />
          ) : (
            <div className="table-wrap">
              <table className="timetable">
                <thead>
                  <tr>
                    <th>Period &amp; time</th>
                    {schedule.days.map((d) => (
                      <th key={d}>{WEEKDAY_LABELS[d]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {schedule.periods.map((p) => (
                    <tr key={p.key} className={p.kind === 'break' ? 'tt-break' : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {p.kind === 'lesson' ? <strong>{p.label} </strong> : null}
                        {p.kind === 'lesson' ? `(${schoolClock(p.startsAt)} – ${schoolClock(p.endsAt)})` : `${schoolClock(p.startsAt)} – ${schoolClock(p.endsAt)}`}
                      </td>
                      {schedule.days.map((d) => {
                        if (p.kind === 'break') return <td key={d}>{p.label}</td>;
                        const act = activityAt(schedule, d, p.startsAt, p.endsAt);
                        if (act) {
                          return (
                            <td key={d} className="tt-activity">
                              {act.label}
                            </td>
                          );
                        }
                        const here = (slots.data?.filter((s) => s.dayOfWeek === d && overlaps(s, p.startsAt, p.endsAt)) ?? []).sort((a, b) => a.subjectName.localeCompare(b.subjectName));
                        return (
                          <td key={d}>
                            {here.length > 0 && (
                              <div className="tt-lesson">
                                <div className="tt-subject">
                                  {here.map((s, i) => (
                                    <Fragment key={s.id}>
                                      {i > 0 && ' / '}
                                      <span>
                                        {s.subjectName}
                                        <button className="tt-remove" aria-label={`Remove ${s.subjectName}`} onClick={() => remove(s.id)}>
                                          ×
                                        </button>
                                      </span>
                                    </Fragment>
                                  ))}
                                  {here.length > 1 && <span className="muted"> (Split)</span>}
                                </div>
                                <div className="muted">{here.map((s) => s.teacherName ?? 'No teacher').join(' / ')}</div>
                              </div>
                            )}
                            <AddLesson subjects={subjects.data ?? []} taken={here.map((s) => s.subjectId)} onAdd={(id) => add(d, p.startsAt, p.endsAt, id)} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {classId && termId && subjects.data && (
        <Card title="Periods per week">
          {!subjects.data.length ? (
            <Empty>No subjects on this class yet. Add them under Classes &amp; subjects.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Teacher</th>
                  <th>Periods</th>
                </tr>
              </thead>
              <tbody>
                {subjects.data.map((s) => (
                  <tr key={s.subjectId}>
                    <td>{s.name}</td>
                    <td>{s.teacherName ?? <span className="badge warn">No teacher</span>}</td>
                    <td>{perWeek.get(s.subjectId) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}
