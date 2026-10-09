import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ATTENDANCE_LABELS, type AttendanceStatus, type MyAttendance, type TermSummary } from '@sda-shs/shared';
import { useStudentQuery } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';
import { ChildSwitcher } from '@/components/ChildSwitcher';
import { Badge, Body, Card, Empty, ErrorNote, Loading, Screen, SectionTitle, Title, styles } from '@/components/ui';

const TONE: Record<AttendanceStatus, 'ok' | 'warn' | 'danger' | 'brand'> = { present: 'ok', late: 'warn', absent: 'danger', excused: 'brand' };

export default function AttendanceScreen() {
  const studentQuery = useStudentQuery('&');
  const terms = useQuery<TermSummary[]>('/terms');
  const [termId, setTermId] = useState<string | null>(null);
  useEffect(() => {
    if (!termId && terms.data?.length) setTermId((terms.data.find((t) => t.isCurrent) ?? terms.data[0]).id);
  }, [terms.data, termId]);
  const att = useQuery<MyAttendance>(termId ? `/attendance/mine?termId=${termId}${studentQuery}` : null);
  const c = att.data?.counts;

  return (
    <Screen refreshing={att.refreshing} onRefresh={att.refresh}>
      <ChildSwitcher />
      <ErrorNote message={terms.error ?? att.error} onRetry={att.reload} />
      {terms.data && terms.data.length > 1 && (
        <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
          {terms.data.slice(0, 4).map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setTermId(t.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: t.id === termId }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: t.id === termId ? colors.brand : colors.border,
                backgroundColor: t.id === termId ? colors.brand : '#fff',
              }}
            >
              <Body style={{ color: t.id === termId ? '#fff' : colors.text, fontSize: 13 }}>
                {t.academicYearName} · {t.semester === 2 ? 'Sem 2' : 'Sem 1'}
              </Body>
            </Pressable>
          ))}
        </View>
      )}
      {(terms.loading || att.loading) && <Loading />}
      {c && !c.days && <Empty>No register has been taken for this semester yet.</Empty>}
      {c && c.days > 0 && (
        <>
          <Card>
            <Title>{c.percentage}% attendance</Title>
            <Body muted>
              Present {c.present + c.late} of {c.days} school days
            </Body>
            <View style={[styles.row, { flexWrap: 'wrap', gap: 6, marginTop: 6 }]}>
              <Badge label={`${c.present} present`} tone="ok" />
              <Badge label={`${c.late} late`} tone="warn" />
              <Badge label={`${c.absent} absent`} tone="danger" />
              <Badge label={`${c.excused} excused`} tone="brand" />
            </View>
          </Card>
          <SectionTitle>Days absent, late or excused</SectionTitle>
          {!att.data!.exceptions.length && <Empty>None — present every day.</Empty>}
          {att.data!.exceptions.map((e) => (
            <Card key={e.date}>
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <View style={{ flex: 1 }}>
                  <Title>{formatDate(e.date, { weekday: 'long', day: 'numeric', month: 'long' })}</Title>
                  {e.note && <Body muted>{e.note}</Body>}
                </View>
                <Badge label={ATTENDANCE_LABELS[e.status]} tone={TONE[e.status]} />
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
