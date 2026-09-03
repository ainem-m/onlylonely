PRAGMA foreign_keys = ON;

CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  min_number INTEGER NOT NULL,
  max_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('setup','voting','closed','presenting','finished')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  seat_or_table TEXT,
  has_voted INTEGER NOT NULL DEFAULT 0,
  UNIQUE(game_id, display_name)
);

CREATE TABLE votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_id, participant_id)
);

CREATE TABLE presentation_state (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  current_number INTEGER,
  reveal_stage TEXT NOT NULL DEFAULT 'idle',
  current_champion_participant_id INTEGER REFERENCES participants(id),
  current_champion_number INTEGER,
  history_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_participants_game ON participants(game_id);
CREATE INDEX idx_votes_game_number ON votes(game_id, number);
