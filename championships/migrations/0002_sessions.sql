CREATE TABLE championship_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^a-f0-9]*'),
  user_id TEXT NOT NULL REFERENCES championship_memberships(user_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX championship_sessions_user ON championship_sessions(user_id);
CREATE INDEX championship_sessions_expiry ON championship_sessions(expires_at);

-- A disabled account must not regain access through an old session if re-enabled.
CREATE TRIGGER championship_revoke_disabled_account
AFTER UPDATE OF active ON championship_memberships
WHEN new.active = 0
BEGIN
  DELETE FROM championship_sessions WHERE user_id = new.user_id;
END;
