'use client';

import { formatDate, useApi } from '@/lib/api';
import { Alert, Card, Loading, PageHeader } from '@/components/ui';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
  actorName: string | null;
}

export default function AuditPage() {
  const log = useApi<AuditRow[]>('/audit-logs');
  return (
    <>
      <PageHeader title="Audit log" description="The 200 most recent security and data-changing actions." />
      <Card>
        <Alert>{log.error}</Alert>
        {!log.data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Record</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {log.data.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.createdAt, true)}</td>
                    <td>{r.actorName ?? '—'}</td>
                    <td>
                      <code>{r.action}</code>
                    </td>
                    <td>
                      {r.entityType}
                      {r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ''}
                    </td>
                    <td>{r.ipAddress ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
