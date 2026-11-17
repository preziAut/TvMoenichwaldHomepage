CREATE TABLE championship_memberships (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
) STRICT;

CREATE TABLE championship_players (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;

CREATE TABLE championship_player_links (
  user_id TEXT PRIMARY KEY REFERENCES championship_memberships(user_id),
  player_id TEXT NOT NULL UNIQUE REFERENCES championship_players(id),
  approved_by TEXT NOT NULL REFERENCES championship_memberships(user_id),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  can_submit INTEGER NOT NULL DEFAULT 0 CHECK (can_submit IN (0, 1))
) STRICT;

CREATE TABLE championships (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  season INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_on TEXT NOT NULL,
  ends_on TEXT CHECK (ends_on >= starts_on),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'groups_active', 'groups_closed', 'phase_prepared', 'phase_active', 'finished', 'archived')),
  visibility TEXT NOT NULL DEFAULT 'club' CHECK (visibility IN ('public', 'club')),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  allow_submissions INTEGER NOT NULL DEFAULT 0 CHECK (allow_submissions IN (0, 1)),
  phase_two TEXT NOT NULL CHECK (phase_two IN ('placement', 'knockout')),
  settings TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status <> 'draft' OR published = 0)
) STRICT;

CREATE TABLE championship_entries (
  championship_id TEXT NOT NULL REFERENCES championships(id),
  player_id TEXT NOT NULL REFERENCES championship_players(id),
  seed INTEGER CHECK (seed >= 1),
  PRIMARY KEY (championship_id, player_id),
  UNIQUE (championship_id, seed)
) STRICT;

CREATE TABLE championship_stages (
  championship_id TEXT NOT NULL REFERENCES championships(id),
  phase INTEGER NOT NULL CHECK (phase IN (1, 2)),
  kind TEXT NOT NULL CHECK (kind IN ('group', 'placement', 'knockout')),
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'active', 'closed')),
  started_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (championship_id, phase),
  CHECK ((phase = 1) = (kind = 'group'))
) STRICT;

CREATE TABLE championship_groups (
  championship_id TEXT NOT NULL,
  phase INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  name TEXT NOT NULL,
  PRIMARY KEY (championship_id, phase, position),
  FOREIGN KEY (championship_id, phase) REFERENCES championship_stages(championship_id, phase)
) STRICT;

CREATE TABLE championship_group_members (
  championship_id TEXT NOT NULL,
  phase INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  group_position INTEGER NOT NULL,
  PRIMARY KEY (championship_id, phase, player_id),
  UNIQUE (championship_id, phase, player_id, group_position),
  FOREIGN KEY (championship_id, phase, group_position) REFERENCES championship_groups(championship_id, phase, position),
  FOREIGN KEY (championship_id, player_id) REFERENCES championship_entries(championship_id, player_id)
) STRICT;

CREATE TABLE championship_matches (
  id TEXT PRIMARY KEY,
  championship_id TEXT NOT NULL,
  phase INTEGER NOT NULL,
  group_position INTEGER,
  round INTEGER NOT NULL CHECK (round >= 1),
  bracket_position INTEGER CHECK (bracket_position >= 1),
  home TEXT,
  away TEXT,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'disputed', 'confirmed', 'completed')),
  winner TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (championship_id, phase) REFERENCES championship_stages(championship_id, phase),
  FOREIGN KEY (championship_id, phase, home, group_position) REFERENCES championship_group_members(championship_id, phase, player_id, group_position),
  FOREIGN KEY (championship_id, phase, away, group_position) REFERENCES championship_group_members(championship_id, phase, player_id, group_position),
  FOREIGN KEY (championship_id, home) REFERENCES championship_entries(championship_id, player_id),
  FOREIGN KEY (championship_id, away) REFERENCES championship_entries(championship_id, player_id),
  CHECK (home IS NULL OR away IS NULL OR home <> away),
  CHECK (group_position IS NULL OR (home IS NOT NULL AND away IS NOT NULL)),
  CHECK ((group_position IS NULL) = (bracket_position IS NOT NULL)),
  CHECK (phase <> 1 OR group_position IS NOT NULL),
  CHECK ((status IN ('confirmed', 'completed')) = (winner IS NOT NULL)),
  CHECK (winner IS NULL OR winner IS home OR winner IS away)
) STRICT;

CREATE UNIQUE INDEX championship_unique_group_match ON championship_matches
  (championship_id, phase, group_position, min(home, away), max(home, away)) WHERE group_position IS NOT NULL;
CREATE UNIQUE INDEX championship_unique_bracket_match ON championship_matches
  (championship_id, phase, round, bracket_position) WHERE bracket_position IS NOT NULL;
CREATE INDEX championship_match_status ON championship_matches (championship_id, phase, status);
CREATE INDEX championship_match_home ON championship_matches (home, status);
CREATE INDEX championship_match_away ON championship_matches (away, status);
CREATE INDEX championship_entry_player ON championship_entries (player_id);

CREATE TABLE championship_match_sets (
  match_id TEXT NOT NULL REFERENCES championship_matches(id),
  set_number INTEGER NOT NULL CHECK (set_number BETWEEN 1 AND 3),
  home_games INTEGER NOT NULL CHECK (home_games BETWEEN 0 AND 7),
  away_games INTEGER NOT NULL CHECK (away_games BETWEEN 0 AND 7),
  tiebreak_details TEXT CHECK (json_valid(tiebreak_details)),
  PRIMARY KEY (match_id, set_number),
  CHECK ((max(home_games, away_games) = 6 AND min(home_games, away_games) <= 4) OR
         (max(home_games, away_games) = 7 AND min(home_games, away_games) IN (5, 6)))
) STRICT;

CREATE TABLE championship_submissions (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES championship_matches(id),
  match_version INTEGER NOT NULL CHECK (match_version > 0),
  submitted_by TEXT NOT NULL REFERENCES championship_memberships(user_id),
  submitted_as_player TEXT REFERENCES championship_players(id),
  score TEXT NOT NULL CHECK (json_valid(score)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'disputed', 'superseded')),
  resolved_by TEXT REFERENCES championship_memberships(user_id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (match_id, match_version)
) STRICT;
CREATE UNIQUE INDEX championship_one_pending ON championship_submissions (match_id) WHERE status = 'pending';

CREATE TABLE championship_result_audit (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES championship_matches(id),
  actor_id TEXT NOT NULL REFERENCES championship_memberships(user_id),
  action TEXT NOT NULL,
  previous_value TEXT CHECK (json_valid(previous_value)),
  new_value TEXT CHECK (json_valid(new_value)),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX championship_result_audit_match ON championship_result_audit (match_id, created_at);

CREATE TABLE championship_draws (
  id TEXT PRIMARY KEY,
  championship_id TEXT NOT NULL REFERENCES championships(id),
  mode TEXT NOT NULL CHECK (mode IN ('automatic', 'manual')),
  random_seed INTEGER CHECK (random_seed BETWEEN 0 AND 4294967295),
  algorithm_version INTEGER NOT NULL DEFAULT 1,
  seed_snapshot TEXT NOT NULL CHECK (json_valid(seed_snapshot)),
  assignment TEXT NOT NULL CHECK (json_valid(assignment)),
  generated_by TEXT NOT NULL REFERENCES championship_memberships(user_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (mode <> 'automatic' OR random_seed IS NOT NULL)
) STRICT;

CREATE TABLE championship_decisions (
  id TEXT PRIMARY KEY,
  championship_id TEXT NOT NULL REFERENCES championships(id),
  actor_id TEXT NOT NULL REFERENCES championship_memberships(user_id),
  kind TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (json_valid(decision)),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

-- A failed precondition aborts the whole D1 batch, including its audit writes.
CREATE TABLE championship_write_preconditions (
  id TEXT PRIMARY KEY,
  passed INTEGER NOT NULL CHECK (passed = 1)
) STRICT;
