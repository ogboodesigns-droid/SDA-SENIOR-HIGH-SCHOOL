import { useState } from 'react';
import { View } from 'react-native';
import type { SchoolEvent } from '@sda-shs/shared';
import { formatDate, formatTime } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { Badge, Body, Button, Card, Empty, ErrorNote, Loading, Screen, SectionTitle, Title, styles } from '@/components/ui';

function monthStart(offset: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

export default function CalendarScreen() {
  const [offset, setOffset] = useState(0);
  const from = monthStart(offset);
  const to = monthStart(offset + 1);
  const events = useQuery<SchoolEvent[]>(`/events?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`);
  const title = from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <Screen refreshing={events.refreshing} onRefresh={events.refresh}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <View style={{ flex: 1 }}>
          <Button title="‹ Previous" variant="secondary" onPress={() => setOffset(offset - 1)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Next ›" variant="secondary" onPress={() => setOffset(offset + 1)} />
        </View>
      </View>
      <SectionTitle>{title}</SectionTitle>
      <ErrorNote message={events.error} onRetry={events.reload} />
      {events.loading && <Loading />}
      {events.data && !events.data.length && <Empty>No events this month.</Empty>}
      {events.data?.map((e) => (
        <Card key={e.id}>
          <Badge label={e.category.toUpperCase()} tone={e.category === 'examination' ? 'danger' : e.category === 'holiday' ? 'ok' : 'brand'} />
          <Title>{e.title}</Title>
          <Body muted>
            {formatDate(e.startsAt, { weekday: 'short', day: 'numeric', month: 'short' })}
            {!e.allDay && ` · ${formatTime(e.startsAt)}`}
            {e.endsAt && ` – ${formatDate(e.endsAt, { day: 'numeric', month: 'short' })}`}
            {e.location ? ` · ${e.location}` : ''}
          </Body>
          {e.description && <Body>{e.description}</Body>}
        </Card>
      ))}
    </Screen>
  );
}
