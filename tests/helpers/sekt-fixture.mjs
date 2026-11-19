import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../../functions/api/sekturniere/[[path]].ts';
import { championshipSessions } from '../../championships/server/sessions.ts';

export async function sektFixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../championships/migrations/', import.meta.url)).sort()) {
    if (file.endsWith('.sql')) sqlite.exec(readFileSync(new URL(`../../championships/migrations/${file}`, import.meta.url), 'utf8'));
  }
  const db = { prepare: sql => ({ bind: (...args) => ({
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => ({ meta: sqlite.prepare(sql).run(...args) }),
    execute: () => /^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : sqlite.prepare(sql).run(...args),
  }) }), async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  sqlite.exec("INSERT INTO championship_memberships VALUES ('sekt-admin','admin',1),('sekt-member','member',1)");
  const sessions = championshipSessions(db);
  const admin = (await sessions.issue('sekt-admin')).split(';')[0];
  const member = (await sessions.issue('sekt-member')).split(';')[0];
  const origin = 'https://club.test';
  const call = (path = '', body, cookie = admin, requestOrigin = origin) => onRequest({
    env: { DB: db }, request: new Request(origin + '/api/sekturniere' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Cookie: cookie, Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    }),
  });
  async function ok(path = '', body, cookie = admin) {
    const response = await call(path, body, cookie);
    const json = await response.json();
    assert.ok(response.ok, `${response.status} ${JSON.stringify(json)}`);
    return json;
  }
  return { sqlite, db, admin, member, call, ok };
}
