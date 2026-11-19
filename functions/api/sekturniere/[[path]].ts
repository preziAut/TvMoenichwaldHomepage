import { administerSekt, listSektEvents, readSektEvent, type SektDatabase } from '../../../championships/server/sekt.ts';
import { SektInputError } from '../../../championships/domain/sekt.ts';
import { AdminInputError } from '../../../championships/server/admin.ts';
import { championshipSessions } from '../../../championships/server/sessions.ts';
import { parseBody } from '../spiele/[[path]].ts';

type Env = { DB?: SektDatabase & Parameters<typeof championshipSessions>[0] };
export async function onRequest({ request, env }: { request: Request; env: Env }) {
  const reply = (data: unknown, status = 200) => Response.json(data, {
    status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
  const url = new URL(request.url);
  const route = /^\/api\/sekturniere(?:\/([a-zA-Z0-9_-]{1,80})(?:\/([a-z-]+))?)?\/?$/.exec(url.pathname);
  if (!route) return reply({ error: 'Turnier nicht gefunden.' }, 404);
  if (!['GET', 'POST'].includes(request.method)) return reply({ error: 'Methode nicht zulässig.' }, 405);
  if (request.method === 'POST' && url.origin !== request.headers.get('Origin')) return reply({ error: 'Anfrage nicht erlaubt.' }, 403);
  if (!env.DB) return reply({ error: 'Die Vereinsdatenbank ist nicht verfügbar.' }, 503);
  const db = env.DB;
  try {
    const actor = await championshipSessions(db).read(request);
    const admin = actor?.role === 'admin' && url.searchParams.get('oeffentlich') !== '1';
    const [, id, action] = route;
    if (request.method === 'GET') {
      if (!id) return reply(await listSektEvents(db, admin));
      if (action === 'historie') {
        if (!admin) return reply({ error: 'Administratorzugang erforderlich.' }, actor ? 403 : 401);
        const history = await db.prepare(`SELECT a.id,a.action,a.round_id,a.match_id,a.previous_value,a.new_value,
          a.reason,a.created_at,COALESCE(e.email,a.actor_id) AS actor FROM sekt_audit a
          LEFT JOIN championship_member_emails e ON e.user_id=a.actor_id
          WHERE a.event_id=? ORDER BY a.rowid DESC LIMIT 200`).bind(id).all();
        return reply(history.results);
      }
      if (action) return reply({ error: 'Ansicht nicht gefunden.' }, 404);
      const event = await readSektEvent(db, id, admin);
      return event ? reply(event) : reply({ error: 'Turnier nicht gefunden oder noch nicht freigegeben.' }, 404);
    }
    if (!admin) return reply({ error: 'Administratorzugang erforderlich.' }, actor ? 403 : 401);
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'JSON erwartet.' }, 415);
    const body = await parseBody(request, 65536);
    if (!body) return reply({ error: 'Ungültige oder zu große Anfrage.' }, 422);
    if (!id) return reply(await administerSekt(db, actor!.userId, null, 'anlegen', body), 201);
    if (!action) return reply({ error: 'Aktion nicht gefunden.' }, 404);
    return reply(await administerSekt(db, actor!.userId, id, action, body));
  } catch (error) {
    if (error instanceof SektInputError || error instanceof AdminInputError) return reply({ error: error.message }, 422);
    if (error instanceof Error && error.message.includes('CHECK constraint failed: passed')) {
      return reply({ error: 'Der Turnierstand oder deine Berechtigung wurde geändert. Bitte den aktuellen Stand laden.' }, 409);
    }
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      return reply({ error: 'Dieser Kontakt oder dieser Rundeneintrag ist bereits vorhanden. Bitte den aktuellen Stand laden.' }, 409);
    }
    console.error(JSON.stringify({ event: 'sekt.request_failed', method: request.method }));
    return reply({ error: 'Turnierdaten konnten nicht verarbeitet werden.' }, 503);
  }
}
