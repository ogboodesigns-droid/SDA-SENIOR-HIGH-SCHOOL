import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { activityAt, schoolClock, WEEKDAY_LABELS, type BellSchedule, type TimetableSlot } from '@sda-shs/shared';
import { useAuth, useStudentQuery } from '@/lib/auth';
import { todayWeekday } from '@/lib/format';
import { colors, space } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';
import { ChildSwitcher } from '@/components/ChildSwitcher';
import { Body, Card, Empty, ErrorNote, Loading, Screen } from '@/components/ui';

/** One day at a time, in the school's period order, with breaks and school-wide activities. */
export default function TimetableScreen() {
  const { me } = useAuth();
  const sq = useStudentQuery();
  const slots = useQuery<TimetableSlot[]>(`/timetable/mine${sq}`);
  const bell = useQuery<BellSchedule>('/school/bell-schedule');
  const today = todayWeekday();
  const days = bell.data?.days ?? [1, 2, 3, 4, 5];
  const [day, setDay] = useState(days.includes(today) ? today : days[0]);

  const isTeacher = me?.role === 'teacher';
  const lessonsAt = (startsAt: string, endsAt: string) =>
    (slots.data ?? []).filter((s) => s.dayOfWeek === day && s.startsAt < endsAt && s.endsAt > startsAt);

  return (
    <Screen refreshing={slots.refreshing} onRefresh={() => (slots.refresh(), bell.refresh())}>
      <ChildSwitcher />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {days.map((d) => {
          const active = d === day;
          return (
            <Pressable
              key={d}
              onPress={() => setDay(d)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: active ? colors.brand : '#fff',
                borderWidth: 1,
                borderColor: active ? colors.brand : colors.border,
              }}
            >
              <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700' }}>
                {WEEKDAY_LABELS[d].slice(0, 3)}
                {d === today ? ' •' : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ErrorNote message={slots.error ?? bell.error} onRetry={() => (slots.reload(), bell.reload())} />
      {(slots.loading || bell.loading) && <Loading />}
      {slots.data && !slots.data.length && <Empty>No timetable has been published for this semester yet.</Empty>}

      {slots.data && bell.data && slots.data.length > 0 && (
        <View style={{ gap: space.sm }}>
          {bell.data.periods.map((p) => {
            const time = `${schoolClock(p.startsAt)} – ${schoolClock(p.endsAt)}`;
            if (p.kind === 'break') {
              return (
                <View key={p.key} style={{ flexDirection: 'row', gap: space.md, paddingHorizontal: space.sm }}>
                  <Body muted style={{ width: 92, fontSize: 13 }}>
                    {time}
                  </Body>
                  <Body muted style={{ fontStyle: 'italic' }}>
                    {p.label}
                  </Body>
                </View>
              );
            }
            const activity = activityAt(bell.data!, day, p.startsAt, p.endsAt);
            const here = lessonsAt(p.startsAt, p.endsAt);
            return (
              <Card
                key={p.key}
                style={{
                  flexDirection: 'row',
                  gap: space.md,
                  paddingVertical: space.md,
                  ...(activity ? { backgroundColor: '#f8e6f0', borderColor: '#f8e6f0' } : {}),
                }}
              >
                <View style={{ width: 96 }}>
                  <Body style={{ fontWeight: '800' }}>{p.label}</Body>
                  <Body muted style={{ fontSize: 12 }}>
                    {time}
                  </Body>
                </View>
                <View style={{ flex: 1, justifyContent: 'center' }}>
                  {activity ? (
                    <Body style={{ fontWeight: '700', color: colors.brand }}>{activity.label}</Body>
                  ) : here.length ? (
                    here.map((s) => (
                      <View key={s.id}>
                        <Body style={{ fontWeight: '700' }}>{s.subjectName}</Body>
                        <Body muted style={{ fontSize: 13 }}>
                          {isTeacher ? s.className : (s.teacherName ?? 'Teacher to be assigned')}
                          {s.room ? ` · ${s.room}` : ''}
                        </Body>
                        {s.combinedWith.length > 0 && (
                          <Body style={{ fontSize: 13, color: colors.ok, fontWeight: '600' }}>Combined class with {s.combinedWith.join(', ')}</Body>
                        )}
                      </View>
                    ))
                  ) : (
                    <Body muted>Free</Body>
                  )}
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
