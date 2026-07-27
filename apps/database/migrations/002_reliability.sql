ALTER TABLE deployments
    ADD COLUMN IF NOT EXISTS reconcile_failure_count INTEGER NOT NULL DEFAULT 0
        CHECK (reconcile_failure_count >= 0),
    ADD COLUMN IF NOT EXISTS rollback_attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (rollback_attempt_count >= 0),
    ADD COLUMN IF NOT EXISTS next_reconcile_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_reconcile_error TEXT;

CREATE INDEX IF NOT EXISTS deployments_ready_for_reconciliation
    ON deployments(next_reconcile_at, created_at)
    WHERE state NOT IN ('SUCCEEDED', 'ROLLED_BACK', 'FAILED');
