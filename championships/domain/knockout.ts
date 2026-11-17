import { knockoutOpening } from './competition.ts';

type Fixture = {
  round: number;
  position: number;
  home: string | null;
  away: string | null;
  winner: string | null;
  state: 'open' | 'bye' | 'submitted' | 'disputed' | 'confirmed';
};

export function createKnockout(rankings: readonly (readonly string[])[], count: number, bronze: boolean): Fixture[] {
  const opening = knockoutOpening(rankings, count);
  const rounds = opening[0].rounds;
  const bracket: Fixture[] = opening.map(({ position, home, away }) => ({ round: 1, position, home, away,
    winner: away ? null : home, state: away ? 'open' : 'bye' }));
  for (let round = 2; round <= rounds; round++) {
    for (let position = 1; position <= 2 ** (rounds - round); position++) {
      bracket.push({ round, position, home: null, away: null, winner: null, state: 'open' });
    }
  }
  if (bronze && rounds > 1) bracket.push({ round: rounds, position: 2, home: null, away: null, winner: null, state: 'open' });
  return reconcileKnockout(bracket);
}

/** The caller must persist the full result and these assignments in the same version-guarded transaction. */
export function reconcileKnockout(fixtures: readonly Fixture[]): Fixture[] {
  if (!fixtures.length) throw new Error('Der Turnierbaum ist leer.');
  const bracket = fixtures.map(match => ({ ...match })).sort((a, b) => a.round - b.round || a.position - b.position);
  const finalRound = bracket.at(-1)!.round;
  const byPosition = new Map(bracket.map(match => [`${match.round}/${match.position}`, match]));
  const outcome = (match: Fixture | undefined, loser: boolean) => {
    if (!match || (match.state !== 'confirmed' && match.state !== 'bye')) return null;
    if (!loser) return match.winner;
    return match.winner === match.home ? match.away : match.home;
  };
  for (const match of bracket) {
    if (match.round === 1) continue;
    const bronze = match.round === finalRound && match.position === 2;
    const homeSlot = bronze ? 1 : match.position * 2 - 1;
    const home = outcome(byPosition.get(`${match.round - 1}/${homeSlot}`), bronze);
    const away = outcome(byPosition.get(`${match.round - 1}/${homeSlot + 1}`), bronze);
    if (match.home === home && match.away === away) continue;
    if (match.state !== 'open') throw new Error('Die gespeicherte Folgebegegnung muss ausdrücklich zurückgesetzt werden.');
    match.home = home;
    match.away = away;
  }
  return bracket;
}
