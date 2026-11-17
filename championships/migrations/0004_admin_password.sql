CREATE TABLE championship_admin_passwords (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES championship_memberships(user_id) ON DELETE CASCADE,
  salt TEXT NOT NULL CHECK (length(salt) = 32 AND salt NOT GLOB '*[^a-f0-9]*'),
  password_hash TEXT NOT NULL CHECK (length(password_hash) = 64 AND password_hash NOT GLOB '*[^a-f0-9]*'),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
