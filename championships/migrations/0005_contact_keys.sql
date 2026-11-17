ALTER TABLE championship_players ADD COLUMN contact_key TEXT;
CREATE UNIQUE INDEX championship_player_contact_key ON championship_players(contact_key) WHERE contact_key IS NOT NULL;
