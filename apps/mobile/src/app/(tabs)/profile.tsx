import { useRouter } from 'expo-router';
import { Alert, Platform } from 'react-native';
import { ROLE_LABELS } from '@sda-shs/shared';
import { api, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { Badge, Body, Button, Card, Screen, SectionTitle, Title } from '@/components/ui';

interface Session {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  lastUsedAt: string;
  current: boolean;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { me, signOut } = useAuth();
  const sessions = useQuery<Session[]>('/auth/sessions');

  async function revoke(id: string) {
    try {
      await api(`/auth/sessions/${id}`, { method: 'DELETE' });
      await sessions.reload();
    } catch (e) {
      Alert.alert('Could not sign out device', describeError(e));
    }
  }

  if (!me) return null;
  return (
    <Screen refreshing={sessions.refreshing} onRefresh={sessions.refresh}>
      <Card>
        <Title>{me.fullName}</Title>
        <Badge label={ROLE_LABELS[me.role]} />
        {me.student && (
          <Body muted>
            {me.student.studentNumber} · {me.student.groupName} · {me.student.programmeName}
          </Body>
        )}
        {me.student?.houseName && <Body muted>{me.student.houseName} House</Body>}
        {me.student?.droppedSubjectName && <Body muted>Not taking: {me.student.droppedSubjectName}</Body>}
        {me.email && <Body muted>{me.email}</Body>}
        {me.phone && <Body muted>{me.phone}</Body>}
      </Card>

      {me.role === 'parent' && (
        <>
          <SectionTitle>My children</SectionTitle>
          {me.children.map((c) => (
            <Card key={c.id}>
              <Title>{c.fullName}</Title>
              <Body muted>
                {c.studentNumber} · {c.groupName}
                {c.houseName ? ` · ${c.houseName} House` : ''}
              </Body>
            </Card>
          ))}
        </>
      )}

      <SectionTitle>School</SectionTitle>
      <Card onPress={() => router.push('/school')}>
        <Title>About the School</Title>
        <Body muted>Vision, mission, history and contacts</Body>
      </Card>

      <SectionTitle>Signed-in devices</SectionTitle>
      {sessions.data?.map((s) => (
        <Card key={s.id}>
          <Title>{s.deviceName ?? 'Unknown device'}</Title>
          <Body muted>Last active {formatDate(s.lastUsedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Body>
          {s.current ? <Badge label="This device" tone="ok" /> : <Button title="Sign out this device" variant="secondary" onPress={() => revoke(s.id)} />}
        </Card>
      ))}

      <Button
        title="Sign out"
        variant="danger"
        onPress={() =>
          Platform.OS === 'web'
            ? void signOut()
            : Alert.alert('Sign out?', 'You will need your password to sign in again.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
              ])
        }
      />
    </Screen>
  );
}
