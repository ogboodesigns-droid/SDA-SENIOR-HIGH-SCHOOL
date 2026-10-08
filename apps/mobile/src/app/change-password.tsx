import { useState } from 'react';
import type { Me } from '@sda-shs/shared';
import { api, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Body, Button, Card, ErrorNote, Input, Screen } from '@/components/ui';

export default function ChangePasswordScreen() {
  const { setMe, signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      setMe(await api<Me>('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } }));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <Body>Welcome! Before you continue, replace the temporary password the school gave you with one only you know.</Body>
      </Card>
      <Input label="Temporary password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
      <Input label="New password (10+ characters, a letter and a number)" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" />
      <Input label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
      <ErrorNote message={error} />
      <Button title="Save password" onPress={submit} busy={busy} />
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}
