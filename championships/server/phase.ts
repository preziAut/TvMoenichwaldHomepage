import { placementGroups, roundRobin, standings, type OfficialMatch } from '../domain/competition.ts';
import { createKnockout } from '../domain/knockout.ts';
import { AdminInputError, type AdminDatabase } from './admin.ts';

type PhaseMatch = { id: string; status: string; version: number; group_position: number; home: string; away: string; score: string };

export async function managePhase(db: AdminDatabase, actor: string, id: string, action: 'preview' | 'start' | 'finish', data: Record<string, unknown>) {
  const q = (sql: string, ...bindings: (string | number | null)[]) => db.prepare(sql).bind(...bindings);
  const tournament = await q('SELECT status,phase_two,version FROM championships WHERE id=? AND deleted_at IS NULL', id)
    .first<{ status: string; phase_two: 'placement' | 'knockout'; version: number }>();
  const phase = action === 'finish' ? 2 : 1;
  if (!tournament || tournament.status !== (phase === 2 ? 'phase_active' : 'groups_active') || tournament.version !== data.version) {
    throw new AdminInputError('Die Turnierphase ist nicht aktiv oder wurde geändert.');
  }
  const matches = (await q(`SELECT id,status,version,group_position,home,away,
      (SELECT json_group_array(json_array(home_games,away_games)) FROM
        (SELECT home_games,away_games FROM championship_match_sets WHERE match_id=m.id ORDER BY set_number)) AS score
      FROM championship_matches m WHERE championship_id=? AND phase=?`, id, phase).all<PhaseMatch>()).results;
  if ((!matches.length && (phase === 1 || tournament.phase_two === 'knockout')) ||
      matches.some(match => !['confirmed', 'completed'].includes(match.status))) {
    throw new AdminInputError('Alle Begegnungen dieser Phase müssen bestätigt sein.');
  }
  const groups = (await q(`SELECT group_position, player_id, display_name FROM championship_group_members
    JOIN championship_players p ON p.id=player_id WHERE championship_id=? AND phase=? ORDER BY group_position, player_id`, id, phase)
    .all<{ group_position: number; player_id: string; display_name: string }>()).results;
  const rankings = [...new Set(groups.map(group => group.group_position))].map(position => {
    const players = groups.filter(group => group.group_position === position).map(group => group.player_id);
    const games = matches.filter(match => match.group_position === position).map(match => ({
      home: match.home, away: match.away, score: JSON.parse(match.score),
    }) as OfficialMatch);
    return standings(players, games);
  });
  const ordered = rankings.map(group => group.map(row => row.id));
  const ties = rankings.flatMap((group, index) => [...new Set(group.filter(row => row.tied).map(row => row.rank))].map(rank => ({
    group: index, rank, players: group.filter(row => row.rank === rank).map(row => row.id),
  })));
  const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
  if (ties.length) {
    const order = data.tieOrder;
    if (!Array.isArray(order) || new Set(order).size !== order.length || !reason || reason.length > 500 ||
      ties.some(tie => tie.players.some(player => !order.includes(player)))) {
      throw new AdminInputError('Ein Ranggleichstand braucht eine vollständige Reihenfolge und Begründung.');
    }
    for (const tie of ties) ordered[tie.group].splice(tie.rank - 1, tie.players.length, ...tie.players.toSorted((a, b) => order.indexOf(a) - order.indexOf(b)));
  }
  let positions: string[][] = [];
  let bracket: ReturnType<typeof createKnockout> = [];
  if (phase === 1) {
    if (tournament.phase_two === 'placement') positions = placementGroups(ordered);
    else {
      if (typeof data.qualifiers !== 'number') throw new AdminInputError('Anzahl der Qualifikanten angeben.');
      try { bracket = createKnockout(ordered, data.qualifiers, data.bronze === true, data.knockoutSlots); }
      catch (error) { throw new AdminInputError(error instanceof Error ? error.message : 'Ungültige Qualifikation.'); }
    }
    if (action === 'preview') return { positions, bracket,
      rankings: rankings.map(group => group.map(row => ({ ...row, name: groups.find(player => player.player_id === row.id)?.display_name }))) };
  }
  if (data.confirm !== true) throw new AdminInputError('Die Aktion muss bestätigt werden.');
  const guard = crypto.randomUUID();
  const snapshot = JSON.stringify(matches.map(match => ({ id: match.id, version: match.version })));
  const batch = [q(`INSERT INTO championship_write_preconditions SELECT ?, EXISTS (
      SELECT 1 FROM championships c, championship_memberships u WHERE c.id=? AND c.version=? AND c.status=? AND c.deleted_at IS NULL
      AND u.user_id=? AND u.active=1 AND u.role='admin')
    AND (SELECT count(*) FROM championship_matches WHERE championship_id=? AND phase=?)=json_array_length(?)
    AND NOT EXISTS (SELECT 1 FROM json_each(?) j LEFT JOIN championship_matches m ON m.id=j.value->>'id'
      WHERE m.version IS NOT j.value->>'version')`, guard, id, tournament.version, tournament.status, actor, id, phase, snapshot, snapshot),
  q("UPDATE championship_stages SET status='closed',completed_at=CURRENT_TIMESTAMP WHERE championship_id=? AND phase=?", id, phase)];
  if (phase === 1) {
    batch.push(q("INSERT INTO championship_stages (championship_id,phase,kind,status,started_at) VALUES (?,2,?,'active',CURRENT_TIMESTAMP)", id, tournament.phase_two));
    if (positions.length) {
      const fixtures = positions.flatMap((group, index) => roundRobin(group).map(match => ({ ...match, id: crypto.randomUUID(), group: index + 1 })));
      batch.push(
        q("INSERT INTO championship_groups SELECT ?,2,key+1,'Platzierungsgruppe ' || (key+1) FROM json_each(?)", id, JSON.stringify(positions)),
        q('INSERT INTO championship_group_members SELECT ?,2,p.value,g.key+1 FROM json_each(?) g,json_each(g.value) p', id, JSON.stringify(positions)),
        q(`INSERT INTO championship_matches (id,championship_id,phase,group_position,round,home,away)
          SELECT value->>'id',?,2,value->>'group',value->>'round',value->>'home',value->>'away' FROM json_each(?)`, id, JSON.stringify(fixtures)),
      );
    } else {
      batch.push(q(`INSERT INTO championship_matches (id,championship_id,phase,round,bracket_position,home,away,status,winner)
        SELECT value->>'id',?,2,value->>'round',value->>'position',value->>'home',value->>'away',
          CASE value->>'state' WHEN 'bye' THEN 'completed' ELSE 'open' END,value->>'winner' FROM json_each(?)`,
      id, JSON.stringify(bracket.map(match => ({ ...match, id: crypto.randomUUID() })))));
    }
  }
  batch.push(q(`INSERT INTO championship_decisions (id,championship_id,actor_id,kind,decision,reason) VALUES (?,?,?,?,?,?)`,
    crypto.randomUUID(), id, actor, action, JSON.stringify({ ordered, positions, qualifiers: data.qualifiers ?? null,
      knockoutOpening: bracket.filter(match => match.round === 1).map(({ home, away }) => [home, away]) }), reason || 'Phase geprüft und bestätigt.'),
  q('UPDATE championships SET status=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?', phase === 1 ? 'phase_active' : 'finished', id),
  q('DELETE FROM championship_write_preconditions WHERE id=?', guard));
  await db.batch(batch);
  return { id, version: tournament.version + 1 };
}
