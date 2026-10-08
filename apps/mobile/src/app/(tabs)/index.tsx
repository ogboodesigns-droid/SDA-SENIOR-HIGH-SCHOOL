import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Announcement, AppNotification, AssignmentSummary, SchoolEvent, TimetableSlot } from '@sda-shs/shared';
import { useAuth, useStudentQuery } from '@/lib/auth';
import { formatDate, greeting, relativeDue, todayWeekday } from '@/lib/format';
import { colors, space } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';
import { ChildSwitcher } from '@/components/ChildSwitcher';
import { Badge, Body, Card, Empty, ErrorNote, Screen, SectionTitle, Title } from '@/components/ui';

const QUICK: { label: string; icon: keyof typeof Ionicons.glyphMap; href: Href; roles?: string[] }[] = [
  { label: 'Timetable', icon: 'time-outline', href: '/timetable', roles: ['student', 'parent', 'teacher'] },
  { label: 'Results', icon: 'ribbon-outline', href: '/results', roles: ['student', 'parent'] },
  { label: 'Assignments', icon: 'clipboard-outline', href: '/assignments', roles: ['student', 'parent', 'teacher', 'head', 'assistant_head', 'super_admin'] },
  { label: 'Subjects', icon: 'book-outline', href: '/subjects', roles: ['student', 'parent'] },
  { label: 'News', icon: 'megaphone-outline', href: '/updates' },
  { label: 'Events', icon: 'calendar-outline', href: '/calendar' },
  { label: 'Faith Life', icon: 'heart-outline', href: '/faith' },
  { label: 'Our School', icon: 'school-outline', href: '/school' },
];

function isoDay(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export default function HomeScreen() {
  const router = useRouter();
  const { me, child } = useAuth();
  const sq = useStudentQuery();
  const hasClass = me?.role === 'student' || me?.role === 'teacher' || (me?.role === 'parent' && !!child);

  const notifications = useQuery<{ unread: number; items: AppNotification[] }>('/notifications');
  const timetable = useQuery<TimetableSlot[]>(hasClass ? `/timetable/mine${sq}` : null);
  const assignments = useQuery<AssignmentSummary[]>(me?.role === 'student' || (me?.role === 'parent' && child) ? `/assignments${sq}` : null);
  const announcements = useQuery<Announcement[]>('/announcements?limit=3');
  const events = useQuery<SchoolEvent[]>(`/events?from=${isoDay(0)}&to=${isoDay(60)}`);

  const today = todayWeekday();
  const todays = timetable.data?.filter((s) => s.dayOfWeek === today) ?? [];
  const pending = (assignments.data ?? []).filter((a) => !a.mySubmission && new Date(a.dueAt) > new Date()).slice(0, 3);
  const refreshing = notifications.refreshing || announcements.refreshing;

  function refreshAll() {
    void notifications.refresh();
    void timetable.refresh();
    void assignments.refresh();
    void announcements.refresh();
    void events.refresh();
  }

  return (
    <Screen refreshing={refreshing} onRefresh={refreshAll}>
      <View style={s.hero}>
        <Text style={s.greeting}>
          {greeting()}, {me?.fullName.split(' ')[0]} 👋
        </Text>
        {me?.role === 'parent' && child && <Text style={s.heroSub}>Viewing {child.fullName} · {child.className}</Text>}
        {me?.role === 'student' && me.student && <Text style={s.heroSub}>{me.student.className}</Text>}
        <Pressable onPress={() => router.push('/notifications')} accessibilityRole="button" style={s.bell}>
          <Ionicons name="notifications-outline" size={18} color="#fff" />
          <Text style={s.bellText}>
            {notifications.data?.unread ? `${notifications.data.unread} new notification${notifications.data.unread === 1 ? '' : 's'}` : 'No new notifications'}
          </Text>
        </Pressable>
      </View>

      <ChildSwitcher />
      {me?.role === 'parent' && !me.children.length && (
        <Card>
          <Body>Your account is not yet linked to a student. Please contact the school office.</Body>
        </Card>
      )}

      {hasClass && (
        <>
          <SectionTitle>Today</SectionTitle>
          <ErrorNote message={timetable.error} onRetry={timetable.reload} />
          {timetable.data && !todays.length && <Empty>No lessons scheduled today.</Empty>}
          {todays.map((slot) => (
            <Card key={slot.id}>
              <Title>{slot.subjectName}</Title>
              <Body muted>
                {slot.startsAt} – {slot.endsAt}
                {me?.role === 'teacher' ? ` · ${slot.className}` : slot.teacherName ? ` · ${slot.teacherName}` : ''}
                {slot.room ? ` · ${slot.room}` : ''}
              </Body>
            </Card>
          ))}
        </>
      )}

      <SectionTitle>Quick access</SectionTitle>
      <View style={s.grid}>
        {QUICK.filter((q) => !q.roles || q.roles.includes(me?.role ?? '')).map((q) => (
          <Pressable key={q.label} style={({ pressed }) => [s.tile, pressed && { opacity: 0.8 }]} onPress={() => router.push(q.href)} accessibilityRole="button">
            <Ionicons name={q.icon} size={26} color={colors.brand} />
            <Text style={s.tileText}>{q.label}</Text>
          </Pressable>
        ))}
      </View>

      {pending.length > 0 && (
        <>
          <SectionTitle>Due soon</SectionTitle>
          {pending.map((a) => {
            const due = relativeDue(a.dueAt);
            return (
              <Card key={a.id} onPress={() => router.push(`/assignments/${a.id}`)}>
                <Badge label={due.label} tone={due.tone} />
                <Title>{a.title}</Title>
                <Body muted>{a.subjectName}</Body>
              </Card>
            );
          })}
        </>
      )}

      <SectionTitle>Upcoming</SectionTitle>
      {events.data && !events.data.length && <Empty>No upcoming events.</Empty>}
      {events.data?.slice(0, 3).map((e) => (
        <Card key={e.id}>
          <Title>{e.title}</Title>
          <Body muted>
            {formatDate(e.startsAt)}
            {e.location ? ` · ${e.location}` : ''}
          </Body>
        </Card>
      ))}

      <SectionTitle>Latest announcements</SectionTitle>
      <ErrorNote message={announcements.error} onRetry={announcements.reload} />
      {announcements.data && !announcements.data.length && <Empty>No announcements yet.</Empty>}
      {announcements.data?.map((a) => (
        <Card key={a.id} onPress={() => router.push(`/announcements/${a.id}`)}>
          {a.priority !== 'normal' && <Badge label={a.priority.toUpperCase()} tone={a.priority === 'urgent' ? 'danger' : 'warn'} />}
          <Title>{a.title}</Title>
          <Body muted>{formatDate(a.publishAt)}</Body>
        </Card>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: colors.brand, borderRadius: 16, padding: space.lg, gap: space.xs },
  greeting: { color: '#fff', fontSize: 22, fontWeight: '800' },
  heroSub: { color: '#f6dbe9', fontSize: 14 },
  bell: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  bellText: { color: '#fff', fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { width: '23%', flexGrow: 1, minWidth: 76, backgroundColor: '#fff', borderRadius: 12, paddingVertical: space.md, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border },
  tileText: { fontSize: 12, fontWeight: '600', color: colors.text, textAlign: 'center' },
});
