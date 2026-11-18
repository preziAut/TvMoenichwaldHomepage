BEGIN;

CREATE TABLE booking_locations (
  slug text PRIMARY KEY CHECK (slug IN ('moenichwald', 'waldbach')),
  club_id uuid NOT NULL UNIQUE REFERENCES clubs(id)
);

CREATE TABLE booking_environment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode text NOT NULL CHECK (mode IN ('pilot', 'live'))
);

CREATE TABLE booking_accounts (
  club_id uuid NOT NULL,
  user_id text NOT NULL CHECK (length(user_id) > 0),
  member_id uuid NOT NULL,
  pilot_enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (club_id, user_id),
  UNIQUE (club_id, member_id),
  FOREIGN KEY (club_id, member_id) REFERENCES members(club_id, id)
);

INSERT INTO clubs (id, name) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Mönichwald'),
  ('00000000-0000-4000-8000-000000000002', 'Waldbach');
INSERT INTO booking_locations (slug, club_id) VALUES
  ('moenichwald', '00000000-0000-4000-8000-000000000001'),
  ('waldbach', '00000000-0000-4000-8000-000000000002');
INSERT INTO courts (club_id, id, name)
  SELECT club_id, gen_random_uuid(), 'Platz ' || number
  FROM booking_locations CROSS JOIN generate_series(1, 2) AS number;

-- The inactive system member records the initial rules and has no login.
INSERT INTO members (club_id, id, display_name, role, state)
  SELECT club_id, club_id, 'System', 'member', 'inactive' FROM booking_locations;
INSERT INTO policies (
  club_id, id, revision, cancellation_enabled, cancellation_seconds, advance_days,
  slot_minutes, max_duration_minutes, opening_minute, closing_minute, max_active_bookings, created_by
)
  SELECT club_id, gen_random_uuid(), 1, true, 7200, 14, 30, 120, 360, 1440, 0, club_id
  FROM booking_locations;

COMMIT;
