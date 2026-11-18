import { publicChampionshipReader, type QueryDatabase } from '../../../championships/server/queries.ts';
import { championshipSessions } from '../../../championships/server/sessions.ts';
import { administerChampionship, AdminInputError, type AdminDatabase } from '../../../championships/server/admin.ts';
import { managePhase } from '../../../championships/server/phase.ts';
import { parseBody } from '../spiele/[[path]].ts';

type Bindings = { DB?: QueryDatabase & AdminDatabase & Parameters<typeof championshipSessions>[0] };

export async function onRequest({ request, env }: { request: Request; env: Bindings }) {
  const reply = (value: unknown, status = 200) => Response.json(value, {
    status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
  if (request.method !== 'GET' && request.method !== 'POST') return reply({ error: 'Methode nicht zulässig.' }, 405);
  if (request.method === 'POST' && new URL(request.url).origin !== request.headers.get('Origin')) {
    return reply({ error: 'Anfrage nicht erlaubt.' }, 403);
  }
  if (!env.DB) return reply({ error: 'Die Meisterschaftsdatenbank ist noch nicht verfügbar.' }, 503);
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  try {
    const actor = await championshipSessions(env.DB).read(request);
    if (request.method === 'POST') {
      if (actor?.role !== 'admin') return reply({ error: 'Administratorzugang erforderlich.' }, actor ? 403 : 401);
      if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'JSON erwartet.' }, 415);
      const body = await parseBody(request);
      if (!body) return reply({ error: 'Ungültige Anfrage.' }, 422);
      if (path === '/api/meisterschaften') return reply(await administerChampionship(env.DB, actor.userId, null, 'anlegen', body), 201);
      const phase = /^\/api\/meisterschaften\/([a-zA-Z0-9_-]{1,80})\/(folgephase\/(?:vorschau|starten)|abschliessen)$/.exec(path);
      if (phase) return reply(await managePhase(env.DB, actor.userId, phase[1],
        phase[2].endsWith('vorschau') ? 'preview' : phase[2].endsWith('starten') ? 'start' : 'finish', body));
      const command = /^\/api\/meisterschaften\/([a-zA-Z0-9_-]{1,80})\/(loeschen|wiederherstellen|einstellungen|teilnehmer|setzliste|auslosung\/(?:vorschau|starten))$/.exec(path);
      if (!command) return reply({ error: 'Aktion nicht gefunden.' }, 404);
      return reply(await administerChampionship(env.DB, actor.userId, command[1], command[2].split('/').at(-1)!, body));
    }
    const reader = publicChampionshipReader(env.DB, actor);
    if (path === '/api/meisterschaften') return reply(await reader.list());
    if (path === '/api/meisterschaften/papierkorb') return actor?.role === 'admin' ? reply(await reader.trash()) : reply({ error: 'Administratorzugang erforderlich.' }, actor ? 403 : 401);
    const entries = /^\/api\/meisterschaften\/([a-zA-Z0-9_-]{1,80})\/teilnehmer$/.exec(path);
    if (entries && actor?.role === 'admin') {
      const db: AdminDatabase = env.DB;
      return reply((await db.prepare(`SELECT e.player_id AS id,e.seed,p.display_name FROM championship_entries e
        JOIN championship_players p ON p.id=e.player_id JOIN championships c ON c.id=e.championship_id
        WHERE e.championship_id=? AND c.deleted_at IS NULL ORDER BY e.seed IS NULL,e.seed,p.display_name`)
        .bind(entries[1]).all()).results);
    }
    const match = /^\/api\/meisterschaften\/([a-zA-Z0-9_-]{1,80})(?:\/(gruppen|tabelle|spiele))?$/.exec(path);
    if (!match) return reply({ error: 'Meisterschaft nicht gefunden.' }, 404);
    const detail = await reader.detail(match[1]);
    if (!detail) return reply({ error: 'Meisterschaft nicht gefunden.' }, 404);
    if (match[2] === 'gruppen' || match[2] === 'tabelle') return reply(detail.tables);
    if (match[2] === 'spiele') return reply(detail.matches);
    return reply(detail);
  } catch (error) {
    if (error instanceof AdminInputError) return reply({ error: error.message }, 422);
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed: championship_players.contact_key')) {
      return reply({ error: 'Diesen Kontakt gibt es bereits. Bitte den vorhandenen Kontakt auswählen.' }, 409);
    }
    if (error instanceof Error && error.message.includes('CHECK constraint failed: passed')) return reply({ error: 'Der Entwurf oder deine Berechtigung wurde geändert.' }, 409);
    return reply({ error: 'Meisterschaftsdaten konnten nicht geladen werden.' }, 503);
  }
}
