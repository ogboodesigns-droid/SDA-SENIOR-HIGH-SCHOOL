import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SchoolProfile } from '@sda-shs/shared';
import { describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@/lib/useQuery';
import { Button, ErrorNote, Input } from '@/components/ui';
import { colors, space } from '@/lib/theme';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const school = useQuery<SchoolProfile>('/school');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!identifier.trim() || !password) {
      setError('Enter your student number, email or phone, and your password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier.trim(), password);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.brandDark }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <Text style={s.brand}>SDA SHS</Text>
            <Text style={s.sub}>{school.data?.name ?? 'SDA Senior High School'}</Text>
            <Text style={s.motto}>{school.data?.motto ?? 'Learn. Grow. Serve.'}</Text>
          </View>
          <View style={s.card}>
            <Input
              label="Student number, email or phone"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              returnKeyType="next"
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <ErrorNote message={error} />
            <Button title="Sign in" onPress={submit} busy={busy} />
            <Text style={s.help}>Your account is created by the school. If you have forgotten your password, contact the school office.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.xl },
  header: { alignItems: 'center', gap: space.xs },
  brand: { color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: 1 },
  sub: { color: '#dfe7f5', fontSize: 16, textAlign: 'center' },
  motto: { color: colors.gold, fontSize: 14, fontStyle: 'italic' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: space.xl, gap: space.lg },
  help: { color: colors.muted, fontSize: 13, textAlign: 'center' },
});
