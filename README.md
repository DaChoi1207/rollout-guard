# Rollout Guard

Local-first progressive deployment control plane foundation.

The completed local foundation includes:

- A configurable Fastify demo service.
- Stable and candidate Docker Compose revisions.
- A local weighted reverse proxy.
- Tests for simulated failures and weighted routing.
- A PostgreSQL schema and repository for services, deployments, events, and metrics.
- Optimistic concurrency and a one-active-deployment-per-service constraint.
- A reconciliation worker with an explicit deployment state machine.
- Candidate health checks and staged 10% → 50% → 100% traffic progression.
- Minimum observation-duration and candidate-request-count gates.

## Run Locally

```powershell
npm.cmd install
npm.cmd test
docker compose up --build
```

Useful endpoints:

- Stable revision: `http://localhost:3001/version`
- Candidate revision: `http://localhost:3002/version`
- Router entry point: `http://localhost:8080/api/demo`
- Router traffic update:

```http
PUT http://localhost:8080/internal/traffic
Content-Type: application/json

{
  "stableWeight": 90,
  "candidateWeight": 10
}
```

## Rollout worker

The rollout worker processes active deployments from PostgreSQL. Each
reconciliation performs at most one state transition:

```text
QUEUED
→ STARTING_CANDIDATE
→ WAITING_FOR_HEALTH
→ CANARY_10
→ CANARY_50
→ FULL_TRAFFIC
→ OBSERVING
→ SUCCEEDED
```

Traffic commands use absolute weights, so retrying a command after a crash is
safe. State updates use `state_version` optimistic concurrency so two workers
cannot both commit the same transition.

At each observation step, the worker now calculates error rate and nearest-rank
p50/p95/p99 latency separately for stable and candidate revisions. It waits for
the minimum duration and sample size, requires a stable baseline, and rolls back
when:

- candidate HTTP 5xx error rate exceeds 2%; or
- candidate p95 latency exceeds both 1.5× stable p95 and the 500 ms floor.

Rollback uses the idempotent absolute command `stable=100, candidate=0`, verifies
stable health, persists the failure reason, and records analysis metrics in the
deployment event.

Create a local demo deployment after the Compose services are running:

```powershell
$env:DATABASE_URL="postgresql://rollout_guard:rollout_guard@localhost:5432/rollout_guard"
npm.cmd run deployment:create
```

Run `npm.cmd run load:local` in another terminal so each step receives enough
traffic. The default Compose candidate has a 15% simulated error rate and should
finish as `ROLLED_BACK`.

Generate local traffic through the router:

```powershell
npm.cmd run load:local
```

PostgreSQL is available on `localhost:5432` with the local-only credentials
`rollout_guard` / `rollout_guard`. Docker initializes a fresh volume from
`apps/database/migrations`. To apply the idempotent migration manually:

```powershell
$env:DATABASE_URL="postgresql://rollout_guard:rollout_guard@localhost:5432/rollout_guard"
npm.cmd run db:migrate
```

To include the real PostgreSQL repository integration test:

```powershell
$env:TEST_DATABASE_URL="postgresql://rollout_guard:rollout_guard@localhost:5432/rollout_guard"
npm.cmd test
```

Or customize the run:

```powershell
npm.cmd run start --workspace @rollout-guard/load-generator -- --target http://localhost:8080/api/demo --requests-per-second 25 --duration-seconds 60 --concurrency 10
```
