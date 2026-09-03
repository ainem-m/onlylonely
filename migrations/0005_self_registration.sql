ALTER TABLE games ADD COLUMN registration_mode TEXT NOT NULL DEFAULT 'roster'
  CHECK (registration_mode IN ('roster','self-registration'));
ALTER TABLE games ADD COLUMN organization_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN organization_label TEXT NOT NULL DEFAULT '所属';
ALTER TABLE games ADD COLUMN organization_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN show_organization_in_results INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN shared_access_token TEXT;

UPDATE games SET shared_access_token=lower(hex(randomblob(16))) WHERE shared_access_token IS NULL;
CREATE UNIQUE INDEX idx_games_shared_access_token ON games(shared_access_token);

ALTER TABLE participants ADD COLUMN card_number INTEGER;
CREATE UNIQUE INDEX idx_participants_game_card_number
  ON participants(game_id, card_number) WHERE card_number IS NOT NULL;

CREATE TABLE participant_registrations (
  participant_id INTEGER PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  organization TEXT,
  registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
