import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { championshipSessions } from '../championships/server/sessions.ts';

test('sessions store only a digest, expire and remain revoked after account reactivation', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const migration of ['0001_competition.sql', '0002_sessions.sql']) {
      sqlite.exec(readFileSync(new URL(`../championships/migrations/${migration}`, import.meta.url), 'utf8'));
    }
    sqlite.exec("INSERT INTO championship_memberships VALUES ('test','member',1)");
    const db = { prepare: sql => ({ bind: (...args) => ({
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      run: async () => ({ meta: sqlite.prepare(sql).run(...args) }),
    }) }) };
    let now = 100;
    const sessions = championshipSessions(db, () => now);
    const header = await sessions.issue('test');
    const cookie = header.split(';')[0];
    assert.match(header, /; HttpOnly; Secure; SameSite=Lax$/);
    const token = cookie.split('=')[1];
    const saved = sqlite.prepare('SELECT token_hash FROM championship_sessions').get().token_hash;
    const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
    assert.equal(saved, digest);
    assert.notEqual(saved, token);
    const request = new Request('https://verein.test/', { headers: { Cookie: cookie } });
    assert.equal((await sessions.read(request)).userId, 'test');
    assert.equal(await sessions.read(new Request(request.url, { headers: { Cookie: cookie.replace(token, saved) } })), null);
    now += 604800;
    assert.equal(await sessions.read(request), null);
    now = 100;
    sqlite.exec("UPDATE championship_memberships SET active=0 WHERE user_id='test'");
    await assert.rejects(() => sessions.issue('test'));
    sqlite.exec("UPDATE championship_memberships SET active=1 WHERE user_id='test'");
    assert.equal(await sessions.read(request), null);
    const renewed = new Request(request.url, { headers: { Cookie: (await sessions.issue('test')).split(';')[0] } });
    assert.match(await sessions.revoke(renewed), /Max-Age=0/);
    assert.equal(await sessions.read(renewed), null);
  } finally { sqlite.close(); }
});
