import { championshipSessions } from '../../../championships/server/sessions.ts';
import { saveGroupResult } from '../../../championships/server/save-result.ts';
import { ResultWorkflowError } from '../../../championships/domain/result-workflow.ts';
import type { Score } from '../../../championships/domain/competition.ts';

type Snapshot = Parameters<typeof saveGroupResult>[2];
type Action = Parameters<typeof saveGroupResult>[4];
type ResultRow = Omit<Snapshot, 'score' | 'submission'> & {
  active: number; correctable: number; allow_submissions: number; published: number;
  submitted_by: string | null; submitted_as_player: string | null; submitted_score: string | null;
};
type SessionStatement = ReturnType<ReturnType<Parameters<typeof championshipSessions>[0]['prepare']>['bind']>;
type DB = {
  prepare(sql: string): { bind(...args: (string | number | null)[]): SessionStatement & { all<T>(): Promise<{ results: T[] }> } };
  batch(statements: unknown[]): Promise<unknown>;
};

function readScore(value: unknown): Score | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3 ||
      !value.every(set => Array.isArray(set) && set.length === 2 && set.every(Number.isInteger))) return null;
  return value as Score;
}

export async function parseBody(request: Request) {
  const input = request.body?.getReader();
  if (!input) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let value = '';
  let bytes = 0;
  try {
    while (true) {
      const read = await input.read();
      if (read.done) break;
      bytes += read.value.byteLength;
      if (bytes > 4096) { await input.cancel(); return null; }
      value += decoder.decode(read.value, { stream: true });
    }
    const parsed = JSON.parse(value + decoder.decode());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

export async function onRequest({ request, env }: { request: Request; env: { DB?: DB } }) {
  const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const url = new URL(request.url);
  const route = /^\/api\/spiele\/([a-z0-9_-]{1,80})\/(ergebnis|bestaetigen|beanstanden|admin-korrektur|zuruecksetzen)\/?$/.exec(url.pathname);
  if (!route) return reply({ error: 'Spiel nicht gefunden.' }, 404);
  if (request.method !== (route[2] === 'admin-korrektur' ? 'PATCH' : 'POST')) return reply({ error: 'Methode nicht zulässig.' }, 405);
  if (request.headers.get('Origin') !== url.origin) return reply({ error: 'Anfrage nicht erlaubt.' }, 403);
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'JSON erwartet.' }, 415);
  if (!env.DB) return reply({ error: 'Die Meisterschaftsdatenbank ist noch nicht verfügbar.' }, 503);
  const db = env.DB;
  try {
    const actor = await championshipSessions(db).read(request);
    if (!actor) return reply({ error: 'Anmeldung erforderlich.' }, 401);
    const body = await parseBody(request);
    if (!body || typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 0) {
      return reply({ error: 'Ungültige Eingabe.' }, 422);
    }
    const score = readScore(body.score);
    const reason = typeof body.reason === 'string' && body.reason.trim().length <= 500 ? body.reason.trim() : '';
    let action: Action;
    switch (route[2]) {
      case 'ergebnis': if (!score) return reply({ error: 'Ungültige Satzstände.' }, 422); action = { kind: 'submit', score }; break;
      case 'admin-korrektur': if (!score || !reason) return reply({ error: 'Satzstände und Begründung erforderlich.' }, 422); action = { kind: 'correct', score, reason }; break;
      case 'zuruecksetzen': if (!reason) return reply({ error: 'Begründung erforderlich.' }, 422); action = { kind: 'reset', reason }; break;
      case 'bestaetigen': action = { kind: 'confirm' }; break;
      default: action = { kind: 'dispute' };
    }
    const row = await db.prepare(`SELECT m.id, m.championship_id AS championshipId, m.phase, m.home, m.away, m.status, m.version,
        s.kind AS category, s.status='active' AS active, c.allow_submissions, c.published,
        (s.status='closed' AND m.status='confirmed' AND c.status IN ('finished','archived')) AS correctable,
        r.submitted_by, r.submitted_as_player, r.score AS submitted_score
      FROM championship_matches m JOIN championship_stages s ON s.championship_id=m.championship_id AND s.phase=m.phase
      JOIN championships c ON c.id=m.championship_id
      LEFT JOIN championship_submissions r ON r.match_id=m.id AND r.match_version=m.version AND r.status='pending'
      WHERE m.id=? AND c.deleted_at IS NULL`).bind(route[1]).first<ResultRow>();
    if (!row || (actor.role !== 'admin' && (!row.published || !actor.playerId || ![row.home, row.away].includes(actor.playerId)))) {
      return reply({ error: 'Spiel nicht gefunden.' }, 404);
    }
    const oldScore = await db.prepare(`SELECT json_group_array(json_array(home_games,away_games)) AS score FROM
      (SELECT home_games,away_games FROM championship_match_sets WHERE match_id=? ORDER BY set_number)`)
      .bind(row.id).first<{ score: string }>();
    const snapshot: Snapshot = { ...row, score: oldScore && readScore(JSON.parse(oldScore.score)),
      submission: row.submitted_by && row.submitted_score ? { userId: row.submitted_by, playerId: row.submitted_as_player,
        score: JSON.parse(row.submitted_score), version: row.version } : null };
    const bracket = row.category === 'knockout' ? (await db.prepare(`SELECT id,version,round,bracket_position AS position,home,away,winner,
      CASE status WHEN 'completed' THEN 'bye' ELSE status END AS state FROM championship_matches
      WHERE championship_id=? AND phase=2 AND bracket_position IS NOT NULL`).bind(row.championshipId)
      .all<NonNullable<Parameters<typeof saveGroupResult>[5]>[number]>()).results : undefined;
    const correction = actor.role === 'admin' && action.kind === 'correct' && row.correctable === 1;
    const result = await saveGroupResult(db, actor, snapshot, { phaseActive: row.active === 1 || correction,
      submissionsOpen: row.allow_submissions === 1, version: body.version, downstreamHasResult: false }, action, bracket);
    return reply(result);
  } catch (error) {
    if (error instanceof ResultWorkflowError) return reply({ error: error.message }, error.status);
    if (error instanceof Error && error.message.includes('Folgebegegnung')) {
      return reply({ error: 'Die Korrektur würde eine bereits gespielte Folgebegegnung verändern.' }, 409);
    }
    if (error instanceof Error && (error.message.includes('CHECK constraint failed: passed') || error.message.includes('Turnierbaum wurde geändert'))) {
      return reply({ error: 'Das Spiel oder deine Freischaltung wurde geändert.' }, 409);
    }
    return reply({ error: 'Ergebnis konnte nicht gespeichert werden.' }, 503);
  }
}
