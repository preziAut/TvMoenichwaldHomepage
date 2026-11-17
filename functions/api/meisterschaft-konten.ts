import { championshipSessions } from '../../championships/server/sessions.ts';
import { parseBody } from './spiele/[[path]].ts';

type SessionDB = Parameters<typeof championshipSessions>[0];
type Statement = ReturnType<ReturnType<SessionDB['prepare']>['bind']>;
type DB = { prepare(sql: string): { bind(...values: (string | number)[]): Statement & { all(): Promise<{ results: unknown[] }> } } };

export async function onRequest({ request, env }: { request: Request; env: { DB?: DB } }) {
  const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const db = env.DB;
  if (!db) return reply({ error: 'Meisterschaftsdatenbank nicht verfügbar.' }, 503);
  try {
    const actor = await championshipSessions(db).read(request);
    if (actor?.role !== 'admin') return reply({ error: 'Administratorzugang erforderlich.' }, actor ? 403 : 401);
    if (request.method === 'GET') {
      const [accounts, players] = await Promise.all([
        db.prepare(`SELECT e.email, m.active, m.role, u.emailVerified AS verified, l.player_id, l.can_submit
          FROM championship_member_emails e JOIN championship_memberships m ON m.user_id=e.user_id
          LEFT JOIN user u ON u.email=e.email LEFT JOIN championship_player_links l ON l.user_id=e.user_id
          ORDER BY e.email LIMIT 500`).bind().all(),
        db.prepare('SELECT id,display_name,active FROM championship_players ORDER BY display_name LIMIT 500').bind().all(),
      ]);
      return reply({ accounts: accounts.results, players: players.results });
    }
    if (request.method !== 'POST') return reply({ error: 'Methode nicht zulässig.' }, 405);
    if (request.headers.get('Origin') !== new URL(request.url).origin) return reply({ error: 'Anfrage nicht erlaubt.' }, 403);
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'JSON erwartet.' }, 415);
    const body = await parseBody(request);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!body || !email || email.length > 254) return reply({ error: 'Ungültige Eingabe.' }, 422);
    const guard = "EXISTS (SELECT 1 FROM championship_memberships a WHERE a.user_id=? AND a.role='admin' AND a.active=1)";
    let result;
    if (body.action === 'link' && typeof body.playerId === 'string' && typeof body.canSubmit === 'boolean') {
      result = await db.prepare(`INSERT INTO championship_player_links (user_id,player_id,approved_by,can_submit)
        SELECT e.user_id,p.id,?,? FROM championship_member_emails e JOIN user u ON u.email=e.email
        JOIN championship_memberships m ON m.user_id=e.user_id JOIN championship_players p ON p.id=?
        WHERE e.email=? AND p.active=1 AND u.emailVerified=1 AND m.active=1 AND ${guard}
        ON CONFLICT(user_id) DO UPDATE SET player_id=excluded.player_id,approved_by=excluded.approved_by,
          verified_at=CURRENT_TIMESTAMP,can_submit=excluded.can_submit`)
        .bind(actor.userId, Number(body.canSubmit), body.playerId, email, actor.userId).run();
    } else if (body.action === 'account' && typeof body.active === 'boolean') {
      result = await db.prepare(`UPDATE championship_memberships SET active=? WHERE role='member' AND
        user_id=(SELECT user_id FROM championship_member_emails WHERE email=?) AND ${guard}`)
        .bind(Number(body.active), email, actor.userId).run();
    } else return reply({ error: 'Ungültige Aktion.' }, 422);
    return result.meta.changes === 1 ? reply({ ok: true }) : reply({ error: 'Kein verifiziertes Konto, kein aktiver Spieler oder fehlende Berechtigung.' }, 409);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) return reply({ error: 'Dieser Spieler ist bereits verknüpft.' }, 409);
    return reply({ error: 'Konten konnten nicht verarbeitet werden.' }, 503);
  }
}
