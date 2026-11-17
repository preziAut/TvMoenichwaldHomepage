import type { BetterAuthOptions } from 'better-auth';
import { digest, identity } from '../../../championships/server/identity.ts';
import { world4youEmail } from '../../../championships/server/email.ts';
import { championshipSessions } from '../../../championships/server/sessions.ts';
import { parseBody } from '../spiele/[[path]].ts';
import { validateAdminPassword } from '../../../championships/server/admin-password.ts';

type DB = Parameters<typeof championshipSessions>[0];
type Env = { DB?: DB; CHAMPIONSHIP_ORIGIN?: string; CHAMPIONSHIP_AUTH_SECRET?: string; CHAMPIONSHIP_SMTP_USER?: string; CHAMPIONSHIP_SMTP_PASSWORD?: string };
const validMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  const url = new URL(request.url);
  const reply = (value: unknown, status = 200, cookie?: string) => {
    const headers = new Headers({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
    if (cookie) headers.set('Set-Cookie', cookie);
    return Response.json(value, { status, headers });
  };
  if (request.method !== 'POST') return reply({ error: 'Methode nicht zulässig.' }, 405);
  if (request.headers.get('Origin') !== url.origin || url.origin !== env.CHAMPIONSHIP_ORIGIN || url.protocol !== 'https:') {
    return reply({ error: 'Anfrage nicht erlaubt.' }, 403);
  }
  if (!env.DB) return reply({ error: 'Anmeldung nicht verfügbar.' }, 503);
  const db = env.DB;
  const sessions = championshipSessions(db);
  const action = url.pathname.replace(/\/$/, '').split('/').at(-1);
  if (action === 'abmelden') return reply({ ok: true }, 200, await sessions.revoke(request));
  if (!['link', 'bestaetigen', 'einladen', 'passwort'].includes(action ?? '')) return reply({ error: 'Aktion nicht gefunden.' }, 404);
  if (!env.CHAMPIONSHIP_AUTH_SECRET || env.CHAMPIONSHIP_AUTH_SECRET.length < 32) return reply({ error: 'Anmeldung nicht verfügbar.' }, 503);
  if (action !== 'passwort' && (!env.CHAMPIONSHIP_SMTP_USER || !env.CHAMPIONSHIP_SMTP_PASSWORD)) {
    return reply({ error: 'Anmeldung per E-Mail nicht verfügbar.' }, 503);
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'JSON erwartet.' }, 415);
  const body = await parseBody(request);
  if (!body) return reply({ error: 'Ungültige Anfrage.' }, 422);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  try {
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / 600);
    const bucket = async (key: string, limit: number) => (await db.prepare(`INSERT INTO championship_login_limits
      (bucket,window,count) VALUES (?,?,1) ON CONFLICT (bucket,window) DO UPDATE SET count=count+1 WHERE count<?`)
      .bind(await digest(`${env.CHAMPIONSHIP_AUTH_SECRET}:${key}`), window, limit).run()).meta.changes === 1;
    if (!await bucket(`ip:${ip}`, 20)) return reply({ error: 'Zu viele Anfragen. Bitte warte einige Minuten.' }, 429);
    await db.prepare('DELETE FROM championship_login_limits WHERE window<?').bind(window - 2).run();
    if (action === 'passwort') {
      if (!validMail.test(email) || email.length > 254 || typeof body.password !== 'string') {
        return reply({ error: 'E-Mail-Adresse und Passwort eingeben.' }, 422);
      }
      if (!await bucket(`admin-password:${email}`, 6)) return reply({ error: 'Zu viele Anfragen. Bitte warte einige Minuten.' }, 429);
      const record = await db.prepare(`SELECT m.user_id,p.salt,p.password_hash FROM championship_admin_passwords p
        JOIN championship_memberships m ON m.user_id=p.user_id JOIN championship_member_emails e ON e.user_id=m.user_id
        WHERE e.email=? AND m.active=1 AND m.role='admin'`).bind(email)
        .first<{ user_id: string; salt: string; password_hash: string }>();
      if (!await validateAdminPassword(body.password, record ?? undefined) || !record) {
        return reply({ error: 'E-Mail-Adresse oder Passwort ist ungültig.' }, 401);
      }
      await sessions.revoke(request);
      return reply({ ok: true }, 200, await sessions.issue(record.user_id));
    }
    const { connect } = await import('cloudflare:sockets');
    const auth = await identity(db as BetterAuthOptions['database'], url.origin, env.CHAMPIONSHIP_AUTH_SECRET,
      world4youEmail(connect, { username: env.CHAMPIONSHIP_SMTP_USER!, password: env.CHAMPIONSHIP_SMTP_PASSWORD! }));
    if (action === 'bestaetigen') {
      if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) return reply({ error: 'Ungültiger Anmeldelink.' }, 422);
      let verified;
      try { verified = await auth.api.magicLinkVerify({ query: { token: body.token }, headers: request.headers }); }
      catch { return reply({ error: 'Der Anmeldelink ist abgelaufen oder bereits verwendet.' }, 401); }
      if (!verified?.user?.emailVerified || !verified.token) return reply({ error: 'Kein gültiger Anmeldelink.' }, 401);
      await db.prepare('DELETE FROM session WHERE token=?').bind(await digest(verified.token)).run();
      const account = await db.prepare(`SELECT m.user_id FROM championship_member_emails e
        JOIN championship_memberships m ON m.user_id=e.user_id WHERE e.email=? AND m.active=1`)
        .bind(verified.user.email.toLowerCase()).first<{ user_id: string }>();
      if (!account) return reply({ error: 'Kein aktiver Vereinszugang.' }, 403);
      await sessions.revoke(request);
      return reply({ ok: true }, 200, await sessions.issue(account.user_id));
    }
    if (!validMail.test(email) || email.length > 254) return reply({ error: 'Gültige E-Mail-Adresse erforderlich.' }, 422);
    if (!await bucket(`email:${email}`, 4)) return reply({ ok: true });
    if (action === 'einladen') {
      const actor = await sessions.read(request);
      if (actor?.role !== 'admin') return reply({ error: 'Administratorzugang erforderlich.' }, actor ? 403 : 401);
      // Pre-create only the local role. Better Auth verifies the address on first sign-in.
      const existing = await db.prepare('SELECT user_id FROM championship_member_emails WHERE email=?').bind(email).first();
      if (!existing) {
        const id = crypto.randomUUID();
        await db.prepare(`INSERT INTO championship_invite_requests (id,email,invited_by)
          SELECT ?,?,user_id FROM championship_memberships WHERE user_id=? AND active=1 AND role='admin'`)
          .bind(id, email, actor.userId).run();
      }
    }
    const allowed = await db.prepare(`SELECT e.email FROM championship_member_emails e JOIN championship_memberships m
      ON m.user_id=e.user_id WHERE e.email=? AND m.active=1`).bind(email).first();
    if (allowed) await auth.api.signInMagicLink({ body: { email }, headers: request.headers });
    return reply({ ok: true });
  } catch {
    return reply({ error: 'Die Anmeldung konnte gerade nicht verarbeitet werden.' }, 503);
  }
}
