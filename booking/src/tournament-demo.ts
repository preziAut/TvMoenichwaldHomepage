type Match = {
  id: string;
  home: string;
  away: string;
  score: [number, number] | null;
  final: boolean;
};

export function createTournamentDemo() {
  type Tournament = { id: string; title: string; format: string; matches: Match[] };
  const clubs = new Map<string, Tournament[]>();

  return (club: string, admin: boolean, path: string, method: string, body: Record<string, unknown>) => {
    if (path !== '/api/tournaments' && !path.startsWith('/api/tournaments/')) return;
    const tournaments = clubs.get(club) ?? [];
    const reply = (value: unknown, status = 200) => Response.json(value, { status });
    const invalid = () => reply({ error: 'INVALID_TOURNAMENT' }, 400);

    if (path === '/api/tournaments' && method === 'GET') return reply(tournaments);
    if (!admin) return reply({ error: 'FORBIDDEN' }, 403);
    if (method !== 'POST') return reply({ error: 'NOT_FOUND' }, 404);

    if (path === '/api/tournaments') {
      const { title, format, entries } = body;
      if (typeof title !== 'string' || !title.trim() || title.length > 100 ||
          (format !== 'single' && format !== 'mixed') || typeof entries !== 'string' || entries.length > 2400) return invalid();
      const teams = entries.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (teams.length < 2 || teams.length > 12 || new Set(teams.map(team => team.toLowerCase())).size !== teams.length) return invalid();
      const players = teams.map(team => team.split('/').map(name => name.trim()));
      if (players.some(team => team.length !== (format === 'mixed' ? 2 : 1) ||
          team.some(name => !name || name.length > 70))) return invalid();
      const names = players.flat().map(name => name.toLowerCase());
      if (new Set(names).size !== names.length || tournaments.length >= 20) return invalid();

      const labels = players.map(team => team.join(' / '));
      const matches = labels.flatMap((home, index) =>
        labels.slice(index + 1).map(away => ({ id: crypto.randomUUID(), home, away, score: null, final: false })));
      const tournament = { id: crypto.randomUUID(), title: title.trim(), format, matches };
      clubs.set(club, [...tournaments, tournament]);
      return reply(tournament, 201);
    }

    const matchPath = /^\/api\/tournaments\/([^/]+)\/matches\/([^/]+)$/.exec(path);
    const tournament = tournaments.find(item => item.id === matchPath?.[1]);
    const match = tournament?.matches.find(item => item.id === matchPath?.[2]);
    if (!match) return reply({ error: 'NOT_FOUND' }, 404);
    const { home, away, final } = body;
    if (typeof home !== 'number' || typeof away !== 'number' ||
        ![home, away].every(value => Number.isInteger(value) && value >= 0 && value <= 7) ||
        typeof final !== 'boolean') return invalid();

    const high = Math.max(home, away);
    const low = Math.min(home, away);
    const finished = (high === 6 && low <= 4) || (high === 7 && (low === 5 || low === 6));
    if ((high === 7 && !finished) || (final && !finished)) return invalid();

    match.score = [home, away];
    match.final = final;
    return reply(match);
  };
}
