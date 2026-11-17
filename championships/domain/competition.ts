export type Entry = { id: string; seed: number | null };
export type Score = readonly (readonly [number, number])[];
export type OfficialMatch = { home: string; away: string; score: Score };

export function validateScore(score: Score): 0 | 1 {
  const wins = [0, 0];
  for (const [home, away] of score) {
    const high = Math.max(home, away);
    const low = Math.min(home, away);
    if (wins.includes(2) || ![home, away].every(Number.isInteger) || low < 0 ||
        !((high === 6 && low <= 4) || (high === 7 && (low === 5 || low === 6)))) {
      throw new Error('Ungültiger Satzstand.');
    }
    wins[home > away ? 0 : 1]++;
  }
  if (!wins.includes(2)) throw new Error('Das Match benötigt zwei Gewinnsätze.');
  return wins[0] === 2 ? 0 : 1;
}

export function drawGroups(entries: readonly Entry[], count: number, seed: number): string[][] {
  if (!Number.isInteger(count) || count < 1 || count > Math.floor(entries.length / 2) ||
      !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Ungültige Gruppenkonfiguration.');
  const ids = new Set(entries.map(entry => entry.id));
  const seeded = entries.filter(entry => entry.seed !== null);
  if (ids.size !== entries.length || seeded.some(entry => !Number.isSafeInteger(entry.seed) || entry.seed! < 1) ||
      new Set(seeded.map(entry => entry.seed)).size !== seeded.length) throw new Error('Ungültige Setzliste.');
  // Mulberry32 for reproducible draws, independent of the input order.
  let state = seed;
  function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle<T>(values: T[]) {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  }
  const unseeded = entries.filter(entry => entry.seed === null).map(entry => entry.id).sort();
  const order = [...seeded.sort((a, b) => a.seed! - b.seed!).map(entry => entry.id), ...shuffle(unseeded)];
  const groups: string[][] = Array.from({ length: count }, () => []);
  for (let offset = 0; offset < order.length; offset += count) {
    const destinations = shuffle(groups.map((_, index) => index));
    order.slice(offset, offset + count).forEach((id, index) => groups[destinations[index]].push(id));
  }
  return groups;
}

export function roundRobin(ids: readonly string[]) {
  if (new Set(ids).size !== ids.length) throw new Error('Doppelte Gruppenteilnahme.');
  const wheel: (string | null)[] = [...ids];
  if (wheel.length % 2) wheel.push(null);
  const fixtures: { home: string; away: string; round: number }[] = [];
  for (let round = 1; round < wheel.length; round++) {
    for (let index = 0; index < wheel.length / 2; index++) {
      const home = wheel[index];
      const away = wheel[wheel.length - 1 - index];
      if (home && away) fixtures.push({ home, away, round });
    }
    wheel.splice(1, 0, wheel.pop()!);
  }
  return fixtures;
}

export function validateGroupAssignment(entries: readonly string[], groups: readonly (readonly string[])[], imbalanceReason?: string) {
  const assigned = groups.flat();
  const allowed = new Set(entries);
  if (!groups.length || groups.some(group => group.length < 2) || allowed.size !== entries.length ||
      assigned.length !== entries.length || new Set(assigned).size !== assigned.length ||
      assigned.some(id => !allowed.has(id))) throw new Error('Jeder Teilnehmer muss genau einer Gruppe zugeteilt sein.');
  const sizes = groups.map(group => group.length);
  if (Math.max(...sizes) - Math.min(...sizes) > 1 && !imbalanceReason?.trim()) {
    throw new Error('Ungleich große Gruppen müssen begründet werden.');
  }
}

export function standings(ids: readonly string[], matches: readonly OfficialMatch[]) {
  const rows = new Map(ids.map(id => [id, { id, played: 0, wins: 0, losses: 0, setsFor: 0,
    setsAgainst: 0, setDiff: 0, gamesFor: 0, gamesAgainst: 0, gameDiff: 0, rank: 0, tied: false }]));
  if (rows.size !== ids.length) throw new Error('Doppelte Gruppenteilnahme.');
  const headToHead = new Map(ids.map(id => [id, new Map<string, boolean>()]));
  for (const match of matches) {
    const home = rows.get(match.home);
    const away = rows.get(match.away);
    if (!home || !away || home === away || headToHead.get(home.id)!.has(away.id)) {
      throw new Error('Ungültige Gruppenbegegnung.');
    }
    const winner = validateScore(match.score);
    headToHead.get(home.id)!.set(away.id, winner === 0);
    headToHead.get(away.id)!.set(home.id, winner === 1);
    [home, away].forEach((row, side) => {
      row.played++;
      if (side === winner) row.wins++;
      else row.losses++;
      for (const set of match.score) {
        row.gamesFor += set[side];
        row.gamesAgainst += set[1 - side];
        if (set[side] > set[1 - side]) row.setsFor++;
        else row.setsAgainst++;
      }
      row.setDiff = row.setsFor - row.setsAgainst;
      row.gameDiff = row.gamesFor - row.gamesAgainst;
    });
  }
  const compare = (a: typeof ordered[number], b: typeof ordered[number]): number =>
    b.wins - a.wins || b.setDiff - a.setDiff || b.gameDiff - a.gameDiff;
  const ordered = [...rows.values()];
  ordered.sort((a, b) => compare(a, b) || (a.id < b.id ? -1 : 1));
  for (let first = 0; first < ordered.length;) {
    let end = first + 1;
    while (end < ordered.length && compare(ordered[first], ordered[end]) === 0) end++;
    const block = ordered.slice(first, end);
    const direct = block.map(row => ({ row, wins: block.filter(other => headToHead.get(row.id)!.get(other.id)).length }));
    const resolved = block.length === 1 || (block.every(row => block.every(other => row === other ||
      headToHead.get(row.id)!.has(other.id))) && new Set(direct.map(item => item.wins)).size === block.length);
    if (resolved) direct.sort((a, b) => b.wins - a.wins);
    direct.forEach(({ row }, index) => {
      row.rank = first + 1 + (resolved ? index : 0);
      row.tied = !resolved;
      ordered[first + index] = row;
    });
    first = end;
  }
  return ordered;
}

export function placementGroups(rankings: readonly (readonly string[])[]): string[][] {
  if (!rankings.length || rankings.some(group => !group.length) ||
      new Set(rankings.flat()).size !== rankings.flat().length) throw new Error('Ungültige Vorrundenplatzierungen.');
  return Array.from({ length: Math.max(...rankings.map(group => group.length)) }, (_, index) =>
    rankings.flatMap(group => group[index] === undefined ? [] : [group[index]]));
}

type Qualifier = { id: string; group: number };

// Rankings are ordered by the administrator's recorded priority for equal group places.
export function knockoutOpening(rankings: readonly (readonly string[])[], count: number) {
  if (!Number.isInteger(count) || count < 2 || count > 8) throw new Error('Zwei bis acht Qualifikanten erforderlich.');
  const qualifiers: Qualifier[] = [];
  placementGroups(rankings).forEach((_, rank) => rankings.forEach((group, index) => {
    if (group[rank] !== undefined) qualifiers.push({ id: group[rank], group: index });
  }));
  if (count > qualifiers.length) throw new Error('Zu wenige qualifizierte Spieler.');
  const size = count <= 2 ? 2 : count <= 4 ? 4 : 8;
  let seeds = [1, 2];
  while (seeds.length < size) seeds = seeds.flatMap(seed => [seed, seeds.length * 2 + 1 - seed]);
  const upper = qualifiers.slice(0, size / 2);
  const lower = qualifiers.slice(size / 2, count).reverse();
  const byeCount = size - count;
  // Search only the lower half of an eight-player bracket (at most 4! assignments).
  // Highest seeds retain their byes, and the fewest same-group meetings wins.
  let best = { repeats: Infinity, opponents: [] as Qualifier[] };
  function assign(remaining: Qualifier[], opponents: Qualifier[], repeats: number) {
    if (repeats >= best.repeats) return;
    if (!remaining.length) {
      best = { repeats, opponents };
      return;
    }
    remaining.forEach((opponent, index) => assign(remaining.filter((_, i) => i !== index),
      [...opponents, opponent], repeats + Number(opponent.group === upper[byeCount + opponents.length].group)));
  }
  assign(lower, [], 0);
  const rounds = Math.log2(size);
  return seeds.filter(seed => seed <= size / 2).map((seed, index) => ({
    position: index + 1,
    home: upper[seed - 1].id,
    away: best.opponents[seed - 1 - byeCount]?.id ?? null,
    rounds,
  }));
}
