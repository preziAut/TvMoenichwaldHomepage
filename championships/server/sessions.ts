import type { Actor } from '../domain/result-workflow.ts';

type Value = string | number;
type SessionDatabase = {
  prepare(sql: string): { bind(...values: Value[]): {
    first<T>(): Promise<T | null>;
    run(): Promise<{ meta: { changes: number } }>;
  } };
};

const cookieName = '__Host-championship_session';
const lifetime = 60 * 60 * 24 * 7;
const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const hash = async (token: string) => toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));

function cookieValue(request: Request) {
  const matches = (request.headers.get('Cookie') ?? '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(`${cookieName}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function cookie(token: string, maxAge: number) {
  return `${cookieName}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function championshipSessions(db: SessionDatabase, now = () => Math.floor(Date.now() / 1000)) {
  return {
    /** Call only after verifying identity through the authentication provider. */
    async issue(userId: string) {
      const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const result = await db.prepare(`INSERT INTO championship_sessions (token_hash,user_id,expires_at)
        SELECT ?,user_id,? FROM championship_memberships WHERE user_id=? AND active=1`)
        .bind(await hash(token), now() + lifetime, userId).run();
      if (result.meta.changes !== 1) throw new Error('Kein aktiver Vereinszugang.');
      return cookie(token, lifetime);
    },
    async read(request: Request): Promise<Actor | null> {
      const token = cookieValue(request);
      if (!token) return null;
      const row = await db.prepare(`SELECT u.user_id, u.role, p.id AS player_id, l.can_submit
        FROM championship_sessions s JOIN championship_memberships u ON u.user_id=s.user_id
        LEFT JOIN championship_player_links l ON l.user_id=u.user_id
        LEFT JOIN championship_players p ON p.id=l.player_id AND p.active=1
        WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`)
        .bind(await hash(token), now()).first<{ user_id: string; role: Actor['role']; player_id: string | null; can_submit: number | null }>();
      return row && { userId: row.user_id, role: row.role, active: true, playerId: row.player_id,
        canSubmit: row.player_id !== null && row.can_submit === 1 };
    },
    async revoke(request: Request) {
      const token = cookieValue(request);
      if (token) await db.prepare('DELETE FROM championship_sessions WHERE token_hash=?').bind(await hash(token)).run();
      return cookie('', 0);
    },
    async revokeAll(userId: string) {
      await db.prepare('DELETE FROM championship_sessions WHERE user_id=?').bind(userId).run();
    },
  };
}
