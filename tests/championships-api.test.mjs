import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { onRequest as competitions } from '../functions/api/meisterschaften/[[path]].ts';
import { onRequest as results } from '../functions/api/spiele/[[path]].ts';
import { championshipSessions } from '../championships/server/sessions.ts';

for (const phaseTwo of ['placement', 'knockout']) test(`API runs a championship through the ${phaseTwo} phase`, async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const file of ['0001_competition.sql', '0002_sessions.sql', '0005_contact_keys.sql']) sqlite.exec(readFileSync(
      new URL(`../championships/migrations/${file}`, import.meta.url), 'utf8'));
    const db = { prepare: sql => ({ bind: (...args) => ({
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: async () => ({ meta: sqlite.prepare(sql).run(...args) }),
      execute: () => /^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : sqlite.prepare(sql).run(...args),
    }) }), async batch(statements) {
      sqlite.exec('BEGIN');
      try { const output = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return output; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
    const origin = 'https://verein.test';
    function call(handler, path, { cookie = '', data, referer = origin } = {}) {
      return handler({ env: { DB: db }, request: new Request(`${origin}/api/${path}`, {
        method: data ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: referer, 'Content-Type': 'application/json' },
        body: data && JSON.stringify(data),
      }) });
    }
    async function ok(handler, path, options) {
      const res = await call(handler, path, options);
      const json = await res.json();
      assert.ok(res.ok, `${res.status} ${JSON.stringify(json)}`);
      return json;
    }
    sqlite.exec("INSERT INTO championship_memberships VALUES ('admin','admin',1),('one','member',1),('two','member',1)");
    const session = championshipSessions(db);
    const [admin, one, two] = await Promise.all(['admin', 'one', 'two'].map(async id => (await session.issue(id)).split(';')[0]));
    const data = { title: 'Einzel 2026', startsOn: '2026-04-01', phaseTwo, visibility: 'public' };
    assert.equal((await call(competitions, 'meisterschaften', { cookie: admin, data, referer: 'https://other.test' })).status, 403);
    assert.equal((await call(competitions, 'meisterschaften', { cookie: one, data })).status, 403);
    const tournament = await ok(competitions, 'meisterschaften', { cookie: admin, data });
    const base = `meisterschaften/${tournament.id}`;
    assert.equal((await call(competitions, base)).status, 404);
    for (const [version, firstName] of ['Erika', 'Max'].entries()) {
      await ok(competitions, `${base}/teilnehmer`, { cookie: admin, data: { version, firstName, lastName: 'Test' } });
    }
    const entrants = sqlite.prepare('SELECT id FROM championship_players ORDER BY first_name').all();
    const duplicate = await call(competitions, `${base}/teilnehmer`, { cookie: admin,
      data: { version: 2, firstName: '  ERIKA ', lastName: 'test' } });
    assert.equal(duplicate.status, 422);
    const reused = await ok(competitions, 'meisterschaften', { cookie: admin, data: { ...data, title: 'Wiederverwendung' } });
    await ok(competitions, `meisterschaften/${reused.id}/teilnehmer`, { cookie: admin, data: { version: 0, playerId: entrants[0].id } });
    assert.equal(sqlite.prepare('SELECT count(*) AS total FROM championship_players').get().total, 2);
    const link = sqlite.prepare("INSERT INTO championship_player_links (user_id,player_id,approved_by,can_submit) VALUES (?,?,'admin',1)");
    link.run('one', entrants[0].id);
    link.run('two', entrants[1].id);
    const draw = await ok(competitions, `${base}/auslosung/vorschau`, { cookie: admin, data: { version: 2, groupCount: 1 } });
    await ok(competitions, `${base}/auslosung/starten`, { cookie: admin, data: {
      version: 2, groupCount: 1, seed: draw.seed, confirm: true, publish: true, allowSubmissions: true,
    } });
    const [match] = (await ok(competitions, base)).matches;
    const score = [[6, 3], [6, 4]];
    assert.equal((await call(results, `spiele/${match.id}/ergebnis`, { data: { score, version: 0 } })).status, 401);
    await ok(results, `spiele/${match.id}/ergebnis`, { cookie: one, data: { score, version: 0 } });
    assert.equal((await ok(competitions, base)).matches[0].score, null);
    assert.equal((await call(results, `spiele/${match.id}/bestaetigen`, { cookie: one, data: { version: 1 } })).status, 403);
    await ok(results, `spiele/${match.id}/bestaetigen`, { cookie: two, data: { version: 1 } });
    const confirmed = await ok(competitions, base);
    assert.deepEqual(confirmed.matches[0].score, score);
    assert.equal(confirmed.tables[0].rows[0].wins, 1);
    const phaseData = { version: 3, qualifiers: 2 };
    const second = await ok(competitions, `${base}/folgephase/vorschau`, { cookie: admin, data: phaseData });
    if (phaseTwo === 'placement') assert.deepEqual(second.positions.map(group => group.length), [1, 1]);
    else assert.equal(second.bracket.length, 1);
    const knockoutSlots = phaseTwo === 'knockout' ? [second.bracket[0].away, second.bracket[0].home] : undefined;
    await ok(competitions, `${base}/folgephase/starten`, { cookie: admin, data: { ...phaseData, knockoutSlots, confirm: true } });
    if (phaseTwo === 'knockout') {
      const final = (await ok(competitions, base)).matches.find(item => item.phase === 2);
      assert.deepEqual([final.home, final.away], knockoutSlots);
      await ok(results, `spiele/${final.id}/ergebnis`, { cookie: admin, data: { score, version: 0 } });
      const settled = (await ok(competitions, base)).matches.find(item => item.id === final.id);
      assert.equal(settled.winner, final.home);
    }
    await ok(competitions, `${base}/abschliessen`, { cookie: admin, data: { version: 4, confirm: true } });
    assert.equal((await ok(competitions, base)).championship.status, 'finished');
  } finally { sqlite.close(); }
});
