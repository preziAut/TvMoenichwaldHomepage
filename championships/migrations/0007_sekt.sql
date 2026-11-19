CREATE TABLE sekt_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  default_games INTEGER NOT NULL CHECK (default_games BETWEEN 1 AND 9007199254740991),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','finished')),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE sekt_entries (
  event_id TEXT NOT NULL REFERENCES sekt_events(id),
  player_id TEXT NOT NULL REFERENCES championship_players(id),
  pot INTEGER NOT NULL CHECK (pot IN (1,2)),
  PRIMARY KEY (event_id,player_id)
) STRICT;

CREATE TABLE sekt_rounds (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES sekt_events(id),
  number INTEGER NOT NULL CHECK (number > 0),
  games INTEGER NOT NULL CHECK (games BETWEEN 1 AND 9007199254740991),
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','active','closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id,number),
  UNIQUE (event_id,id)
) STRICT;
CREATE UNIQUE INDEX sekt_one_open_round ON sekt_rounds(event_id) WHERE status <> 'closed';

CREATE TABLE sekt_round_players (
  event_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  pot INTEGER NOT NULL CHECK (pot IN (1,2)),
  helper INTEGER NOT NULL DEFAULT 0 CHECK (helper IN (0,1)),
  PRIMARY KEY (round_id,player_id),
  FOREIGN KEY (event_id,round_id) REFERENCES sekt_rounds(event_id,id),
  FOREIGN KEY (event_id,player_id) REFERENCES sekt_entries(event_id,player_id)
) STRICT;

CREATE TABLE sekt_matches (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES sekt_rounds(id),
  position INTEGER NOT NULL,
  home_games INTEGER CHECK (home_games >= 0),
  away_games INTEGER CHECK (away_games >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE (round_id,position),
  UNIQUE (round_id,id),
  CHECK ((home_games IS NULL) = (away_games IS NULL))
) STRICT;

CREATE TABLE sekt_appearances (
  round_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  team INTEGER NOT NULL CHECK (team IN (1,2)),
  counted INTEGER NOT NULL CHECK (counted IN (0,1)),
  PRIMARY KEY (match_id,player_id),
  FOREIGN KEY (round_id,match_id) REFERENCES sekt_matches(round_id,id) ON DELETE CASCADE,
  FOREIGN KEY (round_id,player_id) REFERENCES sekt_round_players(round_id,player_id)
) STRICT;
CREATE UNIQUE INDEX sekt_one_counted_appearance ON sekt_appearances(round_id,player_id) WHERE counted=1;
CREATE UNIQUE INDEX sekt_one_helper_appearance ON sekt_appearances(round_id,player_id) WHERE counted=0;
CREATE INDEX sekt_match_round ON sekt_matches(round_id);

CREATE TABLE sekt_audit (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES sekt_events(id),
  round_id TEXT,
  match_id TEXT,
  actor_id TEXT NOT NULL REFERENCES championship_memberships(user_id),
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
