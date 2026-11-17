import { validateScore, type Score } from './competition.ts';

export type Actor = { userId: string; role: 'admin' | 'member'; active: boolean; playerId: string | null; canSubmit: boolean };
type Match = {
  home: string | null;
  away: string | null;
  version: number;
  status: 'open' | 'submitted' | 'disputed' | 'confirmed' | 'completed';
  submission: { userId: string; playerId: string | null; score: Score; version: number } | null;
};
type Action =
  | { kind: 'submit'; score: Score }
  | { kind: 'confirm' | 'dispute' }
  | { kind: 'correct'; score: Score; reason: string }
  | { kind: 'reset'; reason: string };

export class ResultWorkflowError extends Error {
  readonly status: 403 | 409 | 422;

  constructor(status: 403 | 409 | 422, message: string) {
    super(message);
    this.status = status;
  }
}

export function canReadChampionship(actor: Actor | null, championship: { draft: boolean; published: boolean; visibility: 'public' | 'club' }) {
  if (actor?.active && actor.role === 'admin') return true;
  return !championship.draft && championship.published && (championship.visibility === 'public' || actor?.active === true);
}

export function resultTransition(actor: Actor | null, match: Match, context: {
  phaseActive: boolean;
  submissionsOpen: boolean;
  version: number;
  downstreamHasResult: boolean;
}, action: Action) {
  if (!actor?.active) throw new ResultWorkflowError(403, 'Aktives Benutzerkonto erforderlich.');
  const admin = actor.role === 'admin';
  const ownMatch = actor.playerId !== null && (actor.playerId === match.home || actor.playerId === match.away);
  if (!admin && (!actor.canSubmit || !ownMatch || !context.submissionsOpen || action.kind === 'correct' || action.kind === 'reset')) {
    throw new ResultWorkflowError(403, 'Keine Berechtigung für diese Begegnung.');
  }
  if (!context.phaseActive || match.version !== context.version || !match.home || !match.away) {
    throw new ResultWorkflowError(409, 'Das Spiel ist gesperrt oder wurde geändert.');
  }
  const version = match.version + 1;
  function official(score: Score) {
    let side: 0 | 1;
    try { side = validateScore(score); }
    catch { throw new ResultWorkflowError(422, 'Das Ergebnis benötigt zwei gültige Gewinnsätze.'); }
    return { status: 'confirmed' as const, version, score, winner: side === 0 ? match.home : match.away };
  }
  if (action.kind === 'correct' || action.kind === 'reset') {
    if (!action.reason.trim()) throw new ResultWorkflowError(422, 'Bitte gib einen Grund an.');
    if (context.downstreamHasResult) throw new ResultWorkflowError(409, 'Zuerst die Folgebegegnung ausdrücklich zurücksetzen.');
    return action.kind === 'correct' ? official(action.score) : { status: 'open' as const, version };
  }
  if (action.kind === 'submit') {
    if (match.status !== 'open') throw new ResultWorkflowError(409, 'Für dieses Spiel liegt bereits ein Ergebnis vor.');
    const result = official(action.score);
    return admin ? result : { status: 'submitted' as const, version, score: action.score };
  }
  const submission = match.submission;
  if (match.status !== 'submitted' || !submission || submission.version !== match.version) {
    throw new ResultWorkflowError(409, 'Diese Meldung wartet nicht auf Bestätigung.');
  }
  if (!admin && (submission.userId === actor.userId || submission.playerId === actor.playerId)) {
    throw new ResultWorkflowError(403, 'Nur der Gegner oder ein Administrator kann die Meldung prüfen.');
  }
  return action.kind === 'confirm' ? official(submission.score) : { status: 'disputed' as const, version };
}
