import { View } from 'react-native';
import type { House } from '@sda-shs/shared';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';
import { Badge, Body, Card, ErrorNote, Loading, Screen, SectionTitle, Title, styles } from '@/components/ui';

export default function HousesScreen() {
  const { me, child } = useAuth();
  const houses = useQuery<House[]>('/houses');
  const myHouseId = (me?.role === 'student' ? me.student : child)?.houseId ?? null;
  const mine = houses.data?.find((h) => h.id === myHouseId);

  return (
    <Screen refreshing={houses.refreshing} onRefresh={houses.refresh}>
      <ErrorNote message={houses.error} onRetry={houses.reload} />
      {houses.loading && <Loading />}
      {mine && (
        <Card style={{ backgroundColor: colors.brand, borderColor: colors.brand }}>
          <Body style={{ color: '#f6dbe9' }}>{me?.role === 'parent' ? `${child?.fullName.split(' ')[0]}'s house` : 'My house'}</Body>
          <Title>
            <Body style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{mine.name}</Body>
          </Title>
          <Body style={{ color: '#fff' }}>
            {mine.points} points · position {(houses.data?.indexOf(mine) ?? 0) + 1} of {houses.data?.length}
          </Body>
        </Card>
      )}
      <SectionTitle>House competition</SectionTitle>
      {houses.data?.map((h, i) => (
        <Card key={h.id}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <View style={[styles.row, { flex: 1 }]}>
              <Body style={{ fontSize: 22, width: 34 }}>{['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`}</Body>
              <View style={{ flex: 1 }}>
                <Title>{h.name}</Title>
                <Body muted>
                  {h.members} student{h.members === 1 ? '' : 's'}
                </Body>
              </View>
            </View>
            <Badge label={`${h.points} pts`} tone={h.id === myHouseId ? 'ok' : 'brand'} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
