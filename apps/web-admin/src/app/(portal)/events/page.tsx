'use client';

import { useState } from 'react';
import { EVENT_CATEGORIES, type SchoolEvent } from '@sda-shs/shared';
import { api, formatDate, useApi } from '@/lib/api';
import { AudienceFields } from '@/components/audience';
import { Alert, blankToNull, Card, Empty, Field, Loading, PageHeader, useSubmit } from '@/components/ui';

function monthRange(offset: number) {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 3, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label: from.toLocaleString('en-GB', { month: 'long', year: 'numeric' }) };
}

export default function EventsPage() {
  const [offset, setOffset] = useState(0);
  const range = monthRange(offset);
  const events = useApi<SchoolEvent[]>(`/events?from=${range.from}&to=${range.to}`);

  const create = useSubmit(async (v, form) => {
    const allDay = v.allDay === 'on';
    const start = allDay ? new Date(`${v.startDate}T00:00:00Z`) : new Date(`${v.startDate}T${v.startTime || '00:00'}`);
    const end = v.endDate ? (allDay ? new Date(`${v.endDate}T23:59:00Z`) : new Date(`${v.endDate}T${v.endTime || '23:59'}`)) : null;
    await api('/events', {
      method: 'POST',
      body: {
        title: v.title,
        description: blankToNull(v.description),
        category: v.category,
        startsAt: start.toISOString(),
        endsAt: end?.toISOString() ?? null,
        allDay,
        location: blankToNull(v.location),
        audienceType: v.audienceType,
        audienceRef: v.audienceType === 'school' ? null : v.audienceRef,
      },
    });
    form.reset();
    await events.reload();
    return 'Added to the calendar.';
  });

  return (
    <>
      <PageHeader title="School calendar" description="Reopening, examinations, PTA meetings, sports, religious programmes, vacations and other events." />
      <Card title="Add an event">
        <form className="stack" onSubmit={create.onSubmit}>
          <div className="grid">
            <Field label="Title">
              <input name="title" required />
            </Field>
            <Field label="Category">
              <select name="category">
                {EVENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c[0].toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Location">
              <input name="location" />
            </Field>
            <AudienceFields schoolWide />
            <Field label="Start date">
              <input name="startDate" type="date" required />
            </Field>
            <Field label="Start time">
              <input name="startTime" type="time" />
            </Field>
            <Field label="End date" hint="Optional">
              <input name="endDate" type="date" />
            </Field>
            <Field label="End time">
              <input name="endTime" type="time" />
            </Field>
            <label className="row" style={{ alignSelf: 'end' }}>
              <input type="checkbox" name="allDay" /> All day
            </label>
          </div>
          <Field label="Description">
            <textarea name="description" />
          </Field>
          <Alert>{create.error}</Alert>
          <Alert kind="success">{create.success}</Alert>
          <div>
            <button disabled={create.busy}>Add event</button>
          </div>
        </form>
      </Card>

      <Card
        title={`From ${range.label}`}
        actions={
          <div className="row">
            <button className="secondary" onClick={() => setOffset(offset - 1)}>
              ← Earlier
            </button>
            <button className="secondary" onClick={() => setOffset(offset + 1)}>
              Later →
            </button>
          </div>
        }
      >
        {events.loading && !events.data ? (
          <Loading />
        ) : !events.data?.length ? (
          <Empty>No events in this period.</Empty>
        ) : (
          <table>
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {formatDate(e.startsAt, !e.allDay)}
                    {e.endsAt && ` – ${formatDate(e.endsAt, !e.allDay)}`}
                  </td>
                  <td>
                    <strong>{e.title}</strong> <span className="badge">{e.category}</span>
                    {e.location && <div className="muted">{e.location}</div>}
                  </td>
                  <td>
                    <button className="secondary" onClick={() => confirm('Remove this event?') && api(`/events/${e.id}`, { method: 'DELETE' }).then(events.reload)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
