import { View } from 'react-native';
import type { ResultRow } from '@sda-shs/shared';
import { useStudentQuery } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';
import { ChildSwitcher } from '@/components/ChildSwitcher';
import { Body, Card, Empty, ErrorNote, Loading, Screen, SectionTitle, Title, styles } from '@/components/ui';

interface ResultsResponse {
  rows: ResultRow[];
  terms: { termId: string; termName: string; subjects: number; average: number; aggregate: number | null }[];
}

function Cell({ children, flex = 1, bold }: { children: React.ReactNode; flex?: number; bold?: boolean }) {
  return (
    <View style={{ flex }}>
      <Body style={bold ? { fontWeight: '700' } : undefined}>{children}</Body>
    </View>
  );
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
            <Title>Average: {t.average}%</Title>
            {t.aggregate !== null && <Body>Aggregate (best 3 core + best 3 electives): {t.aggregate}</Body>}
            <Body muted>
              {t.subjects} subject{t.subjects === 1 ? '' : 's'}
            </Body>
          </Card>
          <Card>
            <View style={[styles.row, { borderBottomWidth: 1, borderColor: colors.border, paddingBottom: 6 }]}>
              <Cell flex={2.6} bold>
                Subject
              </Cell>
              <Cell bold>CA</Cell>
              <Cell flex={1.2} bold>
                Exam
              </Cell>
              <Cell flex={1.2} bold>
                Total
              </Cell>
              <Cell flex={1.3} bold>
                Grade
              </Cell>
            </View>
            {results.data!.rows
              .filter((r) => r.termId === t.termId)
              .map((r) => (
                <View key={r.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.border }}>
                  <View style={styles.row}>
                    <Cell flex={2.6}>{r.subjectName}</Cell>
                    <Cell>{r.caScore}</Cell>
                    <Cell flex={1.2}>{r.examScore}</Cell>
                    <Cell flex={1.2} bold>
                      {r.total}
                    </Cell>
                    <Cell flex={1.3} bold>
                      {r.grade}
                    </Cell>
                  </View>
                  <View style={styles.row}>
                    <Body muted>{r.remark}</Body>
                  </View>
                  {r.teacherComment && <Body muted>“{r.teacherComment}”</Body>}
                </View>
              ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
