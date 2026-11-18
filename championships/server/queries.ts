import { standings, type Score } from '../domain/competition.ts';
import type { Actor } from '../domain/result-workflow.ts';

// Structural subset of the D1 binding used by read models.
interface QueryStatement {
  bind(...values: (string | number | null)[]): QueryStatement;
  all<T>(): Promise<{ results: T[] }>;
}

export interface QueryDatabase {
  prepare(sql: string): {
    bind(...values: (string | number | null)[]): QueryStatement;
  };
  batch<T>(statements: QueryStatement[]): Promise<{ results: T[] }[]>;
}

type Championship = {
  id: string; title: string; season: number; description: string; status: string; phase_two: string;
  starts_on: string; ends_on: string | null;
  version?: number;
};
type Group = { phase: number; position: number; name: string };
type Participant = { phase: number; group_position: number; id: string; display_name: string };
type Match = {
  id: string; phase: number; group_position: number | null; round: number; bracket_position: number | null;
  home: string | null; away: string | null; home_name: string | null; away_name: string | null;
  scheduled_at: string | null; winner: string | null;
  status?: string; version?: number; editable?: number; correctable?: number; proposal?: string | null;
};

export function publicChampionshipReader(db: QueryDatabase, actor: Actor | null = null) {
  async function all<T>(sql: string, ...values: (string | number | null)[]) {
    return (await db.prepare(sql).bind(...values).all<T>()).results;
  }
  const admin = actor?.active && actor.role === 'admin';
  const fields = `id, title, season, description, status, phase_two, starts_on, ends_on${admin ? ', version, visibility, published, allow_submissions' : ''}`;
  const visible = admin ? 'deleted_at IS NULL' :
    `deleted_at IS NULL AND status <> 'draft' AND published = 1${actor?.active ? '' : " AND visibility = 'public'"}`;

  return {
    list: () => all<Championship>(`SELECT ${fields} FROM championships WHERE ${visible} ORDER BY starts_on DESC, id LIMIT 100`),
    trash: () => admin ? all<Championship>(`SELECT ${fields} FROM championships WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100`) : [],
    async detail(id: string) {
      const eligible = `championship_id IN (SELECT id FROM championships WHERE id = ? AND ${visible})`;
      // One D1 transaction keeps visibility, fixtures and their official sets on the same snapshot.
      const [header, grouped, participants, fixturesResult, setResult] = await db.batch<unknown>([
        `SELECT ${fields} FROM championships WHERE id = ? AND ${visible}`,
        `SELECT phase, position, name FROM championship_groups WHERE ${eligible} ORDER BY phase, position`,
        `SELECT phase, group_position, p.id, p.display_name FROM championship_group_members
          JOIN championship_players p ON p.id = player_id WHERE ${eligible} ORDER BY p.display_name, p.id`,
        `SELECT m.id, phase, group_position, round, bracket_position, home, away,
          h.display_name AS home_name, a.display_name AS away_name, scheduled_at,
          CASE WHEN m.status IN ('confirmed', 'completed') THEN winner END AS winner${admin ? `,
          m.status, m.version, EXISTS(SELECT 1 FROM championship_stages s WHERE s.championship_id=m.championship_id
            AND s.phase=m.phase AND s.status='active') AS editable,
          (m.status='confirmed' AND EXISTS(SELECT 1 FROM championships c WHERE c.id=m.championship_id
            AND c.status IN ('finished','archived'))) AS correctable,
          (SELECT score FROM championship_submissions r WHERE r.match_id=m.id AND r.match_version=m.version AND r.status='pending') AS proposal` : ''}
          FROM championship_matches m LEFT JOIN championship_players h ON h.id = home
          LEFT JOIN championship_players a ON a.id = away WHERE ${eligible}
          ORDER BY phase, round, bracket_position, scheduled_at, m.id`,
        `SELECT match_id, home_games, away_games
          FROM championship_match_sets WHERE match_id IN (SELECT id FROM championship_matches WHERE ${eligible}
          AND status IN ('confirmed', 'completed')) ORDER BY match_id, set_number`,
      ].map(sql => db.prepare(sql).bind(id)));
      const [championship] = header.results as Championship[];
      if (!championship) return null;
      const groups = grouped.results as Group[];
      const members = participants.results as Participant[];
      const matches = fixturesResult.results as Match[];
      const sets = setResult.results as { match_id: string; home_games: number; away_games: number }[];
      const scores = new Map<string, [number, number][]>();
      for (const set of sets) {
        const score = scores.get(set.match_id) ?? [];
        score.push([set.home_games, set.away_games]);
        scores.set(set.match_id, score);
      }
      const fixtures = matches.map(match => ({ ...match, score: match.winner ? scores.get(match.id) ?? null : null }));
      const tables = groups.map(group => {
        const players = members.filter(row => row.phase === group.phase && row.group_position === group.position);
        const official = fixtures.filter(match => match.phase === group.phase && match.group_position === group.position && match.score)
          .map(match => ({ home: match.home!, away: match.away!, score: match.score as Score }));
        const names = new Map(players.map(player => [player.id, player.display_name]));
        return { ...group, rows: standings([...names.keys()], official).map(row => ({ ...row, name: names.get(row.id)! })) };
      });
      return { championship, tables, matches: fixtures };
    },
  };
}
