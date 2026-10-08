import { useRouter } from 'expo-router';
import type { Announcement, SchoolEvent } from '@sda-shs/shared';
import { formatDate, formatTime } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { Body, Card, Empty, ErrorNote, Screen, SectionTitle, Title } from '@/components/ui';

function isoDay(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Chapel, Sabbath programmes, devotion and other spiritual life. Everything
 * here comes from what the school publishes as "Religious" announcements and
 * calendar events, so the chaplaincy controls the content.
 */
export default function FaithScreen() {
  const router = useRouter();
  const news = useQuery<Announcement[]>('/announcements?category=religious&limit=20');
  const events = useQuery<SchoolEvent[]>(`/events?from=${isoDay(0)}&to=${isoDay(90)}`);
  const programmes = events.data?.filter((e) => e.category === 'religious') ?? [];

  return (
    <Screen refreshing={news.refreshing || events.refreshing} onRefresh={() => (news.refresh(), events.refresh())}>
      <Card>
        <Title>Faith & Spiritual Life</Title>
        <Body muted>Chapel, Sabbath programmes, devotion, Bible study and other spiritual activities at the school.</Body>
      </Card>

      <SectionTitle>Upcoming programmes</SectionTitle>
      <ErrorNote message={events.error} onRetry={events.reload} />
      {events.data && !programmes.length && <Empty>No upcoming programmes have been published.</Empty>}
      {programmes.map((e) => (
        <Card key={e.id}>
          <Title>{e.title}</Title>
          <Body muted>
            {formatDate(e.startsAt, { weekday: 'long', day: 'numeric', month: 'long' })}
            {!e.allDay && ` · ${formatTime(e.startsAt)}`}
            {e.location ? ` · ${e.location}` : ''}
          </Body>
          {e.description && <Body>{e.description}</Body>}
        </Card>
      ))}

      <SectionTitle>Religious announcements</SectionTitle>
      <ErrorNote message={news.error} onRetry={news.reload} />
      {news.data && !news.data.length && <Empty>No religious announcements yet.</Empty>}
      {news.data?.map((a) => (
        <Card key={a.id} onPress={() => router.push(`/announcements/${a.id}`)}>
          <Title>{a.title}</Title>
          <Body lines={2}>{a.body}</Body>
          <Body muted>{formatDate(a.publishAt)}</Body>
        </Card>
      ))}
    </Screen>
  );
}
