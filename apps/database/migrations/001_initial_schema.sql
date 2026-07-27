CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY,
    service_id UUID NOT NULL REFERENCES services(id),
    stable_revision_id TEXT NOT NULL,
    candidate_revision_id TEXT,
    state TEXT NOT NULL CHECK (state IN (
        'QUEUED',
        'STARTING_CANDIDATE',
        'WAITING_FOR_HEALTH',
        'CANARY_10',
        'CANARY_50',
        'FULL_TRAFFIC',
        'OBSERVING',
        'SUCCEEDED',
        'ROLLING_BACK',
        'ROLLED_BACK',
        'FAILED'
    )),
    stable_weight INTEGER NOT NULL CHECK (stable_weight BETWEEN 0 AND 100),
    candidate_weight INTEGER NOT NULL CHECK (candidate_weight BETWEEN 0 AND 100),
    current_step_index INTEGER NOT NULL DEFAULT 0 CHECK (current_step_index >= 0),
    state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0),
    failure_reason TEXT,
    step_started_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT deployment_weights_sum_to_100
        CHECK (stable_weight + candidate_weight = 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_deployment_per_service
    ON deployments(service_id)
    WHERE state NOT IN ('SUCCEEDED', 'ROLLED_BACK', 'FAILED');

CREATE TABLE IF NOT EXISTS deployment_events (
    id UUID PRIMARY KEY,
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT,
    message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deployment_events_timeline
    ON deployment_events(deployment_id, created_at, id);

CREATE TABLE IF NOT EXISTS request_metrics (
    id UUID PRIMARY KEY,
    deployment_id UUID REFERENCES deployments(id) ON DELETE CASCADE,
    revision_id TEXT NOT NULL,
    target TEXT NOT NULL CHECK (target IN ('stable', 'candidate')),
    status_code INTEGER NOT NULL CHECK (status_code BETWEEN 0 AND 599),
    duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
    observed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS request_metrics_analysis_window
    ON request_metrics(deployment_id, revision_id, observed_at);
