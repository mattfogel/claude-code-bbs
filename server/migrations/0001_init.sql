-- Accounts. The secret is never stored, only its SHA-256 (hex).
CREATE TABLE users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  handle       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  location     TEXT    NOT NULL DEFAULT '',
  secret_hash  TEXT    NOT NULL UNIQUE,
  role         TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'mod', 'sysop')),
  created_at   INTEGER NOT NULL,           -- unix seconds
  banned       INTEGER NOT NULL DEFAULT 0,
  muted_until  INTEGER NOT NULL DEFAULT 0  -- unix seconds
);

CREATE TABLE reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id  INTEGER NOT NULL REFERENCES users(id),
  kind         TEXT    NOT NULL,
  item_id      INTEGER NOT NULL,
  reason       TEXT    NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  resolved     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE modlog (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id     INTEGER NOT NULL REFERENCES users(id),
  action       TEXT    NOT NULL,
  target       TEXT    NOT NULL,
  detail       TEXT    NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
