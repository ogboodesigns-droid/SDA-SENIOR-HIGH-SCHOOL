import { Image, Linking, Text } from 'react-native';
import type { SchoolProfile } from '@sda-shs/shared';
import { useQuery } from '@/lib/useQuery';
import { Body, Card, ErrorNote, Loading, Screen, SectionTitle, Title, styles } from '@/components/ui';

function ContactLink({ label, url }: { label: string; url: string }) {
  return (
    <Text style={[styles.body, styles.link]} onPress={() => void Linking.openURL(url)} accessibilityRole="link">
      {label}
    </Text>
  );
}

function Section({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card>
        <Body>{text}</Body>
      </Card>
    </>
  );
}

export default function SchoolScreen() {
  const school = useQuery<SchoolProfile>('/school');
  if (school.loading) return <Loading />;
  if (!school.data) return <ErrorNote message={school.error} onRetry={school.reload} />;
  const s = school.data;
  const nothingYet = !s.vision && !s.mission && !s.history && !s.coreValues.length;

  return (
    <Screen refreshing={school.refreshing} onRefresh={school.refresh}>
      <Card style={{ alignItems: 'center' }}>
        <Image source={require('../../assets/logo.png')} style={{ width: 140, height: 140 }} accessibilityLabel="School crest" />
        <Title>{s.name}</Title>
        {s.motto && <Body muted>“{s.motto}”</Body>}
      </Card>
      {nothingYet && <Body muted>The school will publish its vision, mission and history here soon.</Body>}
      <Section title="Vision" text={s.vision} />
      <Section title="Mission" text={s.mission} />
      {s.coreValues.length > 0 && <Section title="Core values" text={s.coreValues.map((v) => `• ${v}`).join('\n')} />}
      <Section title="History" text={s.history} />
      {(s.address || s.phone || s.email || s.website) && (
        <>
          <SectionTitle>Contact</SectionTitle>
          <Card>
            {s.address && <Body>{s.address}</Body>}
            {s.phone && <ContactLink label={`📞 ${s.phone}`} url={`tel:${s.phone.replace(/\s/g, '')}`} />}
            {s.email && <ContactLink label={`✉️ ${s.email}`} url={`mailto:${s.email}`} />}
            {s.website && <ContactLink label={`🌐 ${s.website}`} url={s.website} />}
          </Card>
        </>
      )}
    </Screen>
  );
}
