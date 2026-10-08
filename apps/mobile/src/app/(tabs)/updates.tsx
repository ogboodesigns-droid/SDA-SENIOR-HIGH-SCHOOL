import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_CATEGORY_LABELS, type Announcement, type AnnouncementCategory } from '@sda-shs/shared';
import { formatDate } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';
import { Badge, Body, Card, Empty, ErrorNote, Loading, Screen, Title } from '@/components/ui';

export default function UpdatesScreen() {
  const router = useRouter();
  const [category, setCategory] = useState<AnnouncementCategory | null>(null);
  const feed = useQuery<Announcement[]>(`/announcements?limit=50${category ? `&category=${category}` : ''}`);

  return (
    <Screen refreshing={feed.refreshing} onRefresh={feed.refresh}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {[null, ...ANNOUNCEMENT_CATEGORIES].map((c) => {
          const active = c === category;
          return (
            <Pressable
              key={c ?? 'all'}
              onPress={() => setCategory(c)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: active ? colors.brand : '#fff', borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600', fontSize: 13 }}>{c ? ANNOUNCEMENT_CATEGORY_LABELS[c] : 'All'}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ErrorNote message={feed.error} onRetry={feed.reload} />
      {feed.loading && <Loading />}
      {feed.data && !feed.data.length && <Empty>No announcements here yet.</Empty>}
      {feed.data?.map((a) => (
        <Card key={a.id} onPress={() => router.push(`/announcements/${a.id}`)}>
          {a.priority !== 'normal' && <Badge label={a.priority.toUpperCase()} tone={a.priority === 'urgent' ? 'danger' : 'warn'} />}
          <Title>{a.title}</Title>
          <Body lines={2}>{a.body}</Body>
          <Body muted>
            {ANNOUNCEMENT_CATEGORY_LABELS[a.category]} · {formatDate(a.publishAt)}
          </Body>
        </Card>
      ))}
    </Screen>
  );
}
