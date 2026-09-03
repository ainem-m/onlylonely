ALTER TABLE participants ADD COLUMN access_token TEXT;
UPDATE participants SET access_token=lower(hex(randomblob(16))) WHERE access_token IS NULL;
CREATE UNIQUE INDEX idx_participants_access_token ON participants(access_token);
