'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ImportCredential, StudentImportReport } from '@sda-shs/shared';
import { download, errorMessage, upload } from '@/lib/api';
import { useCan } from '@/lib/me';
import { IssueTable } from '@/components/import-issues';
import { Alert, Card, Empty, PageHeader } from '@/components/ui';

function credentialsCsv(creds: ImportCredential[]): string {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [['Name', 'Account', 'Class', 'Sign in with', 'Temporary password', 'Children'].join(',')];
  for (const c of creds) {
    lines.push([c.fullName, c.role === 'student' ? 'Student' : 'Parent/guardian', c.groupName ?? '', c.signInId, c.temporaryPassword, (c.children ?? []).join('; ')].map(q).join(','));
  }
  return lines.join('\r\n');
}

function saveCsv(creds: ImportCredential[]) {
  const url = URL.createObjectURL(new Blob([credentialsCsv(creds)], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `sign-in-details-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Credentials({ creds }: { creds: ImportCredential[] }) {
  return (
    <Card
      title="Sign-in details"
      actions={
        <div className="row no-print">
          <button onClick={() => window.print()}>Print slips</button>
          <button className="secondary" onClick={() => saveCsv(creds)}>
            Save as CSV
          </button>
        </div>
      }
    >
      <Alert kind="info">
        These temporary passwords are shown only once. Print the slips or save the CSV now, and hand each slip over privately. Everyone must choose a new
        password the first time they sign in.
      </Alert>
      <div className="slips">
        {creds.map((c) => (
          <div className="slip" key={`${c.role}:${c.signInId}`}>
            <strong>SDA Senior High School — Asokore</strong>
            <div>{c.fullName}</div>
            <div className="muted">
              {c.role === 'student' ? `Student · ${c.groupName ?? ''}` : `Parent/guardian of ${(c.children ?? []).join(', ')}`}
            </div>
            <div>
              Sign in with: <code>{c.signInId}</code>
            </div>
            <div>
              Temporary password: <code>{c.temporaryPassword}</code>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function StudentImport() {
  const canManage = useCan('users:manage');
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<StudentImportReport | null>(null);
  const [busy, setBusy] = useState<'template' | 'check' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    if (!file) return;
    if (!dryRun && !confirm(`Create ${report?.valid ?? 0} student account(s) and their parent/guardian accounts?`)) return;
    setBusy(dryRun ? 'check' : 'import');
    setError(null);
    try {
      setReport(await upload<StudentImportReport>(`/imports/students?dryRun=${dryRun}`, file));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function template() {
    setBusy('template');
    setError(null);
    try {
      await download('/imports/students/template', 'student-import-template.xlsx');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) return <Alert>You do not have permission to import students.</Alert>;
  const done = report && !report.dryRun;

  return (
    <>
      <PageHeader
        title="Bulk import students"
        description="Register a whole intake from the school's student import sheet. Parent/guardian accounts are created (or linked, for siblings) from the guardian phone number."
        actions={<Link href="/users">Back to People</Link>}
      />

      {!done && (
        <Card title="1. Fill in the import sheet">
          <p>
            Download the sheet, fill one row per student on the <em>Student Import</em> tab and save it as .xlsx. The <em>Field Guide</em> tab explains each
            column and the <em>Lists</em> tab shows the class codes, houses and options the system knows.
          </p>
          <ul className="muted">
            <li>
              Admission numbers are written <code>SDA/YY/NNNN</code> (e.g. SDA/25/0142 for a 2025 admission). Leave the column blank and the system gives the next
              number for the admission year.
            </li>
            <li>The BECE index number must be the student&apos;s 10-digit number; each one can only be registered once.</li>
            <li>Phone numbers are 10 digits starting with 0. A guardian who already has an account (e.g. a sibling&apos;s parent) is linked, not duplicated.</li>
          </ul>
          <button className="secondary" onClick={template} disabled={busy !== null}>
            {busy === 'template' ? 'Preparing…' : 'Download import sheet'}
          </button>
        </Card>
      )}

      {!done && (
        <Card title="2. Upload and check">
          <div className="row">
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setReport(null);
              }}
            />
            <button onClick={() => run(true)} disabled={!file || busy !== null}>
              {busy === 'check' ? 'Checking…' : 'Check file'}
            </button>
          </div>
          <p className="muted">Checking does not change anything. Nothing is saved until you press Import.</p>
          <Alert>{error}</Alert>
        </Card>
      )}

      {report && report.dryRun && (
        <Card
          title="3. Review"
          actions={
            <button onClick={() => run(false)} disabled={!report.valid || busy !== null}>
              {busy === 'import' ? 'Importing…' : `Import ${report.valid} student(s)`}
            </button>
          }
        >
          <p>
            <span className="badge ok">{report.valid} ready</span>{' '}
            {report.total - report.valid > 0 && <span className="badge danger">{report.total - report.valid} with problems</span>}{' '}
            {report.warnings.length > 0 && <span className="badge warn">{report.warnings.length} to check</span>}
          </p>
          {report.total - report.valid > 0 && (
            <Alert kind="info">
              Rows with problems are skipped. Fix them in the sheet and upload it again — rows already imported will then show as duplicates, so you can also
              upload a sheet with just the corrected rows.
            </Alert>
          )}
          {report.errors.length > 0 && (
            <>
              <h3>Problems</h3>
              <IssueTable issues={report.errors} kind="error" />
            </>
          )}
          {report.warnings.length > 0 && (
            <>
              <h3>Please check</h3>
              <IssueTable issues={report.warnings} kind="warning" />
            </>
          )}
          <h3>Students</h3>
          {!report.rows.length ? (
            <Empty>The sheet has no student rows.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Admission no.</th>
                    <th>Student</th>
                    <th>Class</th>
                    <th>Parent/guardian</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>
                        {r.admissionNo ?? '—'}
                        {r.admissionNoGenerated && r.admissionNo && <div className="muted">new number</div>}
                      </td>
                      <td>{r.fullName}</td>
                      <td>{r.groupName ?? '—'}</td>
                      <td>
                        {r.guardianName ?? '—'}
                        {r.guardianPhone && (
                          <div className="muted">
                            {r.guardianPhone}
                            {r.guardianExists ? ' · existing account' : ''}
                          </div>
                        )}
                      </td>
                      <td>{r.ok ? <span className="badge ok">Ready</span> : <span className="badge danger">Skipped</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {done && (
        <>
          <Alert kind="success">
            Imported {report.created.students} student(s), created {report.created.parents} parent/guardian account(s)
            {report.created.linkedToExistingParents ? ` and linked ${report.created.linkedToExistingParents} to existing parent accounts` : ''}.
            {report.total - report.valid > 0 ? ` ${report.total - report.valid} row(s) with problems were skipped.` : ''}
          </Alert>
          {report.credentials.length > 0 && <Credentials creds={report.credentials} />}
          <div className="row no-print">
            <button
              className="secondary"
              onClick={() => {
                if (confirm('Leave this page? The temporary passwords will not be shown again.')) {
                  setReport(null);
                  setFile(null);
                }
              }}
            >
              Import another sheet
            </button>
          </div>
        </>
      )}
    </>
  );
}
