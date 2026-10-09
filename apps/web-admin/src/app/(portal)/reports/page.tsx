'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isLeadership, type ReportCard, type ReportRemarks, type TermSummary } from '@sda-shs/shared';
import { api, errorMessage, useApi } from '@/lib/api';
import { useMe } from '@/lib/me';
import { Alert, Card, Empty, Field, Loading, PageHeader } from '@/components/ui';

type RemarkKey = keyof ReportRemarks;
const TRAITS: [RemarkKey, string][] = [
  ['conduct', 'Conduct'],
  ['attitude', 'Attitude'],
  ['interest', 'Interest'],
];

/** One student's row: summary, then remarks the form master (and the head) fill in. */
function RemarksRow({ card, termId, canHead, onSaved }: { card: ReportCard; termId: string; canHead: boolean; onSaved: (r: ReportRemarks) => void }) {
  const [draft, setDraft] = useState<ReportRemarks>(card.remarks);
  const [state, setState] = useState<{ busy?: boolean; error?: string; saved?: boolean }>({});
  useEffect(() => setDraft(card.remarks), [card.remarks]);
  const changed = (Object.keys(draft) as RemarkKey[]).filter((k) => (draft[k] ?? '') !== (card.remarks[k] ?? '') && (k !== 'headRemark' || canHead));

  async function save() {
    setState({ busy: true });
    try {
      const body = Object.fromEntries(changed.map((k) => [k, draft[k] || null]));
      const saved = await api<ReportRemarks>('/reports/remarks', { method: 'PUT', body: { termId, studentId: card.student.id, ...body } });
      onSaved(saved);
      setState({ saved: true });
    } catch (e) {
      setState({ error: errorMessage(e) });
    }
  }

  const set = (k: RemarkKey, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setState({});
  };

  return (
    <tr>
      <td>
        <strong>{card.student.name}</strong>
        <div className="muted">
          {card.student.groupName} · {card.student.admissionNo}
        </div>
        <div className="muted">
          {card.summary.subjects} subjects · avg {card.summary.average ?? '—'} · GPA {card.summary.gpa?.toFixed(1) ?? '—'} · agg {card.summary.aggregate ?? '—'}
        </div>
        {card.draft && <span className="badge warn">Some marks unpublished</span>}
      </td>
      <td>
        <div className="stack" style={{ gap: 6 }}>
          {TRAITS.map(([k, label]) => (
            <input key={k} value={draft[k] ?? ''} onChange={(e) => set(k, e.target.value)} placeholder={label} aria-label={label} maxLength={80} />
          ))}
        </div>
      </td>
      <td>
        <textarea
          value={draft.formMasterRemark ?? ''}
          onChange={(e) => set('formMasterRemark', e.target.value)}
          maxLength={400}
          aria-label="Form master's remark"
          style={{ minHeight: 96 }}
        />
      </td>
      <td>
        {canHead ? (
          <textarea value={draft.headRemark ?? ''} onChange={(e) => set('headRemark', e.target.value)} maxLength={400} aria-label="Head's remark" style={{ minHeight: 96 }} />
        ) : (
          <span className="muted">{card.remarks.headRemark ?? '—'}</span>
        )}
      </td>
      <td>
        <div className="stack" style={{ gap: 6 }}>
          <button onClick={save} disabled={!changed.length || state.busy}>
            {state.busy ? 'Saving…' : state.saved && !changed.length ? 'Saved' : 'Save'}
          </button>
          <Link href={`/reports/print?termId=${termId}&studentId=${card.student.id}`} className="button secondary">
            View
          </Link>
        </div>
        {state.error && <div className="field-hint" style={{ color: 'var(--danger)' }}>{state.error}</div>}
      </td>
    </tr>
  );
}

export default function ReportsPage() {
  const me = useMe();
  const leader = isLeadership(me.role);
  const terms = useApi<TermSummary[]>('/terms');
  const classes = useApi<{ id: string; name: string }[]>('/classes');
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const cards = useApi<ReportCard[]>(termId && classId ? `/reports/class/${classId}?termId=${termId}` : null);

  useEffect(() => {
    if (!termId && terms.data?.length) setTermId((terms.data.find((t) => t.isCurrent) ?? terms.data[0]).id);
  }, [terms.data, termId]);

  // Teachers write reports for the classes they are form master of.
  const myClasses = classes.data?.filter((c) => leader || me.formClassIds?.includes(c.id)) ?? [];
  useEffect(() => {
    if (!classId && !leader && myClasses.length === 1) setClassId(myClasses[0].id);
  }, [classId, leader, myClasses]);

  return (
    <>
      <PageHeader
        title="Report cards"
        description="Terminal reports from each semester's marks. Form masters write conduct, attitude, interest and their remark; the head of school adds theirs. Students and parents see the report once marks are published."
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
          <Field label="Class">
            <select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Choose a class</option>
              {myClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {!leader && classes.data && !myClasses.length && <Alert kind="info">You are not form master of any class, so there are no reports for you to write.</Alert>}
      </Card>

      {termId && classId && (
        <Card
          title="Students"
          actions={
            cards.data?.length ? (
              <Link href={`/reports/print?termId=${termId}&classId=${classId}`} className="button">
                Print all ({cards.data.length})
              </Link>
            ) : undefined
          }
        >
          <Alert>{cards.error}</Alert>
          {cards.loading && !cards.data ? (
            <Loading />
          ) : !cards.data?.length ? (
            <Empty>No students in this class.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Conduct · attitude · interest</th>
                    <th>Form master&apos;s remark</th>
                    <th>Head&apos;s remark</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cards.data.map((c) => (
                    <RemarksRow
                      key={c.student.id}
                      card={c}
                      termId={termId}
                      canHead={leader}
                      onSaved={(remarks) => cards.setData((all) => all?.map((x) => (x.student.id === c.student.id ? { ...x, remarks } : x)))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
