import { useRouter } from 'expo-router';
import type { AssignmentSummary } from '@sda-shs/shared';
import { useAuth, useStudentQuery } from '@/lib/auth';
import { relativeDue } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { ChildSwitcher } from '@/components/ChildSwitcher';
import { Badge, Body, Card, Empty, ErrorNote, Loading, Screen, SectionTitle, Title } from '@/components/ui';

function status(a: AssignmentSummary) {
  const s = a.mySubmission;
  if (s?.status === 'graded') return <Badge label={`MARKED ${s.score}/${a.maxScore}`} tone="ok" />;
  if (s) return <Badge label={s.status === 'late' ? 'SUBMITTED LATE' : 'SUBMITTED'} tone="brand" />;
  const due = relativeDue(a.dueAt);
  return <Badge label={due.label.toUpperCase()} tone={due.tone} />;
}

export default function AssignmentsScreen() {
  const router = useRouter();
  const { me } = useAuth();
  const list = useQuery<AssignmentSummary[]>(`/assignments${useStudentQuery()}`);
  const isLearner = me?.role === 'student' || me?.role === 'parent';
  const now = new Date();
  const open = list.data?.filter((a) => (isLearner ? !a.mySubmission && new Date(a.dueAt) > now : new Date(a.dueAt) > now)) ?? [];
  const rest = list.data?.filter((a) => !open.includes(a)) ?? [];

  const render = (a: AssignmentSummary) => (
    <Card key={a.id} onPress={() => router.push(`/assignments/${a.id}`)}>
      {isLearner ? status(a) : <Badge label={`${a.submissionCount ?? 0} SUBMITTED`} />}
      <Title>{a.title}</Title>
      <Body muted>
        {a.subjectName} · {isLearner ? a.teacherName : a.className}
      </Body>
    </Card>
  );

  return (
    <Screen refreshing={list.refreshing} onRefresh={list.refresh}>
      <ChildSwitcher />
      <ErrorNote message={list.error} onRetry={list.reload} />
      {list.loading && <Loading />}
      {list.data && !list.data.length && <Empty>No assignments yet.</Empty>}
      {open.length > 0 && <SectionTitle>{isLearner ? 'To do' : 'Open'}</SectionTitle>}
      {open.map(render)}
      {rest.length > 0 && <SectionTitle>{isLearner ? 'Done & past' : 'Closed'}</SectionTitle>}
      {rest.map(render)}
    </Screen>
  );
}
