-- Organization-level branding settings. Safe to run more than once.
BEGIN;
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS primary_color VARCHAR(7) NOT NULL DEFAULT '#1E3ABA'
        CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$');
COMMIT;
