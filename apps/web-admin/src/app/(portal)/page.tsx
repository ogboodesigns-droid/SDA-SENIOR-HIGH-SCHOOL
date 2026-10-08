'use client';

import Link from 'next/link';
import { ROLE_LABELS, type Role } from '@sda-shs/shared';
import { useApi } from '@/lib/api';
import { useCan, useMe } from '@/lib/me';
import { Card, Empty, Loading, PageHeader } from '@/components/ui';

interface Dashboard {
  activeUsersByRole: Partial<Record<Role, number>>;
  classes: number;
}

interface Teaching {
  classSubjectId: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
}

export default function DashboardPage() {
  const me = useMe();
  const canSeePeople = useCan('users:read');
  const stats = useApi<Dashboard>(canSeePeople ? '/dashboard' : null);
  const teaching = useApi<Teaching[]>(me.role === 'teacher' ? '/me/teaching' : null);

  return (
    <>
      <PageHeader title={`Welcome, ${me.fullName.split(' ')[0]}`} description="SDA Senior High School administration" />

      {canSeePeople && (
        <Card title="School at a glance">
          {stats.loading ? (
            <Loading />
          ) : (
            <div className="grid">
              {(['student', 'teacher', 'parent'] as Role[]).map((r) => (
                <div key={r}>
                  <div className="stat">{stats.data?.activeUsersByRole[r] ?? 0}</div>
                  <div className="muted">Active {ROLE_LABELS[r].toLowerCase()} accounts</div>
                </div>
              ))}
              <div>
                <div className="stat">{stats.data?.classes ?? 0}</div>
                <div className="muted">Classes</div>
              </div>
            </div>
          )}
        </Card>
      )}

      {me.role === 'teacher' && (
        <Card title="My classes">
          {teaching.loading ? (
            <Loading />
          ) : !teaching.data?.length ? (
            <Empty>You have not been assigned any subjects yet. The school administration assigns teachers to classes.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Subject</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {teaching.data.map((t) => (
                  <tr key={t.classSubjectId}>
                    <td>{t.className}</td>
                    <td>{t.subjectName}</td>
                    <td className="row">
                      <Link href={`/results?classId=${t.classId}&subjectId=${t.subjectId}`}>Enter results</Link>
                      <Link href={`/assignments?classId=${t.classId}&subjectId=${t.subjectId}`}>Assignments</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Card title="Getting started">
        <ol className="stack" style={{ margin: 0, paddingLeft: 20 }}>
          <li>Complete the <Link href="/school">school profile</Link> and confirm the grading scale.</li>
          <li>Create the academic year, terms, programmes, classes and subjects under <Link href="/academics">Classes &amp; subjects</Link>.</li>
          <li>Create staff, student and parent accounts under <Link href="/users">People</Link>, and link parents to their children.</li>
          <li>Assign teachers to class subjects, then build the <Link href="/timetable">timetable</Link>.</li>
        </ol>
      </Card>
    </>
  );
}
