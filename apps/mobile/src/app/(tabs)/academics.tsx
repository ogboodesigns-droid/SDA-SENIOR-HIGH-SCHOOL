import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';
import { ChildSwitcher } from '@/components/ChildSwitcher';
import { Body, Card, Empty, Screen, SectionTitle, Title, styles } from '@/components/ui';

interface Teaching {
  classSubjectId: string;
  className: string;
  subjectName: string;
}

function Row({ icon, title, sub, href }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; href: Href }) {
  const router = useRouter();
  return (
    <Card onPress={() => router.push(href)} accessibilityLabel={title}>
      <View style={styles.row}>
        <Ionicons name={icon} size={26} color={colors.brand} />
        <View style={{ flex: 1 }}>
          <Title>{title}</Title>
          <Body muted>{sub}</Body>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </View>
    </Card>
  );
}

export default function AcademicsScreen() {
  const { me, child } = useAuth();
  const teaching = useQuery<Teaching[]>(me?.role === 'teacher' ? '/me/teaching' : null);

  if (me?.role === 'teacher') {
    return (
      <Screen refreshing={teaching.refreshing} onRefresh={teaching.refresh}>
        <Row icon="time-outline" title="My timetable" sub="Your lessons this week" href="/timetable" />
        <Row icon="clipboard-outline" title="Assignments" sub="Work you have set and submissions" href="/assignments" />
        <SectionTitle>My classes</SectionTitle>
        {teaching.data && !teaching.data.length && <Empty>You have not been assigned any classes yet.</Empty>}
        {teaching.data?.map((t) => (
          <Card key={t.classSubjectId}>
            <Title>{t.subjectName}</Title>
            <Body muted>{t.className}</Body>
          </Card>
        ))}
        <Card>
          <Body muted>Enter results and mark submissions on the SDA SHS admin portal from a computer.</Body>
        </Card>
      </Screen>
    );
  }

  if (me?.role !== 'student' && me?.role !== 'parent') {
    return (
      <Screen>
        <Row icon="clipboard-outline" title="Assignments" sub="Assignments across the school" href="/assignments" />
        <Card>
          <Body muted>School management tools are on the admin portal.</Body>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <ChildSwitcher />
      {me.role === 'parent' && child && <Body muted>Showing {child.fullName}</Body>}
      <Row icon="book-outline" title="My Subjects" sub="Subjects and teachers" href="/subjects" />
      <Row icon="time-outline" title="Timetable" sub="This week's lessons" href="/timetable" />
      <Row icon="clipboard-outline" title="Assignments" sub="Tasks, due dates and feedback" href="/assignments" />
      <Row icon="ribbon-outline" title="Results" sub="Published term results" href="/results" />
    </Screen>
  );
}
