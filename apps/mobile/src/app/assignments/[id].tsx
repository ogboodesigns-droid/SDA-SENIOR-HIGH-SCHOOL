import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES, type AssignmentSummary, type SubmissionSummary } from '@sda-shs/shared';
import { api, describeError } from '@/lib/api';
import { useAuth, useStudentQuery } from '@/lib/auth';
import { formatDate, relativeDue } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { Badge, Body, Button, Card, ErrorNote, Input, Loading, Screen, SectionTitle, Title, styles } from '@/components/ui';

interface Picked {
  name: string;
  size: number;
  mimeType: string;
  uri: string;
  file?: File;
}

export default function AssignmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  const assignment = useQuery<AssignmentSummary>(`/assignments/${id}${useStudentQuery()}`);
  const [text, setText] = useState('');
  const [file, setFile] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: [...UPLOAD_MIME_TYPES], copyToCacheDirectory: true, multiple: false });
    if (res.canceled) return;
    const a = res.assets[0];
    if ((a.size ?? 0) > UPLOAD_MAX_BYTES) return setError('That file is larger than 10 MB. Please choose a smaller file.');
    setFile({ name: a.name, size: a.size ?? 0, mimeType: a.mimeType ?? 'application/octet-stream', uri: a.uri, file: a.file });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let fileId: string | null = null;
      if (file) {
        const form = new FormData();
        if (Platform.OS === 'web' && file.file) form.append('file', file.file);
        // React Native's FormData accepts { uri, name, type } for files.
        else form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
        fileId = (await api<{ id: string }>('/files', { method: 'POST', body: form })).id;
      }
      await api<SubmissionSummary>(`/assignments/${id}/submission`, { method: 'POST', body: { textResponse: text.trim() || null, fileId } });
      setText('');
      setFile(null);
      await assignment.reload();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (assignment.loading) return <Loading />;
  if (!assignment.data) return <ErrorNote message={assignment.error} onRetry={assignment.reload} />;
  const a = assignment.data;
  const sub = a.mySubmission;
  const due = relativeDue(a.dueAt);
  const closed = new Date(a.dueAt) < new Date() && !a.allowLateSubmissions;
  const canSubmit = me?.role === 'student' && sub?.status !== 'graded' && !closed;

  return (
    <Screen refreshing={assignment.refreshing} onRefresh={assignment.refresh}>
      <Card>
        <Badge label={due.label.toUpperCase()} tone={due.tone} />
        <Title>{a.title}</Title>
        <Body muted>
          {a.subjectName} · {a.teacherName}
        </Body>
        <Body muted>
          Due {formatDate(a.dueAt, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · marked out of {a.maxScore}
        </Body>
      </Card>
      <Card>
        <Body>{a.instructions}</Body>
      </Card>

      {sub && (
        <>
          <SectionTitle>{me?.role === 'parent' ? 'Submission' : 'Your submission'}</SectionTitle>
          <Card>
            <Badge label={sub.status.toUpperCase()} tone={sub.status === 'graded' ? 'ok' : sub.status === 'late' ? 'warn' : 'brand'} />
            <Body muted>Submitted {formatDate(sub.submittedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Body>
            {sub.textResponse && <Body>{sub.textResponse}</Body>}
            {sub.file && <Body muted>📎 {sub.file.fileName}</Body>}
            {sub.status === 'graded' && (
              <>
                <Title>
                  Score: {sub.score} / {a.maxScore}
                </Title>
                {sub.feedback && <Body>Feedback: {sub.feedback}</Body>}
              </>
            )}
          </Card>
        </>
      )}

      {me?.role === 'student' && !canSubmit && !sub && <ErrorNote message="The deadline for this assignment has passed." />}
      {canSubmit && (
        <>
          <SectionTitle>{sub ? 'Replace your submission' : 'Submit your work'}</SectionTitle>
          <Input label="Your answer" value={text} onChangeText={setText} multiline placeholder="Type your response…" />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button title={file ? 'Change file' : 'Attach PDF, Word or photo'} variant="secondary" onPress={pick} />
            </View>
          </View>
          {file && (
            <Body muted>
              📎 {file.name} ({Math.ceil(file.size / 1024)} KB)
            </Body>
          )}
          <ErrorNote message={error} />
          <Button title={sub ? 'Resubmit' : 'Submit'} onPress={submit} busy={busy} disabled={!text.trim() && !file} />
        </>
      )}
    </Screen>
  );
}
