'use client';

import { useState } from 'react';
import type { Paginated, SubjectWithTeacher, TermSummary, UserListItem } from '@sda-shs/shared';
import { api, errorMessage, formatDate, useApi } from '@/lib/api';
import { Alert, blankToNull, Card, Empty, Field, Loading, PageHeader, useSubmit } from '@/components/ui';

interface Year { id: string; name: string; startsOn: string; endsOn: string }
interface Programme { id: string; name: string; code: string | null }
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

/**
 * The school's programmes and how many streams each form has. Codes and
 * stream counts are starting suggestions only: Science and Business use SCI
 * and BUS (as in "1 SCI 1"); check the others and fill in any blanks.
 */
const SUGGESTED_PROGRAMMES = [
  { name: 'Science', code: 'SCI', streams: '' },
  { name: 'Business', code: 'BUS', streams: '' },
  { name: 'Home Economics', code: 'HE', streams: '3' },
  { name: 'Visual Arts', code: 'VA', streams: '2' },
  { name: 'Languages', code: 'LANG', streams: '' },
  { name: 'General Arts', code: 'GA', streams: '6' },
];

function ProgrammeRow({
  initial,
  existing,
  onDone,
}: {
  initial: { name: string; code: string; streams: string };
  existing?: Programme;
  onDone: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? initial.name);
  const [code, setCode] = useState(existing?.code ?? initial.code);
  const [streams, setStreams] = useState(initial.streams);
  const [forms, setForms] = useState([1, 2, 3]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const preview = code && streams ? `${forms[0] ?? 1} ${code.toUpperCase()} 1 … ${forms[forms.length - 1] ?? 3} ${code.toUpperCase()} ${streams}` : '';

  async function create() {
    setBusy(true);
    setNote(null);
    try {
      let programme = existing;
      if (!programme) programme = await api<Programme>('/programmes', { method: 'POST', body: { name, code } });
      else if (programme.code !== code.toUpperCase() || programme.name !== name) {
        programme = await api<Programme>(`/programmes/${programme.id}`, { method: 'PATCH', body: { name, code } });
      }
      const res = await api<{ created: string[]; skipped: number }>('/classes/bulk', {
        method: 'POST',
        body: { programmeId: programme.id, forms, streams: Number(streams) },
      });
      setNote({
        kind: 'success',
        text: res.created.length
          ? `Created ${res.created.length} classes${res.skipped ? ` (${res.skipped} already existed)` : ''}.`
          : 'All these classes already exist.',
      });
      onDone();
    } catch (e) {
      setNote({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Programme name" />
      </td>
      <td>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} style={{ maxWidth: 90 }} aria-label={`Code for ${name}`} />
      </td>
      <td>
        <input type="number" min={1} max={20} value={streams} onChange={(e) => setStreams(e.target.value)} style={{ maxWidth: 80 }} aria-label={`Classes per form for ${name}`} />
      </td>
      <td>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 12 }}>
          {[1, 2, 3].map((f) => (
            <label key={f} className="row" style={{ gap: 4 }}>
              <input
                type="checkbox"
                checked={forms.includes(f)}
                onChange={(e) => setForms(e.target.checked ? [...forms, f].sort() : forms.filter((x) => x !== f))}
              />
              {f}
            </label>
          ))}
        </div>
      </td>
      <td>
        <button className="secondary" style={{ whiteSpace: 'nowrap' }} onClick={create} disabled={busy || !name || !code || !streams || !forms.length}>
          {busy ? 'Creating…' : 'Create classes'}
        </button>
        {preview && !note && <div className="field-hint">{preview}</div>}
        {note && <div className={`field-hint`} style={{ color: note.kind === 'error' ? 'var(--danger)' : 'var(--ok)' }}>{note.text}</div>}
      </td>
    </tr>
  );
}

function ProgrammesCard({ onChange }: { onChange: () => void }) {
  const programmes = useApi<Programme[]>('/programmes');
  const [extra, setExtra] = useState(0);
  if (!programmes.data) return <Card title="Programmes & class sets"><Loading /></Card>;

  const known = new Map(programmes.data.map((p) => [p.name.toLowerCase(), p]));
  const suggestedNames = new Set(SUGGESTED_PROGRAMMES.map((p) => p.name.toLowerCase()));
  const others = programmes.data.filter((p) => !suggestedNames.has(p.name.toLowerCase()));

  return (
    <Card title="Programmes & class sets">
      <p className="muted" style={{ marginTop: 0 }}>
        Classes are named <strong>form, programme code, class number</strong>: 1 SCI 1, 1 SCI 2 … 3 SCI 2. Enter how many classes each form has and
        create them all at once. Running it again only adds classes that are missing, so you can increase the number later.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Programme</th>
              <th>Code</th>
              <th>Classes per form</th>
              <th>Forms</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {SUGGESTED_PROGRAMMES.map((p) => (
              <ProgrammeRow key={p.name} initial={p} existing={known.get(p.name.toLowerCase())} onDone={() => (programmes.reload(), onChange())} />
            ))}
            {others.map((p) => (
              <ProgrammeRow key={p.id} initial={{ name: p.name, code: p.code ?? '', streams: '' }} existing={p} onDone={() => (programmes.reload(), onChange())} />
            ))}
            {Array.from({ length: extra }, (_, i) => (
              <ProgrammeRow key={`new-${i}`} initial={{ name: '', code: '', streams: '' }} onDone={() => (programmes.reload(), onChange())} />
            ))}
          </tbody>
        </table>
      </div>
      <button className="secondary" onClick={() => setExtra(extra + 1)} style={{ marginTop: 10 }}>
        Add another programme
      </button>
    </Card>
  );
}

function ClassesCard({ version, onChange }: { version: number; onChange: () => void }) {
  const programmes = useApi<Programme[]>(`/programmes?v=${version}`);
  const classes = useApi<ClassRow[]>(`/classes?v=${version}`);
  const teachers = useTeachers();
  const addClass = useSubmit(async (v, form) => {
    await api('/classes', { method: 'POST', body: { name: v.name, form: Number(v.form), programmeId: v.programmeId, formMasterId: blankToNull(v.formMasterId) } });
    form.reset();
    await classes.reload();
    onChange();
  });

  return (
    <Card title={`Classes (${classes.data?.length ?? 0})`}>
      <p className="muted" style={{ marginTop: 0 }}>Add a single class, e.g. a new stream created mid-year.</p>
      <form className="row" onSubmit={addClass.onSubmit}>
        <input name="name" placeholder="Class name, e.g. 1 SCI 3" required style={{ maxWidth: 200 }} aria-label="Class name" />
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
        <div className="table-wrap">
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Class</th>
                <th>Programme</th>
                <th>Form master/mistress</th>
              </tr>
            </thead>
            <tbody>
              {classes.data.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
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
        </div>
      ) : (
        <Empty>No classes yet. Use “Create classes” above.</Empty>
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
      <ProgrammesCard onChange={() => setVersion((v) => v + 1)} />
      <ClassesCard version={version} onChange={() => setVersion((v) => v + 1)} />
      <SubjectsCard />
      <ClassSubjectsCard version={version} />
    </>
  );
}
