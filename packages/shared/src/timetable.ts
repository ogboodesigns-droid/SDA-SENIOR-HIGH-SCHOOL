/**
 * The school day, from the 2026/2027 master timetables: breakfast, four
 * periods, lunch, four periods. School-wide activities (PLC/VLC on Friday
 * morning, early close on Friday afternoon) replace lessons in their slot.
 */
export interface BellPeriod {
  /** "P1" … "P8" for lessons; anything else for breaks. */
  key: string;
  label: string;
  startsAt: string;
  endsAt: string;
  kind: 'lesson' | 'break';
}

export interface SchoolActivity {
  /** ISO weekday, 1 = Monday. */
  day: number;
  label: string;
  startsAt: string;
  endsAt: string;
}

export interface BellSchedule {
  /** Teaching days, ISO weekdays. */
  days: number[];
  periods: BellPeriod[];
  activities: SchoolActivity[];
}

export const DEFAULT_BELL_SCHEDULE: BellSchedule = {
  days: [1, 2, 3, 4, 5],
  periods: [
    { key: 'breakfast', label: 'Breakfast', startsAt: '07:00', endsAt: '07:30', kind: 'break' },
    { key: 'P1', label: 'P1', startsAt: '07:30', endsAt: '08:30', kind: 'lesson' },
    { key: 'P2', label: 'P2', startsAt: '08:30', endsAt: '09:30', kind: 'lesson' },
    { key: 'P3', label: 'P3', startsAt: '09:30', endsAt: '10:30', kind: 'lesson' },
    { key: 'P4', label: 'P4', startsAt: '10:30', endsAt: '11:30', kind: 'lesson' },
    { key: 'lunch', label: 'Lunch Break', startsAt: '11:30', endsAt: '12:00', kind: 'break' },
    { key: 'P5', label: 'P5', startsAt: '12:00', endsAt: '13:00', kind: 'lesson' },
    { key: 'P6', label: 'P6', startsAt: '13:00', endsAt: '14:00', kind: 'lesson' },
    { key: 'P7', label: 'P7', startsAt: '14:00', endsAt: '15:00', kind: 'lesson' },
    { key: 'P8', label: 'P8', startsAt: '15:00', endsAt: '16:00', kind: 'lesson' },
  ],
  activities: [
    { day: 5, label: 'PLC / VLC', startsAt: '09:30', endsAt: '11:30' },
    { day: 5, label: 'Closed', startsAt: '15:00', endsAt: '16:00' },
  ],
};

/** The activity occupying a period on a day, if any. */
export function activityAt(schedule: BellSchedule, day: number, startsAt: string, endsAt: string): SchoolActivity | undefined {
  return schedule.activities.find((a) => a.day === day && a.startsAt < endsAt && a.endsAt > startsAt);
}

/** Displays 24-hour "13:00" the way the school's timetables do: "01:00". */
export function schoolClock(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const hour = h > 12 ? h - 12 : h;
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
