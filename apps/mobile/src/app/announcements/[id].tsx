import * as Speech from 'expo-speech';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ANNOUNCEMENT_CATEGORY_LABELS, type Announcement } from '@sda-shs/shared';
import { formatDate } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { Badge, Body, Button, Card, ErrorNote, Loading, Screen, Title } from '@/components/ui';

export default function AnnouncementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useQuery<Announcement>(`/announcements/${id}`);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => void Speech.stop(), []);

  function toggleReadAloud(a: Announcement) {
    if (speaking) {
      void Speech.stop();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    Speech.speak(`${a.title}. ${a.body}`, { language: 'en-GB', onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false), onError: () => setSpeaking(false) });
  }

  if (item.loading) return <Loading />;
  if (!item.data) return <ErrorNote message={item.error} onRetry={item.reload} />;
  const a = item.data;

  return (
    <Screen>
      <Card>
        {a.priority !== 'normal' && <Badge label={a.priority.toUpperCase()} tone={a.priority === 'urgent' ? 'danger' : 'warn'} />}
        <Title>{a.title}</Title>
        <Body muted>
          {ANNOUNCEMENT_CATEGORY_LABELS[a.category]} · {formatDate(a.publishAt)} · {a.authorName}
        </Body>
      </Card>
      <Card>
        <Body>{a.body}</Body>
      </Card>
      <Button title={speaking ? '■ Stop reading' : '🔊 Read aloud'} variant="secondary" onPress={() => toggleReadAloud(a)} />
    </Screen>
  );
}
