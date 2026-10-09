'use client';

import { useEffect, useState } from 'react';
import type { AssessmentComponent, AssessmentSchemesInput, GradingScaleInput, SchoolProfile } from '@sda-shs/shared';
import { api, useApi } from '@/lib/api';
import { Alert, blankToNull, Card, Field, Loading, PageHeader, useSubmit } from '@/components/ui';

function ProfileForm({ profile, onSaved }: { profile: SchoolProfile; onSaved: () => void }) {
  const save = useSubmit(async (v) => {
    await api('/school', {
      method: 'PUT',
      body: {
        name: v.name,
        shortName: blankToNull(v.shortName),
        motto: blankToNull(v.motto),
        vision: blankToNull(v.vision),
        mission: blankToNull(v.mission),
        coreValues: v.coreValues.split('\n').map((s) => s.trim()).filter(Boolean),
        history: blankToNull(v.history),
        address: blankToNull(v.address),
        phone: blankToNull(v.phone),
        email: blankToNull(v.email),
        gpsAddress: blankToNull(v.gpsAddress),
        website: blankToNull(v.website),
        logoUrl: blankToNull(v.logoUrl),
      },
    });
    onSaved();
    return 'School profile saved. The app shows the new details straight away.';
  });

  return (
    <form className="stack" onSubmit={save.onSubmit}>
      <div className="grid">
        <Field label="Official school name">
          <input name="name" defaultValue={profile.name} required />
        </Field>
        <Field label="Short name">
          <input name="shortName" defaultValue={profile.shortName ?? ''} />
        </Field>
        <Field label="Motto">
          <input name="motto" defaultValue={profile.motto ?? ''} />
        </Field>
        <Field label="Phone">
          <input name="phone" defaultValue={profile.phone ?? ''} />
        </Field>
        <Field label="Email">
          <input name="email" type="email" defaultValue={profile.email ?? ''} />
        </Field>
        <Field label="GPS address" hint="Ghana Post digital address">
          <input name="gpsAddress" defaultValue={profile.gpsAddress ?? ''} placeholder="EN-135-1605" />
        </Field>
        <Field label="Website">
          <input name="website" type="url" defaultValue={profile.website ?? ''} />
        </Field>
        <Field label="Logo URL">
          <input name="logoUrl" type="url" defaultValue={profile.logoUrl ?? ''} />
        </Field>
      </div>
      <Field label="Address / location">
        <textarea name="address" defaultValue={profile.address ?? ''} style={{ minHeight: 60 }} />
      </Field>
      <Field label="Vision">
        <textarea name="vision" defaultValue={profile.vision ?? ''} />
      </Field>
      <Field label="Mission">
        <textarea name="mission" defaultValue={profile.mission ?? ''} />
      </Field>
      <Field label="Core values" hint="One per line">
        <textarea name="coreValues" defaultValue={profile.coreValues.join('\n')} />
      </Field>
      <Field label="History">
        <textarea name="history" defaultValue={profile.history ?? ''} style={{ minHeight: 200 }} />
      </Field>
      <Alert>{save.error}</Alert>
      <Alert kind="success">{save.success}</Alert>
      <div>
        <button disabled={save.busy}>Save profile</button>
      </div>
    </form>
  );
}

function GradingScale() {
  const scale = useApi<GradingScaleInput>('/school/grading-scale');
  const [draft, setDraft] = useState<GradingScaleInput | null>(null);
  useEffect(() => setDraft(scale.data ?? null), [scale.data]);
  const save = useSubmit(async () => {
    if (!draft) return;
    await api('/school/grading-scale', { method: 'PUT', body: draft });
    await scale.reload();
    return 'Grading scale saved. Results not yet published have been regraded; published results keep the grades already issued.';
  });
  if (!draft) return <Loading />;

  const setBand = (i: number, key: 'min' | 'grade' | 'points' | 'gpa' | 'remark', value: string) =>
    setDraft({ ...draft, bands: draft.bands.map((b, j) => (j === i ? { ...b, [key]: key === 'grade' || key === 'remark' ? value : Number(value) } : b)) });

  return (
    <form className="stack" onSubmit={save.onSubmit}>
      <Alert kind="info">
        The school&apos;s grading scale. Grade points (A1 = 1 … F9 = 9) give the aggregate of the best three core and three elective subjects; GPA points (A1 = 4.0
        … F9 = 0.0) give the semester and cumulative GPA on the transcript.
      </Alert>
      <table>
        <thead>
          <tr>
            <th>From (total ≥)</th>
            <th>Grade</th>
            <th>Points</th>
            <th>GPA</th>
            <th>Remark</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {draft.bands.map((b, i) => (
            <tr key={i}>
              <td>
                <input type="number" value={b.min} onChange={(e) => setBand(i, 'min', e.target.value)} aria-label="Minimum total" />
              </td>
              <td>
                <input value={b.grade} onChange={(e) => setBand(i, 'grade', e.target.value)} aria-label="Grade" />
              </td>
              <td>
                <input type="number" min={1} max={9} value={b.points} onChange={(e) => setBand(i, 'points', e.target.value)} aria-label="Grade points" />
              </td>
              <td>
                <input type="number" min={0} max={5} step={0.1} value={b.gpa} onChange={(e) => setBand(i, 'gpa', e.target.value)} aria-label="GPA points" />
              </td>
              <td>
                <input value={b.remark} onChange={(e) => setBand(i, 'remark', e.target.value)} aria-label="Remark" />
              </td>
              <td>
                <button type="button" className="secondary" onClick={() => setDraft({ ...draft, bands: draft.bands.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Field label="Transcript credits per subject passed" hint="Credits earned each semester for every subject graded above the lowest band (F9)">
        <input
          type="number"
          min={0}
          max={100}
          value={draft.creditsPerSubject}
          onChange={(e) => setDraft({ ...draft, creditsPerSubject: Number(e.target.value) })}
          style={{ maxWidth: 120 }}
        />
      </Field>
      <div className="row">
        <button type="button" className="secondary" onClick={() => setDraft({ ...draft, bands: [...draft.bands, { min: 0, grade: '', points: 9, gpa: 0, remark: '' }] })}>
          Add band
        </button>
        <button disabled={save.busy}>Save grading scale</button>
      </div>
      <Alert>{save.error}</Alert>
      <Alert kind="success">{save.success}</Alert>
    </form>
  );
}

function AssessmentSchemes() {
  const schemes = useApi<AssessmentSchemesInput>('/school/assessment-schemes');
  const [draft, setDraft] = useState<AssessmentSchemesInput | null>(null);
  useEffect(() => setDraft(schemes.data ?? null), [schemes.data]);
  const save = useSubmit(async () => {
    if (!draft) return;
    await api('/school/assessment-schemes', { method: 'PUT', body: draft });
    await schemes.reload();
    return 'Assessment scheme saved. It applies to marks entered from now on.';
  });
  if (!draft) return <Loading />;

  const update = (sem: '1' | '2', i: number, patch: Partial<AssessmentComponent>) =>
    setDraft({ ...draft, [sem]: draft[sem].map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <form className="stack" onSubmit={save.onSubmit}>
      <p className="muted" style={{ margin: 0 }}>
        Each component&apos;s weight is the mark teachers enter it out of. Weights must add up to 100 for each semester.
      </p>
      {(['1', '2'] as const).map((sem) => {
        const total = draft[sem].reduce((s, c) => s + c.weight, 0);
        return (
          <div key={sem} className="stack">
            <h2>
              Semester {sem}{' '}
              <span className={`badge ${total === 100 ? 'ok' : 'danger'}`}>total {total}%</span>
            </h2>
            <table>
              <thead>
                <tr>
                  <th>Mode of assessment</th>
                  <th>Weight</th>
                  <th>End-of-semester exam</th>
                </tr>
              </thead>
              <tbody>
                {draft[sem].map((c, i) => (
                  <tr key={c.key}>
                    <td>
                      <input value={c.label} onChange={(e) => update(sem, i, { label: e.target.value })} aria-label="Mode of assessment" />
                    </td>
                    <td>
                      <input type="number" min={1} max={100} value={c.weight} onChange={(e) => update(sem, i, { weight: Number(e.target.value) })} style={{ maxWidth: 90 }} aria-label="Weight" />
                    </td>
                    <td>
                      <input type="checkbox" checked={c.isExam} onChange={(e) => update(sem, i, { isExam: e.target.checked })} aria-label="Exam" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <Alert>{save.error}</Alert>
      <Alert kind="success">{save.success}</Alert>
      <div>
        <button disabled={save.busy}>Save assessment scheme</button>
      </div>
    </form>
  );
}

export default function SchoolPage() {
  const profile = useApi<SchoolProfile>('/school');
  return (
    <>
      <PageHeader title="School profile" description="Shown in the mobile app's About the School section. Only enter official, verified information." />
      <Card title="About the school">{profile.data ? <ProfileForm profile={profile.data} onSaved={profile.reload} /> : <Loading />}</Card>
      <Card title="Assessment modes and marks distribution">
        <AssessmentSchemes />
      </Card>
      <Card title="Grading scale">
        <GradingScale />
      </Card>
    </>
  );
}
