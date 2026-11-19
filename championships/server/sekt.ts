import { prepareParticipant, type AdminStatement } from './admin.ts';
import { drawSektRound, rejectSekt, validateGames, validateSektResult, type RoundPlayer } from '../domain/sekt.ts';

type Value = string | number | null;
export interface SektDatabase {
  prepare(sql: string): { bind(...values: Value[]): AdminStatement };
  batch<T = unknown>(statements: AdminStatement[]): Promise<{ results: T[] }[]>;
}
type Event = { id: string; title: string; starts_on: string; default_games: number; status: 'draft' | 'active' | 'finished';
  published: number; version: number; deleted_at: string | null };
type Round = { id: string; number: number; games: number; status: 'prepared' | 'active' | 'closed' };
export type SektRow = { player_id: string; name: string; games: number; appearances: number; rank: number };
const text = (value: unknown, length: number) =>
  typeof value === 'string' && value.trim().length <= length ? value.trim() : '';

export async function listSektEvents(db: SektDatabase, admin: boolean) {
  return (await db.prepare(`SELECT id,title,starts_on,status${admin ? ',version,published,deleted_at' : ''}
    FROM sekt_events WHERE ${admin ? '1=1' : "published=1 AND deleted_at IS NULL AND status<>'draft'"}
    ORDER BY starts_on DESC,created_at DESC LIMIT 100`).bind().all()).results;
}

export async function readSektEvent(db: SektDatabase, id: string, admin: boolean) {
  const eligible = `SELECT id FROM sekt_events WHERE id=? ${admin ? '' : "AND published=1 AND deleted_at IS NULL AND status<>'draft'"}`;
  const statements = [
    `SELECT id,title,starts_on,default_games,status,version${admin ? ',published,deleted_at' : ''} FROM sekt_events WHERE id IN (${eligible})`,
    `SELECT p.id,p.display_name AS name,e.pot FROM sekt_entries e JOIN championship_players p ON p.id=e.player_id
      WHERE event_id IN (${eligible}) ORDER BY p.display_name,p.id`,
    `SELECT id,number,games,status FROM sekt_rounds WHERE event_id IN (${eligible}) ORDER BY number`,
    `SELECT rp.round_id,rp.player_id,rp.pot,rp.helper FROM sekt_round_players rp WHERE rp.event_id IN (${eligible}) ORDER BY player_id`,
    `SELECT m.id,m.round_id,m.position,m.home_games,m.away_games,m.version FROM sekt_matches m
      JOIN sekt_rounds r ON r.id=m.round_id WHERE r.event_id IN (${eligible}) ORDER BY r.number,m.position`,
    `SELECT a.match_id,a.player_id,a.team,a.counted FROM sekt_appearances a
      JOIN sekt_rounds r ON r.id=a.round_id WHERE r.event_id IN (${eligible}) ORDER BY a.team,a.player_id`,
    `SELECT p.id AS player_id,p.display_name AS name,COALESCE(SUM(CASE WHEN a.counted=1 AND m.home_games IS NOT NULL
      THEN CASE a.team WHEN 1 THEN m.home_games ELSE m.away_games END ELSE 0 END),0) AS games,
      SUM(CASE WHEN a.counted=1 AND m.home_games IS NOT NULL THEN 1 ELSE 0 END) AS appearances
      FROM sekt_entries e JOIN championship_players p ON p.id=e.player_id
      LEFT JOIN sekt_appearances a ON a.player_id=e.player_id AND a.round_id IN (SELECT id FROM sekt_rounds WHERE event_id=e.event_id)
      LEFT JOIN sekt_matches m ON m.id=a.match_id WHERE e.event_id IN (${eligible})
      GROUP BY p.id,p.display_name ORDER BY games DESC,p.display_name,p.id`,
  ].map(sql => db.prepare(sql).bind(id));
  const rows = await db.batch<unknown>(statements);
  const event = rows[0].results[0] as Event | undefined;
  if (!event) return null;
  const standings = rows[6].results as SektRow[];
  let rank = 1;
  standings.forEach((row, index) => {
    if (index === 0 || row.games !== standings[index - 1].games) rank = index + 1;
    row.rank = rank;
  });
  return { event, canManage: admin, entries: rows[1].results, rounds: rows[2].results, players: rows[3].results,
    matches: rows[4].results, appearances: rows[5].results, standings };
}

export async function administerSekt(db: SektDatabase, actorId: string, id: string | null,
  action: string, body: Record<string, unknown>) {
  const statement = (sql: string, ...values: Value[]) => db.prepare(sql).bind(...values);
  const guard = crypto.randomUUID();
  const audit = (eventId: string, previous: unknown, next: unknown, roundId: string | null = null, matchId: string | null = null) =>
    statement(`INSERT INTO sekt_audit (id,event_id,round_id,match_id,actor_id,action,previous_value,new_value,reason)
      VALUES (?,?,?,?,?,?,?,?,?)`, crypto.randomUUID(), eventId, roundId, matchId, actorId, action,
    previous === null ? null : JSON.stringify(previous), JSON.stringify(next), text(body.reason, 500));
  const checkAdmin = "EXISTS (SELECT 1 FROM championship_memberships WHERE user_id=? AND role='admin' AND active=1)";
  const validateSettings = () => {
    const title = text(body.title, 120);
    const startsOn = text(body.startsOn, 10);
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) ||
        !Number.isFinite(Date.parse(startsOn)) || new Date(startsOn).toISOString().slice(0, 10) !== startsOn) {
      rejectSekt('Titel und gültiges Datum eingeben.');
    }
    return { title, startsOn, games: validateGames(body.defaultGames) };
  };
  if (action === 'anlegen') {
    const settings = validateSettings();
    const eventId = crypto.randomUUID();
    await db.batch([
      statement(`INSERT INTO championship_write_preconditions SELECT ?,${checkAdmin}`, guard, actorId),
      statement('INSERT INTO sekt_events (id,title,starts_on,default_games) VALUES (?,?,?,?)',
        eventId, settings.title, settings.startsOn, settings.games),
      audit(eventId, null, settings),
      statement('DELETE FROM championship_write_preconditions WHERE id=?', guard),
    ]);
    return { id: eventId, version: 0 };
  }
  const event = await statement('SELECT * FROM sekt_events WHERE id=?', id).first<Event>();
  if (!event || event.version !== body.version || (event.deleted_at && action !== 'wiederherstellen')) {
    rejectSekt('Das Turnier wurde geändert. Bitte den aktuellen Stand laden.');
  }
  const eventId = event!.id;
  const rounds = (await statement('SELECT id,number,games,status FROM sekt_rounds WHERE event_id=? ORDER BY number', eventId)
    .all<Round>()).results;
  const current = rounds.at(-1);
  const batch: AdminStatement[] = [
    statement(`INSERT INTO championship_write_preconditions SELECT ?,EXISTS (
      SELECT 1 FROM sekt_events WHERE id=? AND version=? AND deleted_at IS ?) AND ${checkAdmin}`,
    guard, eventId, event!.version, event!.deleted_at, actorId),
  ];
  let previous: unknown = event;
  let next: unknown = body;
  let roundId: string | null = null;
  let matchId: string | null = null;
  if (action === 'einstellungen') {
    const settings = validateSettings();
    if (typeof body.published !== 'boolean') rejectSekt('Sichtbarkeit prüfen.');
    if (event!.status === 'draft' && body.published) rejectSekt('Das Turnier wird nach der ersten Auslosung freigegeben.');
    batch.push(statement('UPDATE sekt_events SET title=?,starts_on=?,default_games=?,published=? WHERE id=?',
      settings.title, settings.startsOn, settings.games, Number(body.published), eventId));
  } else if (action === 'loeschen' || action === 'wiederherstellen') {
    if (body.confirm !== true) rejectSekt('Die Aktion muss bestätigt werden.');
    batch.push(statement(`UPDATE sekt_events SET deleted_at=${action === 'loeschen' ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE id=?`, eventId));
  } else if (action === 'teilnehmer' || action === 'entfernen') {
    if (event!.status !== 'draft' || rounds.some(round => round.status !== 'prepared')) {
      rejectSekt('Teilnehmende können bis zur ersten Auslosung geändert werden.');
    }
    if (current) rejectSekt('Bitte zuerst die vorbereitete Runde verwerfen.');
    if (action === 'entfernen') {
      const playerId = text(body.playerId, 80);
      if (!await statement('SELECT player_id FROM sekt_entries WHERE event_id=? AND player_id=?', eventId, playerId).first()) {
        rejectSekt('Diese Person nimmt nicht teil.');
      }
      batch.push(statement('DELETE FROM sekt_entries WHERE event_id=? AND player_id=?', eventId, playerId));
    } else {
      if (body.pot !== 1 && body.pot !== 2) rejectSekt('Topf 1 oder Topf 2 auswählen.');
      const contact = await prepareParticipant(db, body);
      if (await statement('SELECT player_id FROM sekt_entries WHERE event_id=? AND player_id=?', eventId, contact.playerId).first()) {
        rejectSekt('Diese Person nimmt bereits teil.');
      }
      batch.push(...contact.statements, statement('INSERT INTO sekt_entries (event_id,player_id,pot) VALUES (?,?,?)',
        eventId, contact.playerId, body.pot as number));
      next = { playerId: contact.playerId, pot: body.pot };
    }
  } else if (action === 'runde-vorbereiten') {
    if (event!.status === 'finished' || (current && current.status !== 'closed')) {
      rejectSekt('Bitte zuerst die aktuelle Runde abschließen.');
    }
    const entries = (await statement('SELECT player_id,pot FROM sekt_entries WHERE event_id=?', eventId)
      .all<{ player_id: string; pot: number }>()).results;
    if (entries.length < 4) rejectSekt('Mindestens vier Teilnehmende erforderlich.');
    roundId = crypto.randomUUID();
    const games = current?.games ?? event!.default_games;
    batch.push(statement('INSERT INTO sekt_rounds (id,event_id,number,games) VALUES (?,?,?,?)',
      roundId, eventId, (current?.number ?? 0) + 1, games));
    batch.push(current
      ? statement(`INSERT INTO sekt_round_players (event_id,round_id,player_id,pot)
        SELECT event_id,?,player_id,pot FROM sekt_round_players WHERE round_id=?`, roundId, current.id)
      : statement(`INSERT INTO sekt_round_players (event_id,round_id,player_id,pot)
        SELECT event_id,?,player_id,pot FROM sekt_entries WHERE event_id=?`, roundId, eventId));
    next = { roundId, games, number: (current?.number ?? 0) + 1 };
  } else if (action === 'runde-auslosen') {
    if (!current || current.status !== 'prepared' || event!.status === 'finished') rejectSekt('Keine vorbereitete Runde vorhanden.');
    roundId = current!.id;
    const games = validateGames(body.games);
    const expected = (await statement('SELECT player_id FROM sekt_round_players WHERE round_id=?', roundId)
      .all<{ player_id: string }>()).results.map(row => row.player_id);
    const players = body.players;
    if (!Array.isArray(players) || players.length !== expected.length ||
        players.some(player => !player || typeof player !== 'object' || !expected.includes(player.id))) {
      rejectSekt('Alle Teilnehmenden müssen genau einem Topf zugeordnet sein.');
    }
    const fixtures = drawSektRound(players as RoundPlayer[]).map(match => ({ ...match, id: crypto.randomUUID() }));
    batch.push(
      statement(`UPDATE sekt_round_players SET pot=(SELECT value->>'pot' FROM json_each(?) WHERE value->>'id'=player_id),
        helper=(SELECT value->>'helper' FROM json_each(?) WHERE value->>'id'=player_id) WHERE round_id=?`,
      JSON.stringify(players), JSON.stringify(players), roundId),
      statement("UPDATE sekt_rounds SET games=?,status='active' WHERE id=?", games, roundId),
      statement(`INSERT INTO sekt_matches (id,round_id,position) SELECT value->>'id',?,value->>'position' FROM json_each(?)`,
        roundId, JSON.stringify(fixtures)),
      statement(`INSERT INTO sekt_appearances (round_id,match_id,player_id,team,counted)
        SELECT ?,m.value->>'id',p.value->>'playerId',p.value->>'team',p.value->>'counted'
        FROM json_each(?) m,json_each(m.value->>'players') p`, roundId, JSON.stringify(fixtures)),
      statement("UPDATE sekt_events SET status='active',published=1 WHERE id=?", eventId),
    );
    previous = { round: current };
    next = { games, players, fixtures };
  } else if (action === 'runde-verwerfen' || action === 'runde-neu') {
    if (!current || current.status === 'closed' || event!.status === 'finished') rejectSekt('Diese Runde kann nicht neu vorbereitet werden.');
    roundId = current!.id;
    if (body.confirm !== true || !text(body.reason, 500)) rejectSekt('Bitte bestätige die Änderung und gib einen Grund an.');
    if (await statement('SELECT id FROM sekt_matches WHERE round_id=? AND home_games IS NOT NULL LIMIT 1', roundId).first()) {
      rejectSekt('Diese Runde enthält Ergebnisse und darf nicht neu ausgelost werden.');
    }
    const appearances = (await statement('SELECT * FROM sekt_appearances WHERE round_id=?', roundId).all()).results;
    previous = { round: current, appearances };
    batch.push(statement('DELETE FROM sekt_matches WHERE round_id=?', roundId));
    if (action === 'runde-verwerfen') {
      batch.push(statement('DELETE FROM sekt_round_players WHERE round_id=?', roundId),
        statement('DELETE FROM sekt_rounds WHERE id=?', roundId));
    } else {
      batch.push(statement("UPDATE sekt_rounds SET status='prepared' WHERE id=?", roundId),
        statement('UPDATE sekt_round_players SET helper=0 WHERE round_id=?', roundId));
    }
  } else if (action === 'ergebnis') {
    const match = await statement(`SELECT m.*,r.games,r.status AS round_status FROM sekt_matches m
      JOIN sekt_rounds r ON r.id=m.round_id WHERE m.id=? AND r.event_id=?`, text(body.matchId, 80), eventId)
      .first<{ id: string; round_id: string; version: number; games: number; home_games: number | null; away_games: number | null }>();
    if (!match || match.version !== body.matchVersion) rejectSekt('Diese Partie wurde geändert. Bitte den aktuellen Stand laden.');
    validateSektResult(body.home, body.away, match!.games);
    if (match!.home_games !== null && !text(body.reason, 500)) rejectSekt('Für eine Ergebniskorrektur ist ein Kommentar erforderlich.');
    if (match!.home_games === null && event!.status === 'finished') rejectSekt('Das Turnier ist bereits abgeschlossen.');
    roundId = match!.round_id;
    matchId = match!.id;
    previous = { home: match!.home_games, away: match!.away_games, version: match!.version };
    next = { home: body.home, away: body.away, version: match!.version + 1 };
    batch.push(statement('UPDATE sekt_matches SET home_games=?,away_games=?,version=version+1 WHERE id=?',
      body.home as number, body.away as number, matchId));
  } else if (action === 'runde-abschliessen') {
    if (!current || current.status !== 'active' || body.confirm !== true) rejectSekt('Die aktive Runde muss bestätigt werden.');
    roundId = current!.id;
    if (await statement('SELECT id FROM sekt_matches WHERE round_id=? AND home_games IS NULL LIMIT 1', roundId).first()) {
      rejectSekt('Bitte zuerst alle Endergebnisse der Runde eintragen.');
    }
    batch.push(statement("UPDATE sekt_rounds SET status='closed' WHERE id=?", roundId));
  } else if (action === 'abschliessen') {
    if (!current || current.status !== 'closed' || event!.status !== 'active' || body.confirm !== true) {
      rejectSekt('Alle Runden müssen vor dem Turnierabschluss beendet sein.');
    }
    batch.push(statement("UPDATE sekt_events SET status='finished' WHERE id=?", eventId));
  } else rejectSekt('Aktion nicht verfügbar.');
  batch.push(
    audit(eventId, previous, next, roundId, matchId),
    statement('UPDATE sekt_events SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?', eventId),
    statement('DELETE FROM championship_write_preconditions WHERE id=?', guard),
  );
  await db.batch(batch);
  return { id: eventId, version: event!.version + 1, roundId };
}
