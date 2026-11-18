CREATE TABLE booking_legacy_allocations (
  club_id uuid NOT NULL,
  source_id text NOT NULL CHECK (length(source_id) > 0),
  allocation_id uuid NOT NULL,
  PRIMARY KEY (club_id, source_id),
  UNIQUE (club_id, allocation_id),
  FOREIGN KEY (club_id, allocation_id) REFERENCES allocations(club_id, id)
);
