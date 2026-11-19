export type Pot = 1 | 2;
export type RoundPlayer = { id: string; pot: Pot; helper: boolean };
export type Appearance = { playerId: string; pot: Pot; team: 1 | 2; counted: boolean };
export type SektMatch = { position: number; players: Appearance[] };

export class SektInputError extends Error {}
export const rejectSekt = (message: string): never => { throw new SektInputError(message); };

export function helperRequirements(first: number, second: number) {
  const slots = Math.ceil(Math.max(first, second) / 2) * 2;
  return { first: slots - first, second: slots - second, matches: slots / 2,
    playable: first >= 2 && second >= 2 && slots - first <= first && slots - second <= second };
}

export function validateGames(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    rejectSekt('Die Games-Vorgabe muss eine positive ganze Zahl sein.');
  }
  return value as number;
}

export function validateSektResult(home: unknown, away: unknown, target: number) {
  if (![home, away].every(value => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= target) ||
      Math.max(Number(home), Number(away)) !== target) {
    rejectSekt(`Jede Seite darf höchstens ${target} Games haben. Mindestens eine Seite muss ${target} erreichen.`);
  }
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const range = index + 1;
    const limit = Math.floor(0x100000000 / range) * range;
    let sample: number;
    do { sample = crypto.getRandomValues(new Uint32Array(1))[0]; } while (sample >= limit);
    const target = sample % range;
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function drawSektRound(players: RoundPlayer[]): SektMatch[] {
  if (new Set(players.map(player => player.id)).size !== players.length ||
      players.some(player => !player.id || ![1, 2].includes(player.pot) || typeof player.helper !== 'boolean')) {
    rejectSekt('Jede Person muss genau einem Topf angehören.');
  }
  const pots = [1, 2].map(pot => players.filter(player => player.pot === pot));
  const needed = helperRequirements(pots[0].length, pots[1].length);
  if (!needed.playable) rejectSekt('Mindestens zwei Personen je Topf erforderlich. Für diese Verteilung fehlen unterschiedliche Aushilfen. Bitte die Töpfe anpassen.');
  for (const [index, pot] of pots.entries()) {
    const count = index === 0 ? needed.first : needed.second;
    if (pot.filter(player => player.helper).length !== count) {
      rejectSekt(`Topf ${index + 1} benötigt genau ${count} Aushilfen.`);
    }
  }
  const pairings = pots.map(pot => {
    const tokens = shuffle(pot.flatMap(player => [
      { playerId: player.id, pot: player.pot, counted: true },
      ...(player.helper ? [{ playerId: player.id, pot: player.pot, counted: false }] : []),
    ]));
    // Each ID occurs at most twice. If a pair contains both copies, swapping
    // with any other pair fixes both pairs without creating a new duplicate.
    for (let index = 0; index < tokens.length; index += 2) {
      if (tokens[index].playerId !== tokens[index + 1].playerId) continue;
      const others = tokens.map((_, other) => other).filter(other => other < index || other > index + 1);
      const [target] = shuffle(others);
      [tokens[index + 1], tokens[target]] = [tokens[target], tokens[index + 1]];
    }
    const pairs = [];
    for (let index = 0; index < tokens.length; index += 2) pairs.push(shuffle(tokens.slice(index, index + 2)));
    return shuffle(pairs);
  });
  return pairings[0].map((first, index) => ({
    position: index + 1,
    players: [...first.map((token, side) => ({ ...token, team: (side + 1) as 1 | 2 })),
      ...pairings[1][index].map((token, side) => ({ ...token, team: (side + 1) as 1 | 2 }))],
  }));
}
