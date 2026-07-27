# Rollout Guard

Local-first progressive deployment control plane foundation.

The completed local foundation includes:

- A configurable Fastify demo service.
- Stable and candidate Docker Compose revisions.
- A local weighted reverse proxy.
- Tests for simulated failures and weighted routing.
- A PostgreSQL schema and repository for services, deployments, events, and metrics.
- Optimistic concurrency and a one-active-deployment-per-service constraint.

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
