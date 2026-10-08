const TZ = 'Africa/Accra';

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Date(iso).toLocaleDateString('en-GB', { ...opts, timeZone: TZ });
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function relativeDue(iso: string): { label: string; tone: 'danger' | 'warn' | 'muted' } {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.floor(ms / 86_400_000);
  if (ms < 0) return { label: 'Past due', tone: 'muted' };
  if (days < 1) return { label: 'Due today', tone: 'danger' };
  if (days < 2) return { label: 'Due tomorrow', tone: 'danger' };
  if (days < 7) return { label: `Due in ${days} days`, tone: 'warn' };
  return { label: `Due ${formatDate(iso, { day: 'numeric', month: 'short' })}`, tone: 'muted' };
}

export function greeting(now = new Date()) {
  const h = Number(now.toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: TZ }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** ISO weekday (1 = Monday) in Ghana time. */
export function todayWeekday(now = new Date()) {
  const name = now.toLocaleDateString('en-GB', { weekday: 'long', timeZone: TZ });
  return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(name) + 1;
}
