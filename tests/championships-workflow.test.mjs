import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { canReadChampionship, resultTransition } from '../championships/domain/result-workflow.ts';
import { publicChampionshipReader } from '../championships/server/queries.ts';
import { saveGroupResult } from '../championships/server/save-result.ts';

const member = id => ({ userId: `u${id}`, playerId: id, active: true, role: 'member', canSubmit: true });
const admin = { ...member('admin'), role: 'admin', playerId: null };
const match = { home: 'a', away: 'b', status: 'open', version: 2, submission: null };
const context = { phaseActive: true, submissionsOpen: true, version: 2, downstreamHasResult: false };
const score = [[6, 0], [6, 2]];

test('only permitted match participants can submit, and administrators can enter official scores', () => {
  for (const actor of [null, member('c'), { ...member('a'), canSubmit: false }, { ...member('a'), active: false }]) {
    assert.throws(() => resultTransition(actor, match, context, { kind: 'submit', score }), { status: 403 });
  }
  assert.equal(resultTransition(member('a'), match, context, { kind: 'submit', score }).status, 'submitted');
  assert.equal(resultTransition(admin, match, context, { kind: 'submit', score }).winner, 'a');
  assert.throws(() => resultTransition(member('a'), match, { ...context, version: 1 }, { kind: 'submit', score }), { status: 409 });
});

test('opponent can confirm or dispute the current submission; the author cannot approve it', () => {
  const submitted = { ...match, status: 'submitted', submission: { userId: 'ua', playerId: 'a', score, version: 2 } };
  assert.throws(() => resultTransition(member('a'), submitted, context, { kind: 'confirm' }), { status: 403 });
  assert.equal(resultTransition(member('b'), submitted, context, { kind: 'confirm' }).winner, 'a');
  assert.equal(resultTransition(member('b'), submitted, context, { kind: 'dispute' }).status, 'disputed');
  assert.throws(() => resultTransition(admin, submitted, { ...context, downstreamHasResult: true },
    { kind: 'correct', score, reason: 'Übertragungsfehler' }), { status: 409 });
});

test('visibility covers unpublished, club and public competitions', () => {
  const config = { draft: false, published: true, visibility: 'club' };
  assert.equal(canReadChampionship(null, config), false);
  assert.equal(canReadChampionship(member('a'), config), true);
  assert.equal(canReadChampionship({ ...member('a'), active: false }, config), false);
  assert.equal(canReadChampionship(null, { ...config, visibility: 'public' }), true);
  assert.equal(canReadChampionship(member('a'), { ...config, published: false }), false);
  assert.equal(canReadChampionship(admin, { ...config, published: false, draft: true }), true);
});

test('migration enforces same-group matches and the public read model hides unconfirmed data', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../championships/migrations/0001_competition.sql', import.meta.url), 'utf8'));
    db.exec(readFileSync(new URL('../championships/migrations/0006_championship_trash.sql', import.meta.url), 'utf8'));
    db.exec(`
      INSERT INTO championships (id,title,season,starts_on,phase_two) VALUES ('t','Test',2026,'2026-04-01','placement');
      INSERT INTO championship_players (id,first_name,last_name,display_name) VALUES ('a','A','Test','A'), ('b','B','Test','B'), ('c','C','Test','C');
      INSERT INTO championship_entries VALUES ('t','a',1), ('t','b',2), ('t','c',NULL);
      INSERT INTO championship_stages (championship_id,phase,kind) VALUES ('t',1,'group');
      INSERT INTO championship_groups VALUES ('t',1,1,'A'), ('t',1,2,'B');
      INSERT INTO championship_group_members VALUES ('t',1,'a',1), ('t',1,'b',1), ('t',1,'c',2);
    `);
    const putMatch = db.prepare('INSERT INTO championship_matches (id,championship_id,phase,group_position,round,home,away) VALUES (?,\'t\',1,1,1,?,?)');
    putMatch.run('match', 'a', 'b');
    assert.throws(() => putMatch.run('reversed', 'b', 'a'), /UNIQUE/);
    assert.throws(() => putMatch.run('cross-group', 'a', 'c'), /FOREIGN KEY/);
    assert.throws(() => putMatch.run('self', 'a', 'a'), /CHECK/);
    assert.throws(() => db.exec("UPDATE championship_entries SET seed=1 WHERE player_id='b'"), /UNIQUE/);
    assert.throws(() => db.exec("UPDATE championships SET published=1 WHERE id='t'"), /CHECK/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const reader = publicChampionshipReader({
      prepare: sql => ({ bind: (...args) => ({ all: async () => ({ results: db.prepare(sql).all(...args) }) }) }),
      batch: statements => Promise.all(statements.map(statement => statement.all())),
    });
    assert.equal(await reader.detail('t'), null);
    assert.deepEqual(await reader.list(), []);
    db.exec("UPDATE championships SET status='groups_active', published=1 WHERE id='t'");
    assert.equal(await reader.detail('t'), null);
    db.exec("UPDATE championships SET visibility='public' WHERE id='t'");
    assert.equal((await reader.detail('t')).matches[0].score, null);
    db.exec(`
      UPDATE championships SET allow_submissions=1 WHERE id='t';
      UPDATE championship_stages SET status='active' WHERE championship_id='t';
      INSERT INTO championship_memberships VALUES ('ua','member',1),('ub','member',1),('uadmin','admin',1);
      INSERT INTO championship_player_links (user_id,player_id,approved_by,can_submit) VALUES ('ua','a','uadmin',1),('ub','b','uadmin',1);
    `);
    const writer = {
      prepare: sql => ({ bind: (...args) => () => db.prepare(sql).run(...args) }),
      batch: async statements => {
        db.exec('BEGIN');
        try { statements.forEach(run => run()); db.exec('COMMIT'); }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    };
    const snapshot = { ...match, id: 'match', championshipId: 't', phase: 1, category: 'group', score: null, version: 0 };
    const submit = () => saveGroupResult(writer, member('a'), snapshot, { ...context, version: 0 }, { kind: 'submit', score });
    await submit();
    await assert.rejects(submit, /CHECK/);
    assert.equal((await reader.detail('t')).matches[0].score, null);
    const pending = { ...snapshot, status: 'submitted', version: 1, submission: { userId: 'ua', playerId: 'a', score, version: 1 } };
    const confirm = () => saveGroupResult(writer, member('b'), pending, { ...context, version: 1 }, { kind: 'confirm' });
    db.exec("UPDATE championship_player_links SET can_submit=0 WHERE user_id='ub'");
    await assert.rejects(confirm, /CHECK/);
    db.exec("UPDATE championship_player_links SET can_submit=1 WHERE user_id='ub'");
    await confirm();
    assert.equal(db.prepare('SELECT count(*) AS count FROM championship_result_audit').get().count, 2);
    const detail = await reader.detail('t');
    assert.deepEqual(detail.matches[0].score, score);
    assert.deepEqual(detail.tables[0].rows.map(row => [row.id, row.rank, row.wins]), [['a', 1, 1], ['b', 2, 0]]);
  } finally {
    db.close();
  }
});
