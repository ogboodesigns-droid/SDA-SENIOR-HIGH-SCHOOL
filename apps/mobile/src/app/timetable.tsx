import { WEEKDAY_LABELS, type TimetableSlot } from '@sda-shs/shared';
import { useAuth, useStudentQuery } from '@/lib/auth';
import { todayWeekday } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { ChildSwitcher } from '@/components/ChildSwitcher';
import { Badge, Body, Card, Empty, ErrorNote, Loading, Screen, SectionTitle, Title } from '@/components/ui';

export default function TimetableScreen() {
  const { me } = useAuth();
  const sq = useStudentQuery();
  const slots = useQuery<TimetableSlot[]>(`/timetable/mine${sq}`);
  const today = todayWeekday();
  const days = [...new Set(slots.data?.map((s) => s.dayOfWeek) ?? [])].sort();

  return (
    <Screen refreshing={slots.refreshing} onRefresh={slots.refresh}>
      <ChildSwitcher />
      <ErrorNote message={slots.error} onRetry={slots.reload} />
      {slots.loading && <Loading />}
      {slots.data && !slots.data.length && <Empty>No timetable has been published for this term yet.</Empty>}
      {days.map((day) => (
        <Card key={day}>
          <SectionTitle action={day === today ? <Badge label="TODAY" tone="ok" /> : undefined}>{WEEKDAY_LABELS[day]}</SectionTitle>
          {slots.data!
            .filter((s) => s.dayOfWeek === day)
            .map((s) => (
              <Card key={s.id} style={{ borderWidth: 0, paddingHorizontal: 0, paddingVertical: 6 }}>
                <Title>
                  {s.startsAt}–{s.endsAt} · {s.subjectName}
                </Title>
                <Body muted>
                  {me?.role === 'teacher' ? s.className : (s.teacherName ?? 'Teacher to be assigned')}
                  {s.room ? ` · ${s.room}` : ''}
                </Body>
              </Card>
            ))}
        </Card>
      ))}
    </Screen>
  );
}
