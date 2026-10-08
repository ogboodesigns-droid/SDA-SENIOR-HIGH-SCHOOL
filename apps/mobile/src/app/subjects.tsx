import type { SubjectWithTeacher } from '@sda-shs/shared';
import { useStudentQuery } from '@/lib/auth';
import { useQuery } from '@/lib/useQuery';
import { ChildSwitcher } from '@/components/ChildSwitcher';
import { Badge, Body, Card, Empty, ErrorNote, Loading, Screen, Title } from '@/components/ui';

export default function SubjectsScreen() {
  const subjects = useQuery<SubjectWithTeacher[]>(`/me/subjects${useStudentQuery()}`);
  return (
    <Screen refreshing={subjects.refreshing} onRefresh={subjects.refresh}>
      <ChildSwitcher />
      <ErrorNote message={subjects.error} onRetry={subjects.reload} />
      {subjects.loading && <Loading />}
      {subjects.data && !subjects.data.length && <Empty>No subjects have been set up for this class yet.</Empty>}
      {subjects.data?.map((s) => (
        <Card key={s.classSubjectId}>
          <Badge label={s.isCore ? 'CORE' : 'ELECTIVE'} tone={s.isCore ? 'brand' : 'muted'} />
          <Title>{s.name}</Title>
          <Body muted>{s.teacherName ?? 'Teacher to be assigned'}</Body>
        </Card>
      ))}
    </Screen>
  );
}
