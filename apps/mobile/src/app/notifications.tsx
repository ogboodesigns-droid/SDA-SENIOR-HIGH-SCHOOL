import { useRouter } from 'expo-router';
import type { AppNotification } from '@sda-shs/shared';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { Badge, Body, Button, Card, Empty, ErrorNote, Loading, Screen, Title } from '@/components/ui';

export default function NotificationsScreen() {
  const router = useRouter();
  const list = useQuery<{ unread: number; items: AppNotification[] }>('/notifications');

  async function open(n: AppNotification) {
    if (!n.readAt) void api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
    if (n.data?.assignmentId) router.push(`/assignments/${n.data.assignmentId}`);
    else if (n.data?.announcementId) router.push(`/announcements/${n.data.announcementId}`);
    else if (n.type === 'result_published') router.push('/results');
  }

  return (
    <Screen refreshing={list.refreshing} onRefresh={list.refresh}>
      {!!list.data?.unread && <Button title="Mark all as read" variant="secondary" onPress={() => api('/notifications/read-all', { method: 'POST' }).then(list.reload)} />}
      <ErrorNote message={list.error} onRetry={list.reload} />
      {list.loading && <Loading />}
      {list.data && !list.data.items.length && <Empty>You have no notifications.</Empty>}
      {list.data?.items.map((n) => (
        <Card key={n.id} onPress={() => open(n)} style={n.readAt ? undefined : { borderColor: '#123b7a', borderWidth: 2 }}>
          {!n.readAt && <Badge label="NEW" />}
          <Title>{n.title}</Title>
          <Body>{n.body}</Body>
          <Body muted>{formatDate(n.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Body>
        </Card>
      ))}
    </Screen>
  );
}
