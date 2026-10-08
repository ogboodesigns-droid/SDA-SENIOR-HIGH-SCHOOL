import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function TabsLayout() {
  const { status, me } = useAuth();
  // Keep signed-out users from mounting screens that would fire unauthenticated requests.
  if (status !== 'signedIn') return <Redirect href="/login" />;
  if (me?.mustChangePassword) return <Redirect href="/change-password" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.brandDark },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', headerTitle: 'SDA SHS', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="academics" options={{ title: 'Academics', tabBarIcon: icon('school-outline') }} />
      <Tabs.Screen name="updates" options={{ title: 'Updates', tabBarIcon: icon('megaphone-outline') }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
