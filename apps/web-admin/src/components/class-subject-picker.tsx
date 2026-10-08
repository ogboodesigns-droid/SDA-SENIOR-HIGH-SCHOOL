'use client';

import { isLeadership, type SubjectWithTeacher } from '@sda-shs/shared';
import { useApi } from '@/lib/api';
import { useMe } from '@/lib/me';
import { Field } from './ui';

/** Class then subject; teachers see only the subjects they are assigned to teach. */
export function ClassSubjectPicker({
  classId,
  subjectId,
  onChange,
}: {
  classId: string;
  subjectId: string;
  onChange: (v: { classId: string; subjectId: string }) => void;
}) {
  const me = useMe();
  const classes = useApi<{ id: string; name: string }[]>('/classes');
  const subjects = useApi<SubjectWithTeacher[]>(classId ? `/classes/${classId}/subjects` : null);
  const mine = subjects.data?.filter((s) => isLeadership(me.role) || s.teacherId === me.id) ?? [];

  return (
    <>
      <Field label="Class">
        <select value={classId} onChange={(e) => onChange({ classId: e.target.value, subjectId: '' })}>
          <option value="">Choose a class</option>
          {classes.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Subject">
        <select value={subjectId} onChange={(e) => onChange({ classId, subjectId: e.target.value })} disabled={!classId}>
          <option value="">Choose a subject</option>
          {mine.map((s) => (
            <option key={s.subjectId} value={s.subjectId}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
