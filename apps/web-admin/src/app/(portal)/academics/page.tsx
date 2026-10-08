'use client';

import { useState } from 'react';
import type { Paginated, SubjectCombination, SubjectWithTeacher, TermSummary, UserListItem } from '@sda-shs/shared';
import { api, errorMessage, formatDate, useApi } from '@/lib/api';
import { Alert, blankToNull, Card, Empty, Field, Loading, PageHeader, useSubmit } from '@/components/ui';

interface Year { id: string; name: string; startsOn: string; endsOn: string }
interface Programme { id: string; name: string; code: string | null; label: string | null; spacedName: boolean }
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
    const semester = Number(v.semester) as 1 | 2;
    await api('/terms', {
      method: 'POST',
      body: { ...v, semester, name: semester === 1 ? 'First Semester' : 'Second Semester', isCurrent: v.isCurrent === 'on' },
    });
    form.reset();
    await terms.reload();
  });

  return (
    <Card title="Academic years & semesters">
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
        <select name="semester" style={{ maxWidth: 180 }} aria-label="Semester">
          <option value="1">First Semester</option>
          <option value="2">Second Semester</option>
        </select>
        <input name="startsOn" type="date" required style={{ maxWidth: 170 }} aria-label="Starts" />
        <input name="endsOn" type="date" required style={{ maxWidth: 170 }} aria-label="Ends" />
        <label className="row">
          <input type="checkbox" name="isCurrent" /> Current
        </label>
        <button disabled={addTerm.busy}>Add semester</button>
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
        <Empty>No semesters yet.</Empty>
      )}
    </Card>
  );
}

function ProgrammeRow({
  initial,
  existing,
  onDone,
}: {
  initial: { name: string; code: string; label: string; streams: string };
  existing?: Programme;
  onDone: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? initial.name);
  const [code, setCode] = useState(existing?.code ?? initial.code);
  const [label, setLabel] = useState(existing?.label ?? initial.label);
  const [streams, setStreams] = useState(initial.streams);
  const [forms, setForms] = useState([1, 2, 3]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const gap = existing?.spacedName ? ' ' : '';
  const preview = code && streams ? `${forms[0] ?? 1}${gap}${code.toUpperCase()} 1 … ${forms[forms.length - 1] ?? 3}${gap}${code.toUpperCase()} ${streams}` : '';

  async function create() {
    setBusy(true);
    setNote(null);
    try {
      let programme = existing;
      if (!programme) programme = await api<Programme>('/programmes', { method: 'POST', body: { name, code, label: label || null } });
      else if (programme.code !== code.toUpperCase() || programme.name !== name || (programme.label ?? '') !== label) {
        programme = await api<Programme>(`/programmes/${programme.id}`, { method: 'PATCH', body: { name, code, label: label || null } });
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
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} style={{ maxWidth: 80 }} aria-label={`Code for ${name}`} />
      </td>
      <td>
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={20} style={{ maxWidth: 110 }} aria-label={`Class label for ${name}`} />
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
  const combos = useApi<SubjectCombination[]>('/combinations');
  const [extra, setExtra] = useState(0);
  if (!programmes.data || !combos.data) {
    return (
      <Card title="Learning areas & classes">
        <Loading />
      </Card>
    );
  }
  // Suggest as many classes per form as the subject combination list has class numbers.
  const streamsFor = (programmeId: string) => {
    const max = Math.max(0, ...combos.data!.filter((c) => c.programmeId === programmeId).map((c) => c.stream));
    return max ? String(max) : '';
  };
  const done = () => (programmes.reload(), onChange());

  return (
    <Card title="Learning areas & classes">
      <p className="muted" style={{ marginTop: 0 }}>
        Classes are named <strong>form, code, class number</strong> as on the subject combination list: 1BUS 1, 2G/A 3, 3VIS 2, 1 LANG 2. The option letter
        (the A in 1BUS 1A) comes from each student&apos;s option. Classes per form starts from the number of classes on the combination list; change
        it and tick the forms to create a different number for SHS 2 and 3. Running it again only adds missing classes.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Learning area</th>
              <th>Code</th>
              <th>Label</th>
              <th>Classes per form</th>
              <th>Forms</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {programmes.data.map((p) => (
              <ProgrammeRow key={p.id} initial={{ name: p.name, code: p.code ?? '', label: p.label ?? '', streams: streamsFor(p.id) }} existing={p} onDone={done} />
            ))}
            {Array.from({ length: extra }, (_, i) => (
              <ProgrammeRow key={`new-${i}`} initial={{ name: '', code: '', label: '', streams: '' }} onDone={done} />
            ))}
          </tbody>
        </table>
      </div>
      <button className="secondary" onClick={() => setExtra(extra + 1)} style={{ marginTop: 10 }}>
        Add another learning area
      </button>
    </Card>
  );
}

/** The options from the subject combination list, per learning area. */
function OptionsCard() {
  const programmes = useApi<Programme[]>('/programmes');
  const subjects = useApi<Subject[]>('/subjects');
  const [programmeId, setProgrammeId] = useState('');
  const combos = useApi<SubjectCombination[]>(programmeId ? `/combinations?programmeId=${programmeId}` : null);
  const [picked, setPicked] = useState<string[]>([]);
  const programme = programmes.data?.find((p) => p.id === programmeId);

  const add = useSubmit(async (v, form) => {
    await api('/combinations', {
      method: 'POST',
      body: {
        programmeId,
        option: Number(v.option),
        stream: Number(v.stream),
        letter: v.letter ?? '',
        electiveSubjectIds: picked,
        mustDropOne: v.mustDropOne === 'on',
      },
    });
    form.reset();
    setPicked([]);
    await combos.reload();
    return 'Option added. Use “Fill from options” on the classes to add any new subjects.';
  });

  return (
    <Card title="Subject combinations (options)">
      <Field label="Learning area">
        <select value={programmeId} onChange={(e) => setProgrammeId(e.target.value)} style={{ maxWidth: 280 }}>
          <option value="">Choose a learning area</option>
          {programmes.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      {programmeId && (
        <>
          {!combos.data?.length ? (
            <Empty>No options yet.</Empty>
          ) : (
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Option</th>
                  <th>Class</th>
                  <th>Elective subjects</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {combos.data.map((c) => (
                  <tr key={c.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      Option {c.option}
                      {c.mustDropOne && <span title="Must drop one subject before SHS 3"> *</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{`1${programme?.spacedName ? ' ' : ''}${programme?.code ?? ''} ${c.stream}${c.letter}`}</td>
                    <td>{c.electives.map((e) => e.name).join(', ')}</td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => confirm(`Remove option ${c.option}? Students on it keep their class.`) && api(`/combinations/${c.id}`, { method: 'DELETE' }).then(combos.reload)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {combos.data?.some((c) => c.mustDropOne) && <p className="field-hint">* Students on this option must drop one subject before SHS 3.</p>}

          <form className="stack" onSubmit={add.onSubmit} style={{ marginTop: 14 }}>
            <div className="row">
              <input name="option" type="number" min={1} placeholder="Option no." required style={{ maxWidth: 120 }} aria-label="Option number" />
              <input name="stream" type="number" min={1} placeholder="Class no." required style={{ maxWidth: 120 }} aria-label="Class number" />
              <input name="letter" placeholder="Letter (A, B…)" maxLength={2} style={{ maxWidth: 130 }} aria-label="Letter" />
              <label className="row" style={{ gap: 4 }}>
                <input type="checkbox" name="mustDropOne" /> Must drop one before SHS 3
              </label>
            </div>
            <div className="row" style={{ gap: 14 }}>
              {subjects.data
                ?.filter((s) => !s.isCore)
                .map((s) => (
                  <label key={s.id} className="row" style={{ gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={picked.includes(s.id)}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))}
                    />
                    {s.name}
                  </label>
                ))}
            </div>
            <Alert>{add.error}</Alert>
            <Alert kind="success">{add.success}</Alert>
            <div>
              <button disabled={add.busy || !picked.length}>Add option</button>
            </div>
          </form>
        </>
      )}
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
        <input name="name" placeholder="Class name, e.g. 1BUS 3" required style={{ maxWidth: 200 }} aria-label="Class name" />
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
        <select name="formMasterId" style={{ maxWidth: 220 }} aria-label="Form parent" defaultValue="">
          <option value="">No form parent yet</option>
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
                <th>Form parent</th>
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
                      aria-label={`Form parent for ${c.name}`}
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
  const [note, setNote] = useState<string | null>(null);
  const assigned = useApi<SubjectWithTeacher[]>(classId ? `/classes/${classId}/subjects` : null);
  const add = useSubmit(async (v) => {
    await api('/class-subjects', { method: 'PUT', body: { classId, subjectId: v.subjectId, teacherId: blankToNull(v.teacherId) } });
    await assigned.reload();
  });

  return (
    <Card title="Subjects and teachers for each class">
      <Field label="Class">
        <select value={classId} onChange={(e) => (setClassId(e.target.value), setNote(null))} style={{ maxWidth: 260 }}>
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
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="secondary"
              onClick={() =>
                api<{ added: number }>(`/classes/${classId}/sync-subjects`, { method: 'POST' }).then((r) => {
                  setNote(r.added ? `Added ${r.added} subject(s) from the class's options.` : 'The class already has every subject its options need.');
                  return assigned.reload();
                })
              }
            >
              Fill from options
            </button>
            {note && <span className="muted">{note}</span>}
          </div>
          <table style={{ marginTop: 12 }}>
            <tbody>
              {assigned.data?.map((s) => (
                <tr key={s.classSubjectId}>
                  <td>
                    {s.name} {s.isCore && <span className="badge">core</span>}
                  </td>
                  <td>
                    <select
                      value={s.teacherId ?? ''}
                      aria-label={`Teacher for ${s.name}`}
                      onChange={(e) =>
                        api('/class-subjects', { method: 'PUT', body: { classId, subjectId: s.subjectId, teacherId: e.target.value || null } }).then(assigned.reload)
                      }
                    >
                      <option value="">— No teacher yet —</option>
                      {teachers.data?.items.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.fullName}
                        </option>
                      ))}
                    </select>
                  </td>
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
          <p className="field-hint">Add a subject that isn&apos;t on the list, e.g. a new option.</p>
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
      <OptionsCard />
      <SubjectsCard />
      <ClassSubjectsCard version={version} />
    </>
  );
}
