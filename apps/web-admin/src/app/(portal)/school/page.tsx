'use client';

import { useEffect, useState } from 'react';
import type { GradingScaleInput, SchoolProfile } from '@sda-shs/shared';
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
    return 'Grading scale saved. It applies to results entered from now on.';
  });
  if (!draft) return <Loading />;

  const setBand = (i: number, key: 'min' | 'grade' | 'remark', value: string) =>
    setDraft({ ...draft, bands: draft.bands.map((b, j) => (j === i ? { ...b, [key]: key === 'min' ? Number(value) : value } : b)) });

  return (
    <form className="stack" onSubmit={save.onSubmit}>
      <Alert kind="info">
        This starts from the WAEC-style nine-point scale. Confirm it matches the school&apos;s official policy before results are published.
      </Alert>
      <div className="row">
        <Field label="CA out of">
          <input type="number" value={draft.caMax} onChange={(e) => setDraft({ ...draft, caMax: Number(e.target.value) })} style={{ maxWidth: 100 }} />
        </Field>
        <Field label="Exam out of">
          <input type="number" value={draft.examMax} onChange={(e) => setDraft({ ...draft, examMax: Number(e.target.value) })} style={{ maxWidth: 100 }} />
        </Field>
      </div>
      <table>
        <thead>
          <tr>
            <th>From (total ≥)</th>
            <th>Grade</th>
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
      <div className="row">
        <button type="button" className="secondary" onClick={() => setDraft({ ...draft, bands: [...draft.bands, { min: 0, grade: '', remark: '' }] })}>
          Add band
        </button>
        <button disabled={save.busy}>Save grading scale</button>
      </div>
      <Alert>{save.error}</Alert>
      <Alert kind="success">{save.success}</Alert>
    </form>
  );
}

export default function SchoolPage() {
  const profile = useApi<SchoolProfile>('/school');
  return (
    <>
      <PageHeader title="School profile" description="Shown in the mobile app's About the School section. Only enter official, verified information." />
      <Card title="About the school">{profile.data ? <ProfileForm profile={profile.data} onSaved={profile.reload} /> : <Loading />}</Card>
      <Card title="Grading scale">
        <GradingScale />
      </Card>
    </>
  );
}
