'use client';

import { useState } from 'react';
import { textOn, type House } from '@sda-shs/shared';
import { api, errorMessage, formatDate, useApi } from '@/lib/api';
import { useCan } from '@/lib/me';
import { Alert, Card, Empty, Field, Loading, PageHeader, useSubmit } from '@/components/ui';

interface PointEntry {
  id: string;
  points: number;
  reason: string;
  createdAt: string;
  awardedBy: string;
}

export default function HousesPage() {
  const houses = useApi<House[]>('/houses');
  const canManage = useCan('houses:manage');
  const [selected, setSelected] = useState('');
  const [colourError, setColourError] = useState<string | null>(null);

  async function setColour(id: string, colour: string) {
    setColourError(null);
    try {
      await api(`/houses/${id}`, { method: 'PATCH', body: { colour } });
      await houses.reload();
    } catch (e) {
      setColourError(errorMessage(e));
    }
  }
  const history = useApi<PointEntry[]>(selected ? `/houses/${selected}/points` : null);

  const award = useSubmit(async (v, form) => {
    await api(`/houses/${v.houseId}/points`, { method: 'POST', body: { points: Number(v.points), reason: v.reason } });
    form.reset();
    await houses.reload();
    if (selected === v.houseId) await history.reload();
    return 'Points recorded.';
  });

  return (
    <>
      <PageHeader title="Houses" description="House standings, points for competitions and conduct, and members." />
      <Card title="Standings">
        {!houses.data ? (
          <Loading />
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>House</th>
                <th>Colour</th>
                <th>Points</th>
                <th>Students</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {houses.data.map((h, i) => (
                <tr key={h.id}>
                  <td>{i + 1}</td>
                  <td>
                    <span className="house-chip" style={h.colour ? { background: h.colour, color: textOn(h.colour) } : undefined}>
                      {h.name}
                    </span>
                  </td>
                  <td>
                    {canManage ? (
                      <input
                        type="color"
                        aria-label={`${h.name} colour`}
                        defaultValue={h.colour ?? '#a00561'}
                        onBlur={(e) => e.target.value !== h.colour && void setColour(h.id, e.target.value)}
                        className="colour-input"
                      />
                    ) : (
                      (h.colour ?? '—')
                    )}
                  </td>
                  <td>{h.points}</td>
                  <td>{h.members}</td>
                  <td>
                    <button className="secondary" onClick={() => setSelected(h.id)}>
                      History
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Alert>{colourError}</Alert>
      </Card>

      <Card title="Award or deduct points">
        <form className="row" onSubmit={award.onSubmit}>
          <Field label="House">
            <select name="houseId" required>
              {houses.data?.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Points" hint="Negative to deduct">
            <input name="points" type="number" min={-1000} max={1000} required style={{ maxWidth: 110 }} />
          </Field>
          <Field label="Reason">
            <input name="reason" required maxLength={200} placeholder="e.g. Inter-house athletics, 1st place" style={{ minWidth: 300 }} />
          </Field>
          <button disabled={award.busy} style={{ alignSelf: 'end' }}>
            Record
          </button>
        </form>
        <Alert>{award.error}</Alert>
        <Alert kind="success">{award.success}</Alert>
      </Card>

      {selected && (
        <Card title={`${houses.data?.find((h) => h.id === selected)?.name ?? ''} — recent points`}>
          {!history.data?.length ? (
            <Empty>No points recorded yet.</Empty>
          ) : (
            <table>
              <tbody>
                {history.data.map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(p.createdAt)}</td>
                    <td>
                      <span className={`badge ${p.points > 0 ? 'ok' : 'danger'}`}>
                        {p.points > 0 ? '+' : ''}
                        {p.points}
                      </span>
                    </td>
                    <td>{p.reason}</td>
                    <td className="muted">{p.awardedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}
