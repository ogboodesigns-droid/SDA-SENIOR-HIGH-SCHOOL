'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ReportCard } from '@sda-shs/shared';
import { useApi } from '@/lib/api';
import { ReportCardView } from '@/components/report-card';
import { Alert, Empty, Loading } from '@/components/ui';

/** Report cards ready to print: one per A4 page, for a class or a single student. */
function PrintReports() {
  const params = useSearchParams();
  const termId = params.get('termId') ?? '';
  const classId = params.get('classId');
  const studentId = params.get('studentId');
  const many = useApi<ReportCard[]>(classId ? `/reports/class/${classId}?termId=${termId}` : null);
  const one = useApi<ReportCard>(studentId ? `/reports/student/${studentId}?termId=${termId}` : null);
  const cards = classId ? many.data : one.data ? [one.data] : undefined;
  const error = many.error ?? one.error;

  if (error) return <Alert>{error}</Alert>;
  if (!cards) return <Loading />;
  const drafts = cards.filter((c) => c.draft).length;

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 16 }}>
        <Link href="/reports">Back to report cards</Link>
        <button onClick={() => window.print()} disabled={!cards.length}>
          Print {cards.length === 1 ? 'report card' : `${cards.length} report cards`}
        </button>
        {drafts > 0 && <span className="badge warn">{drafts} with unpublished marks (printed as DRAFT)</span>}
      </div>
      {!cards.length ? <Empty>No students.</Empty> : cards.map((c) => <ReportCardView key={c.student.id} card={c} />)}
    </>
  );
}

export default function PrintReportsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PrintReports />
    </Suspense>
  );
}
