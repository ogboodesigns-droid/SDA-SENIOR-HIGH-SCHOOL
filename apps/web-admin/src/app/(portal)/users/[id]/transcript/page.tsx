'use client';

import Link from 'next/link';
import { use } from 'react';
import type { Me, Transcript } from '@sda-shs/shared';
import { useApi } from '@/lib/api';
import { Alert, Empty, Loading } from '@/components/ui';

const one = (n: number) => n.toFixed(1);

/** The official transcript, laid out like the school's own (A4, two pages). */
export default function TranscriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useApi<Me>(`/users/${id}`);
  const studentId = user.data?.student?.id;
  const t = useApi<Transcript>(studentId ? `/results/transcript/${studentId}` : null);

  if (user.error || t.error) return <Alert>{user.error ?? t.error}</Alert>;
  if (user.data && !studentId) return <Alert>Only students have a transcript.</Alert>;
  if (!t.data) return <Loading />;
  const { school, student } = t.data;

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 16 }}>
        <Link href={`/users/${id}`}>Back to {user.data?.fullName}</Link>
        <button onClick={() => window.print()}>Print transcript</button>
        <span className="muted">Built from published results only. Each time it is opened by staff it is recorded in the audit log.</span>
      </div>

      <article className="transcript">
        <header className="tr-head">
          <div className="tr-school">
            <img src={school.logoUrl ?? '/logo.png'} alt="" className="tr-logo" />
            <div>
              <strong>{school.name.toUpperCase()}</strong>
              {school.address && <div>Addr: {school.address}</div>}
              {school.phone && <div>Tel: {school.phone}</div>}
              {school.email && <div>E-Mail: {school.email}</div>}
              {school.gpsAddress && <div>GPS Addr: {school.gpsAddress}</div>}
            </div>
          </div>
          <div className="tr-student">
            <strong>{student.name}</strong>
            <div>Study Area: {student.studyArea}</div>
            <div>Date of Birth: {student.dateOfBirth ?? '—'}</div>
            <div>Year of Admission: {student.yearOfAdmission ?? '—'}</div>
            <div>Admission No.: {student.admissionNo}</div>
            <div>Ass&apos;t Ref ID: {student.assessmentRefId ?? '—'}</div>
          </div>
        </header>

        <h1 className="tr-title">
          OFFICIAL TRANSCRIPT
          <span>★★★</span>
        </h1>

        {!t.data.years.length && <Empty>No published results yet.</Empty>}
        {t.data.years.map((y) => (
          <section key={y.academicYearName} className="tr-year">
            <h2>
              Year {y.year} Academic Record <span className="muted">({y.academicYearName})</span>
            </h2>
            <table>
              <thead>
                <tr>
                  <th rowSpan={2}>Course Title</th>
                  <th colSpan={2}>Semester 1</th>
                  <th colSpan={2}>Semester 2</th>
                </tr>
                <tr>
                  <th>GPA</th>
                  <th>Final Grade</th>
                  <th>GPA</th>
                  <th>Final Grade</th>
                </tr>
              </thead>
              <tbody>
                {y.courses.map((c) => (
                  <tr key={c.subjectName}>
                    <td>{c.subjectName}</td>
                    {c.semesters.flatMap((s, i) => [
                      <td key={`g${i}`}>{s ? one(s.gpa) : '—'}</td>,
                      <td key={`f${i}`}>{s?.grade ?? '—'}</td>,
                    ])}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tr-note">No qualitative assessment available for Year {y.year}.</p>
          </section>
        ))}

        <section className="tr-summary">
          <h2>Academic Summary</h2>
          <p>
            Cumulative GPA: <strong>{t.data.cumulativeGpa === null ? '—' : one(t.data.cumulativeGpa)}</strong> | Credits Earned:{' '}
            <strong>{one(t.data.creditsEarned)}</strong>
          </p>
        </section>

        <section className="tr-scale">
          <h2>GRADE INTERPRETATION</h2>
          <table>
            <thead>
              <tr>
                <th>Grade</th>
                <th>Points</th>
                <th>Score Ranges</th>
                <th>Interpretation</th>
              </tr>
            </thead>
            <tbody>
              {t.data.gradeInterpretation.map((g) => (
                <tr key={g.grade}>
                  <td>{g.grade}</td>
                  <td>{one(g.gpa)}</td>
                  <td>
                    {g.min} - {g.max}
                  </td>
                  <td>{g.remark.toUpperCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tr-note">
            Cumulative GPA is the average of the GPA points of every subject in every semester. {t.data.creditsPerSubject} credits are earned for each subject
            passed in a semester.
          </p>
        </section>
      </article>
    </>
  );
}
