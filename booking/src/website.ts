import type { Database } from './database.ts';
import { BookingError } from './service.ts';

export const locations = ['moenichwald', 'waldbach'] as const;
export type Location = typeof locations[number];
export type Slot = { label: string; startsAt: string; endsAt: string };

export function bookingMode(value: string | undefined) {
  return value === 'pilot' || value === 'live' ? value : 'legacy';
}

export async function bookingAccess(db: Database, location: Location, userId: string, pilot: boolean) {
  return db.transaction(async tx => {
    await tx.query('SELECT c.id FROM clubs c JOIN booking_locations l ON l.club_id=c.id WHERE l.slug=$1 FOR UPDATE OF c', [location]);
    const { rows: [account] } = await tx.query<{ club_id: string; member_id: string; role: 'member' | 'admin' }>(
      `SELECT l.club_id, a.member_id, m.role
       FROM booking_environment e CROSS JOIN booking_locations l JOIN booking_accounts a ON a.club_id=l.club_id
       JOIN members m ON m.club_id=a.club_id AND m.id=a.member_id
       WHERE l.slug=$1 AND a.user_id=$2 AND m.state='active' AND (NOT $3::boolean OR a.pilot_enabled)
         AND e.mode=CASE WHEN $3::boolean THEN 'pilot' ELSE 'live' END
       FOR SHARE OF a, e`,
      [location, userId, pilot],
    );
    if (!account) throw new BookingError('FORBIDDEN');
    return { actor: { clubId: account.club_id, memberId: account.member_id }, role: account.role };
  });
}

const vienna = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function calendarDay(day: string, policy: { openingMinute: number; closingMinute: number; slotMinutes: number }) {
  const base = Date.parse(day + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(base) ||
      new Date(base).toISOString().slice(0, 10) !== day) throw new BookingError('INVALID_TIME');

  const times: number[] = [];
  const slots: Slot[] = [];
  for (let time = base - 3 * 3600000; time < base + 25 * 3600000; time += 15 * 60000) {
    const [date, label] = vienna.format(time).split(' ');
    if (date !== day) continue;
    times.push(time);
    const [hour, minute] = label.split(':').map(Number);
    const localMinute = hour * 60 + minute;
    const end = time + policy.slotMinutes * 60000;
    const [lastDate, lastLabel] = vienna.format(end - 1).split(' ');
    const [lastHour, lastMinute] = lastLabel.split(':').map(Number);
    if (localMinute < policy.openingMinute || localMinute >= policy.closingMinute ||
        localMinute % policy.slotMinutes || lastDate !== day ||
        lastHour * 60 + lastMinute >= policy.closingMinute ||
        (lastHour * 60 + lastMinute + 1) % policy.slotMinutes) continue;
    slots.push({ label, startsAt: new Date(time).toISOString(), endsAt: new Date(end).toISOString() });
  }
  const repeated = new Set(slots.filter((slot, i) => slots.findIndex(other => other.label === slot.label) !== i)
    .map(slot => slot.label));
  for (const slot of slots) {
    if (repeated.has(slot.label)) {
      const zone = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', timeZoneName: 'short' })
        .formatToParts(new Date(slot.startsAt)).find(part => part.type === 'timeZoneName');
      if (zone) slot.label += ' ' + zone.value;
    }
  }
  return { from: new Date(times[0]).toISOString(), to: new Date(times.at(-1)! + 15 * 60000).toISOString(), slots };
}
