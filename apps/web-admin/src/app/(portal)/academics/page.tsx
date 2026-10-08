'use client';

import { useState } from 'react';
import type { Paginated, SubjectWithTeacher, TermSummary, UserListItem } from '@sda-shs/shared';
import { api, formatDate, useApi } from '@/lib/api';
import { Alert, blankToNull, Card, Empty, Field, PageHeader, useSubmit } from '@/components/ui';

interface Year { id: string; name: string; startsOn: string; endsOn: string }
interface Programme { id: string; name: string }
interface ClassRow { id: string; name: string; form: number; programmeId: string; programmeName: string; formMasterId: string | null; formMasterName: string | null }
interface Subject { id: string; code: string; name: string; isCore: boolean }

function useTeachers() {
  return useApi<Paginated<UserListItem>>('/users?role=teacher&pageSize=100');
}

function TermsCard() {
  const years = useApi<Year[]>('/academic-years');
  const terms = useApi<TermSummary[]>('/terms');
  const addYear = useSubmit(async (v, form) => {
    await api('/academic-years', { method: 'POST', body: v });
    form.reset();
    await years.reload();
  });
  const addTerm = useSubmit(async (v, form) => {
    await api('/terms', { method: 'POST', body: { ...v, isCurrent: v.isCurrent === 'on' } });
    form.reset();
    await terms.reload();
  });

  return (
    <Card title="Academic years & terms">
      <form className="row" onSubmit={addYear.onSubmit}>
        <input name="name" placeholder="2026/2027" required style={{ maxWidth: 140 }} aria-label="Year name" />
        <input name="startsOn" type="date" required style={{ maxWidth: 170 }} aria-label="Starts" />
        <input name="endsOn" type="date" required style={{ maxWidth: 170 }} aria-label="Ends" />
        <button disabled={addYear.busy}>Add year</button>
      </form>
      <Alert>{addYear.error}</Alert>

      <form className="row" onSubmit={addTerm.onSubmit} style={{ marginTop: 12 }}>
        <select name="academicYearId" required style={{ maxWidth: 160 }} aria-label="Academic year">
          {years.data?.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
        </select>
        <input name="name" placeholder="First Semester" required style={{ maxWidth: 180 }} aria-label="Term name" />
        <input name="startsOn" type="date" required style={{ maxWidth: 170 }} aria-label="Starts" />
        <input name="endsOn" type="date" required style={{ maxWidth: 170 }} aria-label="Ends" />
        <label className="row">
          <input type="checkbox" name="isCurrent" /> Current
        </label>
        <button disabled={addTerm.busy}>Add term</button>
      </form>
      <Alert>{addTerm.error}</Alert>

      {terms.data?.length ? (
        <table style={{ marginTop: 12 }}>
          <tbody>
            {terms.data.map((t) => (
              <tr key={t.id}>
                <td>{t.academicYearName}</td>
                <td>{t.name}</td>
                <td>
                  {formatDate(t.startsOn)} – {formatDate(t.endsOn)}
                </td>
                <td>
                  {t.isCurrent ? (
                    <span className="badge ok">Current</span>
                  ) : (
                    <button className="secondary" onClick={() => api(`/terms/${t.id}/make-current`, { method: 'POST' }).then(terms.reload)}>
                      Make current
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>No terms yet.</Empty>
      )}
    </Card>
  );
}

function ClassesCard({ onChange }: { onChange: () => void }) {
  const programmes = useApi<Programme[]>('/programmes');
  const classes = useApi<ClassRow[]>('/classes');
  const teachers = useTeachers();
  const addProgramme = useSubmit(async (v, form) => {
    await api('/programmes', { method: 'POST', body: v });
    form.reset();
    await programmes.reload();
  });
  const addClass = useSubmit(async (v, form) => {
    await api('/classes', { method: 'POST', body: { name: v.name, form: Number(v.form), programmeId: v.programmeId, formMasterId: blankToNull(v.formMasterId) } });
    form.reset();
    await classes.reload();
    onChange();
  });

  return (
    <Card title="Programmes & classes">
      <form className="row" onSubmit={addProgramme.onSubmit}>
        <input name="name" placeholder="Programme, e.g. General Science" required style={{ maxWidth: 300 }} aria-label="Programme name" />
        <button disabled={addProgramme.busy}>Add programme</button>
        <span className="muted">{programmes.data?.map((p) => p.name).join(' · ')}</span>
      </form>
      <Alert>{addProgramme.error}</Alert>

      <form className="row" onSubmit={addClass.onSubmit} style={{ marginTop: 12 }}>
        <input name="name" placeholder="Class name, e.g. 2 Science A" required style={{ maxWidth: 200 }} aria-label="Class name" />
        <select name="form" required style={{ maxWidth: 110 }} aria-label="Form">
          <option value="1">SHS 1</option>
          <option value="2">SHS 2</option>
          <option value="3">SHS 3</option>
        </select>
        <select name="programmeId" required style={{ maxWidth: 220 }} aria-label="Programme">
          {programmes.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select name="formMasterId" style={{ maxWidth: 220 }} aria-label="Form master/mistress" defaultValue="">
          <option value="">No form master yet</option>
          {teachers.data?.items.map((t) => (
            <option key={t.id} value={t.id}>
              {t.fullName}
            </option>
          ))}
        </select>
        <button disabled={addClass.busy}>Add class</button>
      </form>
      <Alert>{addClass.error}</Alert>

      {classes.data?.length ? (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Class</th>
              <th>Form</th>
              <th>Programme</th>
              <th>Form master/mistress</th>
            </tr>
          </thead>
          <tbody>
            {classes.data.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>SHS {c.form}</td>
                <td>{c.programmeName}</td>
                <td>
                  <select
                    defaultValue={c.formMasterId ?? ''}
                    aria-label={`Form master for ${c.name}`}
                    onChange={(e) => api(`/classes/${c.id}`, { method: 'PATCH', body: { formMasterId: e.target.value || null } }).then(classes.reload)}
                  >
                    <option value="">—</option>
                    {teachers.data?.items.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.fullName}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>No classes yet.</Empty>
      )}
    </Card>
  );
}

function SubjectsCard() {
  const subjects = useApi<Subject[]>('/subjects');
  const add = useSubmit(async (v, form) => {
    await api('/subjects', { method: 'POST', body: { code: v.code, name: v.name, isCore: v.isCore === 'on' } });
    form.reset();
    await subjects.reload();
  });
  return (
    <Card title="Subjects">
      <form className="row" onSubmit={add.onSubmit}>
        <input name="code" placeholder="Code" required style={{ maxWidth: 110 }} aria-label="Subject code" />
        <input name="name" placeholder="Subject name" required style={{ maxWidth: 260 }} aria-label="Subject name" />
        <label className="row">
          <input type="checkbox" name="isCore" /> Core
        </label>
        <button disabled={add.busy}>Add subject</button>
      </form>
      <Alert>{add.error}</Alert>
      <p className="muted">
        {subjects.data?.map((s) => `${s.name} (${s.code}${s.isCore ? ', core' : ''})`).join(' · ') || 'No subjects yet.'}
      </p>
    </Card>
  );
}

function ClassSubjectsCard({ version }: { version: number }) {
  const classes = useApi<ClassRow[]>(`/classes?v=${version}`);
  const subjects = useApi<Subject[]>('/subjects');
  const teachers = useTeachers();
  const [classId, setClassId] = useState('');
  const assigned = useApi<SubjectWithTeacher[]>(classId ? `/classes/${classId}/subjects` : null);
  const add = useSubmit(async (v) => {
    await api('/class-subjects', { method: 'PUT', body: { classId, subjectId: v.subjectId, teacherId: blankToNull(v.teacherId) } });
    await assigned.reload();
  });

  return (
    <Card title="Subjects taught in each class">
      <Field label="Class">
        <select value={classId} onChange={(e) => setClassId(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">Choose a class</option>
          {classes.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      {classId && (
        <>
          <table style={{ marginTop: 12 }}>
            <tbody>
              {assigned.data?.map((s) => (
                <tr key={s.classSubjectId}>
                  <td>{s.name}</td>
                  <td>{s.teacherName ?? <span className="badge warn">No teacher</span>}</td>
                  <td>
                    <button className="secondary" onClick={() => api(`/class-subjects/${s.classSubjectId}`, { method: 'DELETE' }).then(assigned.reload)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form className="row" onSubmit={add.onSubmit} style={{ marginTop: 12 }}>
            <select name="subjectId" required style={{ maxWidth: 240 }} aria-label="Subject">
              {subjects.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select name="teacherId" style={{ maxWidth: 240 }} aria-label="Teacher" defaultValue="">
              <option value="">No teacher yet</option>
              {teachers.data?.items.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
            </select>
            <button disabled={add.busy}>Assign</button>
          </form>
          <p className="field-hint">Assigning a subject that is already on the class changes its teacher.</p>
          <Alert>{add.error}</Alert>
        </>
      )}
    </Card>
  );
}

export default function AcademicsPage() {
  const [version, setVersion] = useState(0);
  return (
    <>
      <PageHeader title="Classes & subjects" description="Academic structure. Teachers can only see and manage the classes they are assigned to here." />
      <TermsCard />
      <ClassesCard onChange={() => setVersion((v) => v + 1)} />
      <SubjectsCard />
      <ClassSubjectsCard version={version} />
    </>
  );
}
