import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/api/platzbuchung/[[path]].ts';
import { bookingAccess, calendarDay } from '../booking/src/website.ts';

const base = 'https://example.test/api/platzbuchung';
const call = (path, env = {}, options) => onRequest({ request: new Request(base + path, options), env });

test('public buttons switch independently and the pilot uses the legacy public link', async () => {
  const env = { BOOKING_MOENICHWALD_MODE: 'pilot', BOOKING_WALDBACH_MODE: 'live' };
  assert.equal((await call('/moenichwald/start', env)).headers.get('Location'), 'https://platz.tv-moenichwald.at/');
  assert.equal((await call('/waldbach/start', env)).headers.get('Location'), '/platzbuchung/?standort=waldbach');
  assert.equal((await call('/waldbach/start')).headers.get('Location'), '/ep3wa');
});

test('disabled booking, missing pilot storage and anonymous users cannot reach the calendar', async () => {
  assert.equal((await call('/waldbach/kalender')).status, 404);
  const env = { BOOKING_WALDBACH_MODE: 'pilot', DB: {} };
  assert.equal((await call('/waldbach/kalender', { ...env, BOOKING_DB: {} })).status, 503);
  assert.equal((await call('/waldbach/kalender', { ...env, BOOKING_PILOT_DB: {} })).status, 401);
  const response = await call('/waldbach/buchungen', { ...env, BOOKING_PILOT_DB: {} }, {
    method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(response.status, 403);
});

test('booking access uses the session ID, site and mode, and its own role', async () => {
  const calls = [];
  const db = { transaction: work => work({ query: async (sql, args) => {
    calls.push(args);
    return { rows: args[0] === 'waldbach' && args[1] === 'club-login' && args[2] === true ?
      [{ club_id: 'club', member_id: 'booking-member', role: 'member' }] : [] };
  } }) };
  assert.deepEqual(await bookingAccess(db, 'waldbach', 'club-login', true), {
    actor: { clubId: 'club', memberId: 'booking-member' }, role: 'member',
  });
  assert.deepEqual(calls.at(-1), ['waldbach', 'club-login', true]);
  await assert.rejects(bookingAccess(db, 'moenichwald', 'club-login', true), { message: 'FORBIDDEN' });
});

test('Vienna calendar uses policy slots and follows DST boundaries', () => {
  const policy = { openingMinute: 60, closingMinute: 240, slotMinutes: 30 };
  const summer = calendarDay('2026-03-29', policy);
  assert.deepEqual(summer.slots.map(slot => slot.label), ['01:00', '01:30', '03:00', '03:30']);
  assert.equal(Date.parse(summer.to) - Date.parse(summer.from), 23 * 3600000);
  const winter = calendarDay('2026-10-25', policy);
  assert.equal(Date.parse(winter.to) - Date.parse(winter.from), 25 * 3600000);
  assert.equal(new Set(winter.slots.map(slot => slot.label)).size, 8);
  assert.throws(() => calendarDay('2026-02-30', policy), { message: 'INVALID_TIME' });
});
