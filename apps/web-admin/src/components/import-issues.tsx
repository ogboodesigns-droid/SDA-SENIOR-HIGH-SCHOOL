'use client';

import type { ImportIssue } from '@sda-shs/shared';

/** Problems found in an uploaded spreadsheet, by Excel row number. */
export function IssueTable({ issues, kind }: { issues: ImportIssue[]; kind: 'error' | 'warning' }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Row</th>
            <th>Column</th>
            <th>{kind === 'error' ? 'Problem' : 'Check'}</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i, n) => (
            <tr key={n}>
              <td>{i.row}</td>
              <td>{i.column ?? '—'}</td>
              <td>{i.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
