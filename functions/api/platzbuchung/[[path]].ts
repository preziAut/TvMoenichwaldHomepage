import { BookingError, BookingService } from '../../../booking/src/service.ts';
import { bookingAccess, bookingMode, calendarDay } from '../../../booking/src/website.ts';
import { championshipSessions } from '../../../championships/server/sessions.ts';
import { parseBody } from '../spiele/[[path]].ts';

type Hyperdrive = { connectionString: string };
type Env = {
  DB?: Parameters<typeof championshipSessions>[0];
  BOOKING_DB?: Hyperdrive;
  BOOKING_PILOT_DB?: Hyperdrive;
  BOOKING_MOENICHWALD_MODE?: string;
  BOOKING_WALDBACH_MODE?: string;
};

const headers = { 'Cache-Control': 'private, no-store' };
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers });
const sendTo = (location: string) => new Response(null, { status: 302, headers: { ...headers, Location: location } });

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  const url = new URL(request.url);
  const match = /^\/api\/platzbuchung\/(moenichwald|waldbach)\/(start|kalender|buchungen|regeln)(?:\/([a-f0-9-]{36}))?\/?$/.exec(url.pathname);
  if (!match) return reply({ error: 'NOT_FOUND' }, 404);
  const site = match[1] === 'waldbach' ? 'waldbach' : 'moenichwald';
  const [, , action, id] = match;
  const method = request.method;
  const validMethod = action === 'buchungen' ? (id ? method === 'DELETE' : method === 'POST') :
    !id && (method === 'GET' || (action === 'regeln' && method === 'POST'));
  if (!validMethod) return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const mode = bookingMode(site === 'waldbach' ? env.BOOKING_WALDBACH_MODE : env.BOOKING_MOENICHWALD_MODE);
  if (action === 'start') {
    if (mode === 'live') return sendTo(`/platzbuchung/?standort=${site}`);
    if (site === 'moenichwald') return sendTo('https://platz.tv-moenichwald.at/');
    return sendTo('/ep3wa');
  }
  if (mode === 'legacy') return reply({ error: 'BOOKING_DISABLED' }, 404);
  const connection = mode === 'pilot' ? env.BOOKING_PILOT_DB : env.BOOKING_DB;
  if (!env.DB || !connection) return reply({ error: 'BOOKING_UNAVAILABLE' }, 503);
  if (method !== 'GET' && request.headers.get('Origin') !== url.origin) return reply({ error: 'FORBIDDEN' }, 403);
  if (method !== 'GET' && request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    return reply({ error: 'INVALID_BODY' }, 415);
  }

  try {
    const user = await championshipSessions(env.DB).read(request);
    if (!user) return reply({ error: 'LOGIN_REQUIRED' }, 401);
    const body = method === 'GET' ? {} : await parseBody(request);
    if (!body) return reply({ error: 'INVALID_BODY' }, 422);
    const { connectBookingDatabase } = await import('../../../booking/src/pages-driver.generated.mjs');
    const { database, close } = connectBookingDatabase(connection.connectionString);
    try {
      return await database.transaction(async tx => {
        const transaction = { transaction: <T>(work: (connection: typeof tx) => Promise<T>) => work(tx) };
        const { actor, role } = await bookingAccess(transaction, site, user.userId, mode === 'pilot');
        const service = new BookingService(transaction);
        if (action === 'kalender') {
          const policy = await service.getPolicy(actor);
          const { from, to, slots } = calendarDay(url.searchParams.get('tag') ?? '', policy);
          const calendar = await service.calendar(actor, from, to);
          return reply({ ...calendar, slots, policy, role, mode });
        }
        if (action === 'regeln') {
          if (method === 'GET') return reply(await service.getPolicy(actor));
          if (typeof body.revision !== 'number' || typeof body.cancellationSeconds !== 'number' ||
              typeof body.cancellationEnabled !== 'boolean') return reply({ error: 'INVALID_POLICY' }, 422);
          const current = await service.getPolicy(actor);
          return reply(await service.updatePolicy(actor, body.revision, {
            ...current, cancellationEnabled: body.cancellationEnabled, cancellationSeconds: body.cancellationSeconds,
          }));
        }
        if (id) {
          if (body.reason !== undefined && typeof body.reason !== 'string') return reply({ error: 'INVALID_BODY' }, 422);
          const result = await service.cancel(actor, id, body.reason);
          return reply({ id: result.id, state: result.state });
        }
        const { courtId, startsAt, endsAt, requestKey } = body;
        if (typeof courtId !== 'string' || typeof startsAt !== 'string' || typeof endsAt !== 'string' ||
            typeof requestKey !== 'string') return reply({ error: 'INVALID_BODY' }, 422);
        const result = await service.reserve(actor, { courtId, startsAt, endsAt, requestKey });
        return reply({ id: result.id, state: result.state }, 201);
      });
    } finally {
      await close();
    }
  } catch (error) {
    if (error instanceof BookingError) {
      const status = error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 :
        error.code.startsWith('INVALID_') ? 422 : 409;
      return reply({ error: error.code }, status);
    }
    console.error(JSON.stringify({ event: 'booking.request_failed', site, action }));
    return reply({ error: 'BOOKING_UNAVAILABLE' }, 503);
  }
}
