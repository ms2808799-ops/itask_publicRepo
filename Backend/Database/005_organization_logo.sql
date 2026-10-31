-- Adds an organization-scoped logo data URL. Run once against itask_main_db.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_data_url TEXT;
