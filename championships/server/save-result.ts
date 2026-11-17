import { resultTransition, type Actor } from '../domain/result-workflow.ts';
import { reconcileKnockout } from '../domain/knockout.ts';

type Database<Statement> = {
  prepare(sql: string): { bind(...values: (string | number | null)[]): Statement };
  batch(statements: Statement[]): Promise<unknown>;
};
type LoadedMatch = Parameters<typeof resultTransition>[1] & {
  id: string;
  championshipId: string;
  phase: number;
  category: 'group' | 'placement' | 'knockout';
  score: readonly (readonly [number, number])[] | null;
};
type BracketMatch = Parameters<typeof reconcileKnockout>[0][number] & { id: string; version: number };

/** Atomically applies a group-match result prepared from a server-side snapshot. */
export async function saveGroupResult<Statement>(db: Database<Statement>, actor: Actor, match: LoadedMatch,
  context: Parameters<typeof resultTransition>[2], action: Parameters<typeof resultTransition>[3], bracket?: BracketMatch[]) {
  const next = resultTransition(actor, match, context, action);
  const batchId = crypto.randomUUID();
  const statement = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).bind(...values);
  const batch = [statement(`INSERT INTO championship_write_preconditions
    SELECT ?, EXISTS (
      SELECT 1 FROM championship_matches m
      JOIN championship_stages s ON s.championship_id=m.championship_id AND s.phase=m.phase
      JOIN championships c ON c.id=m.championship_id
      JOIN championship_memberships u ON u.user_id=?
      LEFT JOIN championship_player_links l ON l.user_id=u.user_id
      LEFT JOIN championship_players p ON p.id=l.player_id
      WHERE m.id=? AND m.championship_id=? AND m.phase=? AND m.version=?
        AND m.home=? AND m.away=?
        AND s.status='active' AND s.kind=? AND u.active=1 AND u.role=?
        AND (u.role='admin' OR (c.published=1 AND c.allow_submissions=1 AND l.can_submit=1
          AND l.player_id=? AND p.active=1 AND l.player_id IN (m.home,m.away)))
    )`, batchId, actor.userId, match.id, match.championshipId, match.phase, match.version,
  match.home, match.away, match.category, actor.role, actor.playerId)];

  if (match.category === 'knockout') {
    if (!bracket?.some(fixture => fixture.id === match.id && fixture.version === match.version)) {
      throw new Error('Der Turnierbaum wurde geändert.');
    }
    const snapshot = JSON.stringify(bracket.map(({ id, version }) => ({ id, version })));
    const bracketGuard = crypto.randomUUID();
    batch.push(statement(`INSERT INTO championship_write_preconditions SELECT ?, NOT EXISTS (
      SELECT 1 FROM json_each(?) j LEFT JOIN championship_matches m ON m.id=j.value->>'id'
      WHERE m.version IS NOT j.value->>'version')`, bracketGuard, snapshot));
    if (next.status === 'confirmed' || next.status === 'open') {
      const reconciled = reconcileKnockout(bracket.map(fixture => fixture.id !== match.id ? fixture : {
        ...fixture, state: next.status, winner: next.status === 'confirmed' ? next.winner : null,
      }));
      for (const fixture of reconciled) {
        const previous = bracket.find(row => row.round === fixture.round && row.position === fixture.position)!;
        if (previous.home === fixture.home && previous.away === fixture.away) continue;
        batch.push(statement(`UPDATE championship_matches SET home=?,away=?,version=version+1,updated_at=CURRENT_TIMESTAMP
          WHERE id=?`, fixture.home, fixture.away, previous.id));
      }
    }
    batch.push(statement('DELETE FROM championship_write_preconditions WHERE id=?', bracketGuard));
  }

  if (next.status === 'submitted') {
    batch.push(statement(`INSERT INTO championship_submissions
      (id,match_id,match_version,submitted_by,submitted_as_player,score,status)
      VALUES (?,?,?,?,?,?,'pending')`, crypto.randomUUID(), match.id, next.version, actor.userId,
    actor.playerId, JSON.stringify(next.score)));
  } else {
    const submissionState = action.kind === 'confirm' ? 'confirmed' : action.kind === 'dispute' ? 'disputed' : 'superseded';
    batch.push(statement(`UPDATE championship_submissions SET status=?, resolved_by=?, resolved_at=CURRENT_TIMESTAMP
      WHERE match_id=? AND status='pending'`, submissionState, actor.userId, match.id));
    batch.push(statement('DELETE FROM championship_match_sets WHERE match_id=?', match.id));
    if (next.status === 'confirmed') {
      next.score.forEach(([home, away], index) => batch.push(statement(`INSERT INTO championship_match_sets
        (match_id,set_number,home_games,away_games) VALUES (?,?,?,?)`, match.id, index + 1, home, away)));
    }
  }
  batch.push(statement(`UPDATE championship_matches SET status=?, winner=?, version=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`, next.status, next.status === 'confirmed' ? next.winner : null, next.version, match.id));
  batch.push(statement(`INSERT INTO championship_result_audit
    (id,match_id,actor_id,action,previous_value,new_value,reason) VALUES (?,?,?,?,?,?,?)`,
  crypto.randomUUID(), match.id, actor.userId, action.kind,
  JSON.stringify({ status: match.status, version: match.version, score: match.score ?? match.submission?.score ?? null }),
  JSON.stringify(next), 'reason' in action ? action.reason.trim() : null));
  batch.push(statement('DELETE FROM championship_write_preconditions WHERE id=?', batchId));
  await db.batch(batch);
  return next;
}
