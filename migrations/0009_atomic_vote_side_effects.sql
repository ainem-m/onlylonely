CREATE TRIGGER round_votes_after_insert
AFTER INSERT ON round_votes
BEGIN
  UPDATE games
  SET last_activity_at = unixepoch()
  WHERE id = NEW.game_id AND ended_at IS NULL;

  UPDATE game_rounds
  SET status = 'closed'
  WHERE id = NEW.round_id
    AND status = 'voting'
    AND NOT EXISTS (
      SELECT 1
      FROM participants p
      LEFT JOIN round_votes v
        ON v.round_id = NEW.round_id AND v.participant_id = p.id
      WHERE p.game_id = NEW.game_id AND v.id IS NULL
    );
END;
