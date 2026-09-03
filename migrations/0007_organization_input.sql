ALTER TABLE games ADD COLUMN organization_input_mode TEXT NOT NULL DEFAULT 'free'
  CHECK (organization_input_mode IN ('free','select'));
ALTER TABLE games ADD COLUMN organization_options_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE games ADD COLUMN organization_default TEXT;
