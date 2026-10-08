'use client';

import { ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_CATEGORY_LABELS, type Announcement } from '@sda-shs/shared';
import { api, formatDate, useApi } from '@/lib/api';
import { useCan } from '@/lib/me';
import { AudienceFields } from '@/components/audience';
import { Alert, Card, Empty, Field, Loading, PageHeader, useSubmit } from '@/components/ui';

const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export default function AnnouncementsPage() {
  const schoolWide = useCan('announcements:publish_school_wide');
  const list = useApi<Announcement[]>('/announcements/manage');

  const create = useSubmit(async (v, form) => {
    await api('/announcements', {
      method: 'POST',
      body: {
        title: v.title,
        body: v.body,
        category: v.category,
        priority: v.priority ?? 'normal',
        audienceType: v.audienceType,
        audienceRef: v.audienceType === 'school' ? null : v.audienceRef,
        publishAt: toIso(v.publishAt),
        expiresAt: toIso(v.expiresAt),
        sendPush: v.sendPush === 'on',
      },
    });
    form.reset();
    await list.reload();
    return 'Announcement saved.';
  });

  return (
    <>
      <PageHeader
        title="Announcements"
        description={schoolWide ? 'Publish news and notices to the whole school or a targeted group.' : 'Post notices to the classes you teach.'}
      />
      <Card title="New announcement">
        <form className="stack" onSubmit={create.onSubmit}>
          <div className="grid">
            <Field label="Title">
              <input name="title" required maxLength={160} />
            </Field>
            <Field label="Category">
              <select name="category">
                {ANNOUNCEMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {ANNOUNCEMENT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
            {schoolWide && (
              <Field label="Priority" hint="Urgent announcements are always pushed to phones.">
                <select name="priority">
                  <option value="normal">Normal</option>
                  <option value="important">Important</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Field>
            )}
            <AudienceFields schoolWide={schoolWide} />
          </div>
          <Field label="Message">
            <textarea name="body" required maxLength={10000} />
          </Field>
          <div className="grid">
            <Field label="Publish at" hint="Leave empty to publish now">
              <input name="publishAt" type="datetime-local" />
            </Field>
            <Field label="Expires at" hint="Optional">
              <input name="expiresAt" type="datetime-local" />
            </Field>
            <label className="row" style={{ alignSelf: 'end' }}>
              <input type="checkbox" name="sendPush" /> Send a notification to recipients&apos; phones
            </label>
          </div>
          <Alert>{create.error}</Alert>
          <Alert kind="success">{create.success}</Alert>
          <div>
            <button disabled={create.busy}>{create.busy ? 'Publishing…' : 'Publish'}</button>
          </div>
        </form>
      </Card>

      <Card title={schoolWide ? 'All announcements' : 'My announcements'}>
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.length ? (
          <Empty>Nothing published yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Audience</th>
                <th>Published</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((a) => {
                const scheduled = new Date(a.publishAt) > new Date();
                return (
                  <tr key={a.id}>
                    <td>
                      {a.priority !== 'normal' && <span className={`badge ${a.priority === 'urgent' ? 'danger' : 'warn'}`}>{a.priority}</span>} {a.title}
                      <div className="muted">by {a.authorName}</div>
                    </td>
                    <td>{ANNOUNCEMENT_CATEGORY_LABELS[a.category]}</td>
                    <td>{a.audienceType === 'school' ? 'Whole school' : `${a.audienceType}`}</td>
                    <td>
                      {scheduled && <span className="badge">Scheduled</span>} {formatDate(a.publishAt, true)}
                    </td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => confirm('Delete this announcement?') && api(`/announcements/${a.id}`, { method: 'DELETE' }).then(list.reload)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
