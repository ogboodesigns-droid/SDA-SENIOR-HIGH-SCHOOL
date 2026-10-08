'use client';

import { useEffect, useState } from 'react';
import { WEEKDAY_LABELS, type SubjectWithTeacher, type TermSummary, type TimetableSlot } from '@sda-shs/shared';
import { api, useApi } from '@/lib/api';
import { Alert, blankToNull, Card, Empty, Field, PageHeader, useSubmit } from '@/components/ui';

const SCHOOL_DAYS = [1, 2, 3, 4, 5];

export default function TimetablePage() {
  const terms = useApi<TermSummary[]>('/terms');
  const classes = useApi<{ id: string; name: string }[]>('/classes');
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  useEffect(() => {
    if (!termId && terms.data?.length) setTermId((terms.data.find((t) => t.isCurrent) ?? terms.data[0]).id);
  }, [terms.data, termId]);

  const slots = useApi<TimetableSlot[]>(classId && termId ? `/timetable/class/${classId}?termId=${termId}` : null);
  const subjects = useApi<SubjectWithTeacher[]>(classId ? `/classes/${classId}/subjects` : null);

  const add = useSubmit(async (v) => {
    await api('/timetable', {
      method: 'POST',
      body: { termId, classId, subjectId: v.subjectId, dayOfWeek: Number(v.dayOfWeek), startsAt: v.startsAt, endsAt: v.endsAt, room: blankToNull(v.room) },
    });
    await slots.reload();
  });

  return (
    <>
      <PageHeader title="Timetable" description="Build each class's weekly timetable. Class and teacher clashes are refused." />
      <Card>
        <div className="row">
          <Field label="Term">
            <select value={termId} onChange={(e) => setTermId(e.target.value)}>
              {terms.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.academicYearName} — {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Class">
            <select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Choose a class</option>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {!terms.data?.length && <Alert kind="info">Create a term under Classes &amp; subjects first.</Alert>}
      </Card>

      {classId && termId && (
        <>
          <Card title="Add a lesson">
            <form className="row" onSubmit={add.onSubmit}>
              <select name="dayOfWeek" aria-label="Day" style={{ maxWidth: 150 }}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAY_LABELS[d]}
                  </option>
                ))}
              </select>
              <input name="startsAt" type="time" required aria-label="Starts" style={{ maxWidth: 130 }} />
              <input name="endsAt" type="time" required aria-label="Ends" style={{ maxWidth: 130 }} />
              <select name="subjectId" required aria-label="Subject" style={{ maxWidth: 220 }}>
                {subjects.data?.map((s) => (
                  <option key={s.subjectId} value={s.subjectId}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input name="room" placeholder="Room (optional)" aria-label="Room" style={{ maxWidth: 160 }} />
              <button disabled={add.busy}>Add</button>
            </form>
            {!subjects.data?.length && <p className="field-hint">Assign subjects to this class first.</p>}
            <Alert>{add.error}</Alert>
          </Card>

          <div className="grid">
            {[...SCHOOL_DAYS, ...(slots.data?.some((s) => s.dayOfWeek > 5) ? [6, 7] : [])].map((day) => {
              const daySlots = slots.data?.filter((s) => s.dayOfWeek === day) ?? [];
              return (
                <Card key={day} title={WEEKDAY_LABELS[day]}>
                  {daySlots.length ? (
                    <div className="stack">
                      {daySlots.map((s) => (
                        <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
                          <div>
                            <strong>
                              {s.startsAt}–{s.endsAt}
                            </strong>{' '}
                            {s.subjectName}
                            <div className="muted">
                              {s.teacherName ?? 'No teacher'}
                              {s.room ? ` · ${s.room}` : ''}
                            </div>
                          </div>
                          <button className="secondary" aria-label="Remove lesson" onClick={() => api(`/timetable/${s.id}`, { method: 'DELETE' }).then(slots.reload)}>
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty>No lessons</Empty>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
