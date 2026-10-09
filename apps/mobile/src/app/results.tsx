import { View } from 'react-native';
import { shortLabel, type ResultRow } from '@sda-shs/shared';
import { useStudentQuery } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';
import { ChildSwitcher } from '@/components/ChildSwitcher';
import { Badge, Body, Card, Empty, ErrorNote, Loading, Screen, SectionTitle, Title, styles } from '@/components/ui';

interface ResultsResponse {
  rows: ResultRow[];
  terms: { termId: string; termName: string; subjects: number; average: number; aggregate: number | null; gpa: number }[];
}

function gradeTone(points: number): 'ok' | 'brand' | 'warn' | 'danger' {
  if (points <= 3) return 'ok';
  if (points <= 6) return 'brand';
  if (points <= 8) return 'warn';
  return 'danger';
}

export default function ResultsScreen() {
  const results = useQuery<ResultsResponse>(`/results/mine${useStudentQuery()}`);

  return (
    <Screen refreshing={results.refreshing} onRefresh={results.refresh}>
      <ChildSwitcher />
      <ErrorNote message={results.error} onRetry={results.reload} />
      {results.loading && <Loading />}
      {results.data && !results.data.rows.length && <Empty>No results have been published yet. You will be notified when they are.</Empty>}
      {results.data?.terms.map((t) => (
        <View key={t.termId} style={{ gap: 8 }}>
          <SectionTitle>{t.termName}</SectionTitle>
          <Card>
            <Title>
              GPA {t.gpa.toFixed(1)} · Average {t.average}%
            </Title>
            <Body muted>
              {t.subjects} subject{t.subjects === 1 ? '' : 's'}
            </Body>
            {t.aggregate !== null && <Body>Aggregate (best 3 core + best 3 electives): {t.aggregate}</Body>}
          </Card>
          {results
            .data!.rows.filter((r) => r.termId === t.termId)
            .map((r) => (
              <Card key={r.id}>
                <View style={[styles.row, { justifyContent: 'space-between' }]}>
                  <View style={{ flex: 1 }}>
                    <Title>{r.subjectName}</Title>
                    <Body muted>
                      {r.total}% · {r.remark}
                    </Body>
                  </View>
                  <Badge label={r.grade} tone={gradeTone(r.gradePoint)} />
                </View>
                {r.breakdown.some((b) => b.score !== null) && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {r.breakdown.map((b) => (
                      <View key={b.key} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Body style={{ fontSize: 12, color: colors.muted }}>{shortLabel({ ...b, isExam: b.key === 'exam' })}</Body>
                        <Body style={{ fontWeight: '700' }}>
                          {b.score ?? '–'}/{b.weight}
                        </Body>
                      </View>
                    ))}
                  </View>
                )}
                {r.teacherComment && <Body muted>“{r.teacherComment}”</Body>}
              </Card>
            ))}
        </View>
      ))}
    </Screen>
  );
}
