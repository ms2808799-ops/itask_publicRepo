-- iTask workflow hardening migration.
-- Run once against itask_main_db as a database owner/superuser.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_assignments_id_organization'
          AND conrelid = 'assignments'::regclass
    ) THEN
        ALTER TABLE assignments
            ADD CONSTRAINT uq_assignments_id_organization UNIQUE (id, organization_id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'submissions_assignment_id_fkey'
          AND conrelid = 'submissions'::regclass
    ) THEN
        ALTER TABLE submissions DROP CONSTRAINT submissions_assignment_id_fkey;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_submission_assignment_same_organization'
          AND conrelid = 'submissions'::regclass
    ) THEN
        ALTER TABLE submissions
            ADD CONSTRAINT fk_submission_assignment_same_organization
            FOREIGN KEY (assignment_id, organization_id)
            REFERENCES assignments (id, organization_id)
            ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assignments_org_deadline
    ON assignments (organization_id, deadline);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment_org
    ON submissions (assignment_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_submissions_ungraded
    ON submissions (organization_id, grade) WHERE grade IS NULL;

COMMIT;
