'use client';

import { useState } from 'react';
import { ROLE_LABELS, ROLES, type AudienceType } from '@sda-shs/shared';
import { useApi } from '@/lib/api';
import { Field } from '@/components/ui';

interface ClassRow { id: string; name: string; programmeId: string; programmeName: string }

/** Audience picker shared by announcements and calendar events. */
export function AudienceFields({ schoolWide }: { schoolWide: boolean }) {
  const [type, setType] = useState<AudienceType>(schoolWide ? 'school' : 'class');
  const classes = useApi<ClassRow[]>('/classes');
  const programmes = useApi<{ id: string; name: string }[]>(schoolWide ? '/programmes' : null);
  const houses = useApi<{ id: string; name: string }[]>(schoolWide ? '/houses' : null);
  const types: AudienceType[] = schoolWide ? ['school', 'role', 'form', 'programme', 'class', 'house'] : ['class'];
  const labels: Record<AudienceType, string> = {
    school: 'Whole school',
    role: 'A group of users',
    form: 'A form (year group)',
    programme: 'A learning area',
    class: 'A class',
    house: 'A house',
  };

  return (
    <>
      <Field label="Who is this for?">
        <select name="audienceType" value={type} onChange={(e) => setType(e.target.value as AudienceType)}>
          {types.map((t) => (
            <option key={t} value={t}>
              {labels[t]}
            </option>
          ))}
        </select>
      </Field>
      {type === 'role' && (
        <Field label="Group">
          <select name="audienceRef">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}s
              </option>
            ))}
          </select>
        </Field>
      )}
      {type === 'form' && (
        <Field label="Form">
          <select name="audienceRef">
            <option value="1">SHS 1</option>
            <option value="2">SHS 2</option>
            <option value="3">SHS 3</option>
          </select>
        </Field>
      )}
      {type === 'programme' && (
        <Field label="Learning area">
          <select name="audienceRef">
            {programmes.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {type === 'house' && (
        <Field label="House">
          <select name="audienceRef" required>
            {houses.data?.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {type === 'class' && (
        <Field label="Class">
          <select name="audienceRef" required>
            {classes.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}
