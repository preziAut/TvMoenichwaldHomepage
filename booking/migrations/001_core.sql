-- Production model, separate from the private legacy rehearsal database.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE clubs (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Vienna'
);
CREATE TABLE members (
  club_id uuid NOT NULL REFERENCES clubs(id),
  id uuid NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('member','admin')),
  state text NOT NULL CHECK (state IN ('active','inactive','pending')),
  PRIMARY KEY (club_id,id)
);
CREATE TABLE courts (
  club_id uuid NOT NULL REFERENCES clubs(id),
  id uuid NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (club_id,id)
);
CREATE TABLE policies (
  club_id uuid NOT NULL REFERENCES clubs(id),
  id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  cancellation_enabled boolean NOT NULL,
  cancellation_seconds integer NOT NULL CHECK (cancellation_seconds BETWEEN 0 AND 2592000),
  advance_days integer NOT NULL CHECK (advance_days BETWEEN 1 AND 365),
  slot_minutes integer NOT NULL CHECK (slot_minutes IN (15,30,60)),
  max_duration_minutes integer NOT NULL CHECK (max_duration_minutes BETWEEN 15 AND 1440),
  opening_minute integer NOT NULL CHECK (opening_minute BETWEEN 0 AND 1439),
  closing_minute integer NOT NULL CHECK (closing_minute BETWEEN 1 AND 1440),
  max_active_bookings integer NOT NULL CHECK (max_active_bookings BETWEEN 0 AND 100),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (club_id,id), UNIQUE (club_id,revision),
  FOREIGN KEY (club_id,created_by) REFERENCES members(club_id,id),
  CHECK (closing_minute > opening_minute),
  CHECK (max_duration_minutes % slot_minutes = 0)
);
CREATE TABLE allocations (
  club_id uuid NOT NULL,
  id uuid NOT NULL,
  court_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('booking','block')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','cancelled')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  policy_id uuid NOT NULL,
  cancellation_enabled boolean NOT NULL,
  cancellation_deadline timestamptz NOT NULL,
  request_key uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (club_id,id), UNIQUE (club_id,owner_id,request_key),
  FOREIGN KEY (club_id,court_id) REFERENCES courts(club_id,id),
  FOREIGN KEY (club_id,owner_id) REFERENCES members(club_id,id),
  FOREIGN KEY (club_id,policy_id) REFERENCES policies(club_id,id),
  CHECK (ends_at > starts_at),
  CONSTRAINT no_overlapping_allocations EXCLUDE USING gist (
    club_id WITH =, court_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&
  ) WHERE (state='active')
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  entity_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (club_id,actor_id) REFERENCES members(club_id,id)
);
