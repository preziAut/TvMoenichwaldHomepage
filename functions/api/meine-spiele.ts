import { championshipSessions } from '../../championships/server/sessions.ts';
import type { QueryDatabase } from '../../championships/server/queries.ts';

type DB = Parameters<typeof championshipSessions>[0] & QueryDatabase;

export async function onRequest({ request, env }: { request: Request; env: { DB?: DB } }) {
  const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method !== 'GET') return reply({ error: 'Methode nicht zulässig.' }, 405);
  if (!env.DB) return reply({ error: 'Meisterschaftsdatenbank nicht verfügbar.' }, 503);
  try {
    const actor = await championshipSessions(env.DB).read(request);
    if (!actor) return reply({ error: 'Anmeldung erforderlich.' }, 401);
    if (!actor.playerId) return reply([]);
    // The DB intersection has two structural signatures for prepare. Use the read-only interface here.
    const db: QueryDatabase = env.DB;
    const { results } = await db.prepare(`SELECT m.id,m.version,m.status,m.scheduled_at,c.title,
      a.display_name AS home,b.display_name AS away,
      r.score AS proposedScore,
      CASE WHEN m.status='confirmed' THEN (SELECT json_group_array(json_array(home_games,away_games)) FROM
        (SELECT home_games,away_games FROM championship_match_sets WHERE match_id=m.id ORDER BY set_number)) END AS officialScore,
      CASE WHEN s.status='active' AND c.status IN ('groups_active','phase_active') AND c.allow_submissions=1 AND ?=1
        AND m.home IS NOT NULL AND m.away IS NOT NULL THEN
        CASE WHEN m.status='open' THEN 'submit'
          WHEN r.id IS NOT NULL AND r.submitted_by<>? AND COALESCE(r.submitted_as_player,'')<>? THEN 'review'
          WHEN m.status IN ('confirmed','submitted','disputed') THEN 'correct' END END AS action
      FROM championship_matches m JOIN championships c ON c.id=m.championship_id
      JOIN championship_stages s ON s.championship_id=m.championship_id AND s.phase=m.phase
      LEFT JOIN championship_players a ON a.id=m.home LEFT JOIN championship_players b ON b.id=m.away
      LEFT JOIN championship_submissions r ON r.match_id=m.id AND r.status='pending' AND r.match_version=m.version
      WHERE c.published=1 AND c.deleted_at IS NULL AND (m.home=? OR m.away=?) ORDER BY c.starts_on DESC,m.phase,m.round LIMIT 200`)
      .bind(Number(actor.canSubmit), actor.userId, actor.playerId, actor.playerId, actor.playerId).all();
    return reply(results);
  } catch {
    return reply({ error: 'Deine Begegnungen konnten nicht geladen werden.' }, 503);
  }
}
