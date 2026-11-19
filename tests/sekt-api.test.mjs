import assert from 'node:assert/strict';
import test from 'node:test';
import { sektFixture } from './helpers/sekt-fixture.mjs';

test('a shared-contact Sekt event runs five rounds, corrections, history and completion', async () => {
  const f = await sektFixture();
  const { sqlite, ok, call, member } = f;
  try {
    const created = await ok('', { title: 'Test Sekturnier', startsOn: '2026-11-19', defaultGames: 4 });
    const path = '/' + created.id;
    let data = await ok(path);
    const post = async (action, body = {}) => {
      const result = await ok(path + '/' + action, { version: data.event.version, ...body });
      data = await ok(path);
      return result;
    };
    assert.equal((await call(path, undefined, '')).status, 404);
    assert.equal((await call(path + '/runde-vorbereiten', { version: 0 }, member)).status, 403);
    assert.equal((await call('', { title: 'No', startsOn: '2026-11-19', defaultGames: 4 }, f.admin, 'https://other.test')).status, 403);
    for (let index = 0; index < 15; index++) {
      await post('teilnehmer', { firstName: 'Teilnehmer', lastName: String(index).padStart(2, '0'), pot: index < 8 ? 1 : 2 });
    }
    const duplicate = await call(path + '/teilnehmer', { version: data.event.version, firstName: ' teilnehmer ', lastName: '00', pot: 1 });
    assert.equal(duplicate.status, 422);
    assert.equal(sqlite.prepare('SELECT count(*) AS total FROM championship_players').get().total, 15);
    const reused = await ok('', { title: 'Kontakte wiederverwenden', startsOn: '2026-11-19', defaultGames: 4 });
    await ok('/' + reused.id + '/teilnehmer', { version: 0, playerId: data.entries[0].id, pot: 1 });
    assert.equal(sqlite.prepare('SELECT count(*) AS total FROM championship_players').get().total, 15);
    let firstHelper;
    let originalPot;
    for (let number = 1; number <= 5; number++) {
      await post('runde-vorbereiten');
      const round = data.rounds.at(-1);
      const snapshot = data.players.filter(player => player.round_id === round.id);
      assert.ok(snapshot.every(player => player.helper === 0));
      if (number === 1) originalPot = snapshot.map(player => [player.player_id, player.pot]);
      else assert.deepEqual(snapshot.map(player => [player.player_id, player.pot]), originalPot);
      const helperId = snapshot.find(player => player.pot === 2).player_id;
      const players = snapshot.map(player => ({ id: player.player_id, pot: player.pot, helper: player.player_id === helperId }));
      if (number === 1) {
        const wrong = await call(path + '/runde-auslosen', { version: data.event.version, games: 4,
          players: players.map(player => ({ ...player, helper: false })) });
        assert.equal(wrong.status, 422);
      }
      await post('runde-auslosen', { games: 4, players });
      const games = data.matches.filter(match => match.round_id === round.id);
      assert.equal(games.length, 4);
      if (number === 1) {
        firstHelper = data.appearances.find(appearance => !appearance.counted);
        assert.equal((await call(path, undefined, '')).status, 200);
        assert.equal((await call(path + '/historie', undefined, member)).status, 403);
        assert.equal((await call(path + '/runde-auslosen', { version: data.event.version, games: 4, players })).status, 422);
        assert.equal((await call(path + '/runde-abschliessen', { version: data.event.version, confirm: true })).status, 422);
      }
      for (const match of games) {
        const before = data.event.version;
        await post('ergebnis', { matchId: match.id, matchVersion: 0, home: 4, away: 4 });
        assert.equal((await call(path + '/ergebnis', { version: before, matchId: match.id, matchVersion: 0, home: 4, away: 4 })).status, 422);
      }
      if (number === 1) assert.equal((await call(path + '/runde-neu', {
        version: data.event.version, confirm: true, reason: 'Andere Töpfe',
      })).status, 422);
      await post('runde-abschliessen', { confirm: true });
      assert.ok(data.standings.every(row => row.games === number * 4 && row.appearances === number));
      if (number === 1) {
        await post('einstellungen', { title: data.event.title, startsOn: data.event.starts_on, defaultGames: 6, published: true });
      }
      assert.equal(data.rounds.at(-1).games, 4);
    }
    await post('abschliessen', { confirm: true });
    assert.equal(data.event.status, 'finished');
    assert.ok(data.standings.every(row => row.games === 20 && row.rank === 1 && row.appearances === 5));
    const helperBefore = data.standings.find(row => row.player_id === firstHelper.player_id).games;
    let match = data.matches.find(match => match.id === firstHelper.match_id);
    await post('ergebnis', { matchId: match.id, matchVersion: match.version,
      home: firstHelper.team === 1 ? 3 : 4, away: firstHelper.team === 2 ? 3 : 4, reason: 'Aushilfsergebnis korrigiert' });
    assert.equal(data.standings.find(row => row.player_id === firstHelper.player_id).games, helperBefore);
    const counted = data.appearances.find(appearance => appearance.counted && appearance.player_id === firstHelper.player_id);
    match = data.matches.find(match => match.id === counted.match_id);
    await post('ergebnis', { matchId: match.id, matchVersion: match.version,
      home: counted.team === 1 ? 3 : 4, away: counted.team === 2 ? 3 : 4, reason: 'Gewertete Games korrigiert' });
    assert.equal(data.standings.find(row => row.player_id === counted.player_id).games, 19);
    const history = await ok(path + '/historie');
    assert.equal(history[0].reason, 'Gewertete Games korrigiert');
    await post('loeschen', { confirm: true });
    assert.equal((await call(path, undefined, '')).status, 404);
    await post('wiederherstellen', { confirm: true });
    assert.equal((await call(path, undefined, '')).status, 200);
  } finally { sqlite.close(); }
});

test('round snapshots, concurrent writes and failed batches preserve existing results', async () => {
  const { sqlite, ok, call } = await sektFixture();
  try {
    const event = await ok('', { title: 'Versionen', startsOn: '2026-11-19', defaultGames: 4 });
    const base = '/' + event.id;
    let data = await ok(base);
    async function post(action, input = {}) {
      await ok(base + '/' + action, { version: data.event.version, ...input });
      data = await ok(base);
    }
    for (let n = 0; n < 4; n++) await post('teilnehmer', { firstName: 'Snapshot', lastName: String(n), pot: n < 2 ? 1 : 2 });
    const draw = async () => {
      const round = data.rounds.at(-1);
      const players = data.players.filter(player => player.round_id === round.id)
        .map(player => ({ id: player.player_id, pot: player.pot, helper: false }));
      await post('runde-auslosen', { games: 4, players });
    };
    await post('runde-vorbereiten');
    await draw();
    await post('runde-neu', { confirm: true, reason: 'Neue Planung vor Spielbeginn' });
    assert.equal(data.matches.length, 0);
    await draw();
    const match = data.matches[0];
    const eventVersion = data.event.version;
    sqlite.exec("CREATE TEMP TRIGGER fail_sekt_audit BEFORE INSERT ON sekt_audit WHEN NEW.action='ergebnis' BEGIN SELECT RAISE(ABORT,'test failure'); END");
    assert.equal((await call(base + '/ergebnis', { version: eventVersion, matchId: match.id, matchVersion: 0, home: 4, away: 2 })).status, 503);
    data = await ok(base);
    assert.equal(data.event.version, eventVersion);
    assert.equal(data.matches[0].home_games, null);
    sqlite.exec('DROP TRIGGER fail_sekt_audit');
    const input = { version: eventVersion, matchId: match.id, matchVersion: 0, home: 4, away: 2 };
    const responses = await Promise.all([call(base + '/ergebnis', input), call(base + '/ergebnis', { ...input, away: 3 })]);
    assert.equal(responses.filter(response => response.ok).length, 1);
    data = await ok(base);
    assert.equal(data.event.version, eventVersion + 1);
    assert.equal(data.matches[0].version, 1);
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM sekt_audit WHERE action='ergebnis'").get().total, 1);
    await post('runde-abschliessen', { confirm: true });
    const original = data.players.map(row => [row.player_id, row.pot]);
    await post('runde-vorbereiten');
    const prepared = data.rounds.at(-1);
    const swapped = data.players.filter(player => player.round_id === prepared.id)
      .map(player => ({ id: player.player_id, pot: player.pot === 1 ? 2 : 1, helper: false }));
    await post('runde-auslosen', { games: 6, players: swapped });
    assert.deepEqual(data.players.filter(player => player.round_id !== prepared.id).map(row => [row.player_id, row.pot]), original);
    assert.equal(data.rounds[0].games, 4);
    assert.equal(data.rounds[1].games, 6);
  } finally { sqlite.close(); }
});
