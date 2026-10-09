import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Loading } from '@/components/ui';
import { colors } from '@/lib/theme';

function Gate() {
  const { status, me } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    const at = segments[0];
    if (status === 'signedOut' && at !== 'login') router.replace('/login');
    else if (status === 'signedIn' && me?.mustChangePassword && at !== 'change-password') router.replace('/change-password');
    else if (status === 'signedIn' && !me?.mustChangePassword && (at === 'login' || at === 'change-password')) router.replace('/');
  }, [status, me, segments, router]);

  if (status === 'loading') return <Loading />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.brandDark },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="change-password" options={{ title: 'New password', headerBackVisible: false }} />
      <Stack.Screen name="timetable" options={{ title: 'Timetable' }} />
      <Stack.Screen name="results" options={{ title: 'My Results' }} />
      <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="subjects" options={{ title: 'My Subjects' }} />
      <Stack.Screen name="assignments/index" options={{ title: 'Assignments' }} />
      <Stack.Screen name="assignments/[id]" options={{ title: 'Assignment' }} />
      <Stack.Screen name="announcements/[id]" options={{ title: 'Announcement' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="school" options={{ title: 'About the School' }} />
      <Stack.Screen name="faith" options={{ title: 'Faith & Spiritual Life' }} />
      <Stack.Screen name="houses" options={{ title: 'Houses' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
