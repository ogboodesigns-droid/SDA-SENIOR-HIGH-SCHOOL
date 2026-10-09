'use client';

import { shortLabel, type AssessmentComponent, type ReportCard } from '@sda-shs/shared';
import { formatDate } from '@/lib/api';

const SEMESTER = { 1: 'FIRST SEMESTER', 2: 'SECOND SEMESTER' } as const;
const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : v);

/** One student's terminal report, laid out for an A4 page. */
export function ReportCardView({ card }: { card: ReportCard }) {
  const { school, student, term, summary, remarks } = card;
  const core = card.subjects.filter((s) => s.isCore);
  const electives = card.subjects.filter((s) => !s.isCore);
  const cols = card.components.length + 5;

  const rows = (list: ReportCard['subjects'], heading: string) =>
    list.length > 0 && [
      <tr key={heading} className="rc-group">
        <td colSpan={cols}>{heading}</td>
      </tr>,
      ...list.map((s) => (
        <tr key={s.subjectName}>
          <td>
            {s.subjectName}
            {s.teacherComment && <div className="rc-comment">{s.teacherComment}</div>}
          </td>
          {s.scores.map((v, i) => (
            <td key={i}>{dash(v)}</td>
          ))}
          <td>
            <strong>{s.total}</strong>
          </td>
          <td>{s.grade}</td>
          <td>{s.gpa.toFixed(1)}</td>
          <td>{s.remark}</td>
        </tr>
      )),
    ];

  return (
    <article className="report-card">
      {card.draft && <div className="rc-draft">DRAFT — some marks are not yet published</div>}
      <header className="rc-head">
        <img src={school.logoUrl ?? '/logo.png'} alt="" className="rc-logo" />
        <div>
          <h1>{school.name.toUpperCase()}</h1>
          {school.motto && <div className="rc-motto">&ldquo;{school.motto}&rdquo;</div>}
          <div>{[school.address, school.phone && `Tel: ${school.phone}`, school.email].filter(Boolean).join(' · ')}</div>
        </div>
      </header>
      <h2 className="rc-title">
        STUDENT&apos;S REPORT — {SEMESTER[term.semester]}, {term.academicYearName}
      </h2>

      <dl className="rc-info">
        <div>
          <dt>Name</dt>
          <dd>{student.name}</dd>
        </div>
        <div>
          <dt>Admission No.</dt>
          <dd>{student.admissionNo}</dd>
        </div>
        <div>
          <dt>Class</dt>
          <dd>{student.groupName}</dd>
        </div>
        <div>
          <dt>Programme</dt>
          <dd>{student.programmeName}</dd>
        </div>
        <div>
          <dt>House</dt>
          <dd>{dash(student.houseName)}</dd>
        </div>
        <div>
          <dt>No. on roll</dt>
          <dd>{card.classSize}</dd>
        </div>
        <div>
          <dt>Vacation date</dt>
          <dd>{formatDate(term.endsOn)}</dd>
        </div>
        <div>
          <dt>Next semester begins</dt>
          <dd>{term.nextTermBegins ? formatDate(term.nextTermBegins) : '—'}</dd>
        </div>
      </dl>

      <table className="rc-table">
        <thead>
          <tr>
            <th>Subject</th>
            {card.components.map((c) => (
              <th key={c.key} title={c.label}>
                {shortLabel(c as AssessmentComponent)}
                <div className="rc-weight">({c.weight})</div>
              </th>
            ))}
            <th>
              Total
              <div className="rc-weight">(100)</div>
            </th>
            <th>Grade</th>
            <th>GPA</th>
            <th>Remark</th>
          </tr>
        </thead>
        <tbody>
          {card.subjects.length === 0 ? (
            <tr>
              <td colSpan={cols}>No marks for this semester yet.</td>
            </tr>
          ) : (
            <>
              {rows(core, 'Core subjects')}
              {rows(electives, 'Elective subjects')}
            </>
          )}
        </tbody>
      </table>

      <div className="rc-summary">
        <span>
          Subjects: <strong>{summary.subjects}</strong>
        </span>
        <span>
          Total marks: <strong>{summary.totalMarks}</strong>
        </span>
        <span>
          Average: <strong>{summary.average === null ? '—' : `${summary.average}%`}</strong>
        </span>
        <span>
          GPA: <strong>{summary.gpa === null ? '—' : summary.gpa.toFixed(1)}</strong>
        </span>
        <span>
          Aggregate: <strong>{dash(summary.aggregate)}</strong>
        </span>
      </div>

      <div className="rc-remarks">
        <div className="rc-traits">
          <span>
            Conduct: <strong>{dash(remarks.conduct)}</strong>
          </span>
          <span>
            Attitude: <strong>{dash(remarks.attitude)}</strong>
          </span>
          <span>
            Interest: <strong>{dash(remarks.interest)}</strong>
          </span>
        </div>
        <div className="rc-remark">
          <div className="rc-label">Form master&apos;s remark{card.formMasterName ? ` (${card.formMasterName})` : ''}</div>
          <p>{dash(remarks.formMasterRemark)}</p>
          <div className="rc-sign">Signature: ____________________</div>
        </div>
        <div className="rc-remark">
          <div className="rc-label">Head of school&apos;s remark</div>
          <p>{dash(remarks.headRemark)}</p>
          <div className="rc-sign">Signature &amp; stamp: ____________________</div>
        </div>
      </div>
      <p className="rc-key">
        Grades: A1 Excellent · B2 Very Good · B3 Good · C4–C6 Credit · D7–E8 Pass · F9 Fail. Aggregate: best three core and best three elective grades (6
        is the best possible).
      </p>
    </article>
  );
}
