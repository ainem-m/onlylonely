ALTER TABLE games ADD COLUMN current_round_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE games ADD COLUMN ended_at INTEGER;
ALTER TABLE games ADD COLUMN purge_after INTEGER;
ALTER TABLE games ADD COLUMN last_activity_at INTEGER;
UPDATE games SET last_activity_at=unixepoch() WHERE last_activity_at IS NULL;
CREATE INDEX idx_games_purge_after ON games(purge_after) WHERE purge_after IS NOT NULL;
CREATE INDEX idx_games_open_last_activity ON games(last_activity_at) WHERE ended_at IS NULL;

ALTER TABLE admin_auth ADD COLUMN game_id INTEGER;
ALTER TABLE admin_auth ADD COLUMN session_version TEXT NOT NULL DEFAULT '';
UPDATE admin_auth SET game_id=(SELECT id FROM games ORDER BY id DESC LIMIT 1),
  session_version=lower(hex(randomblob(16))) WHERE id=1;

CREATE UNIQUE INDEX idx_participants_id_game ON participants(id,game_id);

CREATE TABLE game_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number >= 1),
  status TEXT NOT NULL CHECK (status IN ('setup','voting','closed','presenting','finished')),
  started_at INTEGER,
  finished_at INTEGER,
  champion_participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
  champion_number INTEGER,
  champion_name TEXT,
  champion_organization TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(game_id,round_number),
  UNIQUE(id,game_id)
);

INSERT INTO game_rounds(game_id,round_number,status,started_at,finished_at,created_at)
SELECT id,1,status,
  CASE WHEN status='setup' THEN NULL ELSE unixepoch(created_at) END,
  CASE WHEN status='finished' THEN unixepoch() ELSE NULL END,
  unixepoch(created_at)
FROM games;

CREATE TABLE round_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  participant_id INTEGER NOT NULL,
  number INTEGER NOT NULL,
  display_name_snapshot TEXT NOT NULL,
  organization_snapshot TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(round_id,participant_id),
  FOREIGN KEY(round_id,game_id) REFERENCES game_rounds(id,game_id) ON DELETE CASCADE,
  FOREIGN KEY(participant_id,game_id) REFERENCES participants(id,game_id) ON DELETE CASCADE
);

CREATE INDEX idx_round_votes_round_number ON round_votes(round_id,number);

INSERT INTO round_votes(round_id,game_id,participant_id,number,display_name_snapshot,organization_snapshot,created_at)
SELECT gr.id,v.game_id,v.participant_id,v.number,
  CASE WHEN g.registration_mode='self-registration' THEN r.display_name ELSE p.display_name END,
  CASE WHEN g.registration_mode='self-registration' THEN r.organization ELSE NULL END,
  unixepoch(v.created_at)
FROM votes v
JOIN games g ON g.id=v.game_id
JOIN game_rounds gr ON gr.game_id=g.id AND gr.round_number=1
JOIN participants p ON p.id=v.participant_id
LEFT JOIN participant_registrations r ON r.participant_id=p.id;

CREATE TABLE round_presentation_state (
  round_id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL,
  current_number INTEGER,
  reveal_stage TEXT NOT NULL DEFAULT 'idle',
  current_champion_participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
  current_champion_number INTEGER,
  history_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(round_id,game_id) REFERENCES game_rounds(id,game_id) ON DELETE CASCADE,
  FOREIGN KEY(current_champion_participant_id,game_id) REFERENCES participants(id,game_id)
);

INSERT INTO round_presentation_state(round_id,game_id,current_number,reveal_stage,
  current_champion_participant_id,current_champion_number,history_json,revision)
SELECT gr.id,ps.game_id,ps.current_number,ps.reveal_stage,
  ps.current_champion_participant_id,ps.current_champion_number,ps.history_json,ps.revision
FROM presentation_state ps
JOIN game_rounds gr ON gr.game_id=ps.game_id AND gr.round_number=1;

UPDATE game_rounds SET
  champion_participant_id=(SELECT current_champion_participant_id FROM presentation_state WHERE game_id=game_rounds.game_id),
  champion_number=(SELECT current_champion_number FROM presentation_state WHERE game_id=game_rounds.game_id),
  champion_name=(SELECT CASE WHEN g.registration_mode='self-registration' THEN r.display_name ELSE p.display_name END
    FROM presentation_state ps JOIN participants p ON p.id=ps.current_champion_participant_id
    JOIN games g ON g.id=ps.game_id LEFT JOIN participant_registrations r ON r.participant_id=p.id
    WHERE ps.game_id=game_rounds.game_id),
  champion_organization=(SELECT CASE WHEN g.show_organization_in_results=1 THEN r.organization ELSE NULL END
    FROM presentation_state ps JOIN participants p ON p.id=ps.current_champion_participant_id
    JOIN games g ON g.id=ps.game_id LEFT JOIN participant_registrations r ON r.participant_id=p.id
    WHERE ps.game_id=game_rounds.game_id)
WHERE status='finished';

CREATE TRIGGER sync_game_status_to_current_round
AFTER UPDATE OF status ON games
WHEN EXISTS(SELECT 1 FROM game_rounds WHERE game_id=NEW.id AND round_number=NEW.current_round_number AND status<>NEW.status)
BEGIN
  UPDATE game_rounds SET status=NEW.status
  WHERE game_id=NEW.id AND round_number=NEW.current_round_number;
END;

CREATE TRIGGER sync_current_round_status_to_game
AFTER UPDATE OF status ON game_rounds
WHEN NEW.round_number=(SELECT current_round_number FROM games WHERE id=NEW.game_id)
  AND NEW.status<>(SELECT status FROM games WHERE id=NEW.game_id)
BEGIN
  UPDATE games SET status=NEW.status WHERE id=NEW.game_id;
END;

CREATE TRIGGER bridge_legacy_vote_insert
AFTER INSERT ON votes
BEGIN
  INSERT OR IGNORE INTO round_votes(round_id,game_id,participant_id,number,display_name_snapshot,organization_snapshot,created_at)
  SELECT gr.id,NEW.game_id,NEW.participant_id,NEW.number,
    CASE WHEN g.registration_mode='self-registration' THEN r.display_name ELSE p.display_name END,
    CASE WHEN g.registration_mode='self-registration' THEN r.organization ELSE NULL END,
    unixepoch(NEW.created_at)
  FROM games g
  JOIN game_rounds gr ON gr.game_id=g.id AND gr.round_number=g.current_round_number
  JOIN participants p ON p.id=NEW.participant_id
  LEFT JOIN participant_registrations r ON r.participant_id=p.id
  WHERE g.id=NEW.game_id;
END;

CREATE TRIGGER bridge_legacy_vote_delete
AFTER DELETE ON votes
BEGIN
  DELETE FROM round_votes
  WHERE game_id=OLD.game_id AND participant_id=OLD.participant_id
    AND round_id=(SELECT gr.id FROM game_rounds gr JOIN games g ON g.id=gr.game_id
      WHERE g.id=OLD.game_id AND gr.round_number=g.current_round_number);
END;

CREATE TRIGGER bridge_legacy_presentation_update
AFTER UPDATE ON presentation_state
BEGIN
  UPDATE round_presentation_state SET current_number=NEW.current_number,reveal_stage=NEW.reveal_stage,
    current_champion_participant_id=NEW.current_champion_participant_id,
    current_champion_number=NEW.current_champion_number,history_json=NEW.history_json,revision=NEW.revision
  WHERE round_id=(SELECT gr.id FROM game_rounds gr JOIN games g ON g.id=gr.game_id
    WHERE g.id=NEW.game_id AND gr.round_number=g.current_round_number);
END;
