import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import {
  PostgresDeploymentRepository,
  type Queryable
} from "./repository.js";
import type { Deployment, DeploymentEvent, RequestMetric, Service } from "./types.js";

type CapturedQuery = {
  text: string;
  values: readonly unknown[];
};

function queryResult<R extends QueryResultRow>(
  rows: R[],
  rowCount = rows.length
): QueryResult<R> {
  return {
    command: "",
    rowCount,
    oid: 0,
    fields: [],
    rows
  };
}

class FakeDatabase implements Queryable {
  public readonly queries: CapturedQuery[] = [];
  public results: QueryResult<QueryResultRow>[] = [];

  public async query<R extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<R>> {
    this.queries.push({ text, values });
    return (this.results.shift() ?? queryResult([])) as QueryResult<R>;
  }
}

const timestamp = new Date("2026-07-27T12:00:00.000Z");

const service: Service = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "demo-service",
  createdAt: timestamp,
  updatedAt: timestamp
};

const deployment: Deployment = {
  id: "20000000-0000-4000-8000-000000000001",
  serviceId: service.id,
  stableRevisionId: "v1",
  candidateRevisionId: "v2",
  state: "CANARY_10",
  stableWeight: 90,
  candidateWeight: 10,
  currentStepIndex: 0,
  stateVersion: 2,
  reconcileFailureCount: 0,
  rollbackAttemptCount: 0,
  nextReconcileAt: null,
  lastReconcileError: null,
  failureReason: null,
  stepStartedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp
};

describe("PostgresDeploymentRepository", () => {
  it("creates and maps services and deployments", async () => {
    const database = new FakeDatabase();
    const repository = new PostgresDeploymentRepository(database);

    await repository.createService(service);
    await repository.createDeployment(deployment);
    database.results.push(
      queryResult([
        {
          id: deployment.id,
          service_id: service.id,
          stable_revision_id: "v1",
          candidate_revision_id: "v2",
          state: "CANARY_10",
          stable_weight: 90,
          candidate_weight: 10,
          current_step_index: 0,
          state_version: 2,
          reconcile_failure_count: 0,
          rollback_attempt_count: 0,
          next_reconcile_at: null,
          last_reconcile_error: null,
          failure_reason: null,
          step_started_at: timestamp,
          created_at: timestamp,
          updated_at: timestamp
        }
      ])
    );

    await expect(repository.getDeploymentById(deployment.id)).resolves.toEqual(
      deployment
    );
    expect(database.queries[0]?.text).toContain("INSERT INTO services");
    expect(database.queries[1]?.text).toContain("INSERT INTO deployments");
  });

  it("finds a service by its stable name", async () => {
    const database = new FakeDatabase();
    const repository = new PostgresDeploymentRepository(database);
    database.results.push(
      queryResult([
        {
          id: service.id,
          name: service.name,
          created_at: timestamp,
          updated_at: timestamp
        }
      ])
    );

    await expect(repository.getServiceByName(service.name)).resolves.toEqual(
      service
    );
    expect(database.queries[0]?.values).toEqual([service.name]);
  });

  it("uses state_version for optimistic concurrency", async () => {
    const database = new FakeDatabase();
    const repository = new PostgresDeploymentRepository(database);
    database.results.push(queryResult([{ state_version: 3 }], 1));
    database.results.push(queryResult([], 0));

    await expect(repository.updateDeployment(deployment, 2)).resolves.toBe(true);
    await expect(repository.updateDeployment(deployment, 1)).resolves.toBe(false);

    const update = database.queries[0];
    expect(update?.text).toContain("state_version = state_version + 1");
    expect(update?.text).toContain("AND state_version = $14");
    expect(update?.values.at(-1)).toBe(2);
  });

  it("lists only active deployments in creation order", async () => {
    const database = new FakeDatabase();
    const repository = new PostgresDeploymentRepository(database);
    database.results.push(queryResult([]));

    await expect(repository.listActiveDeployments()).resolves.toEqual([]);

    expect(database.queries[0]?.text).toContain(
      "state NOT IN ('SUCCEEDED', 'ROLLED_BACK', 'FAILED')"
    );
    expect(database.queries[0]?.text).toContain("ORDER BY created_at ASC");
  });

  it("persists events and request observations", async () => {
    const database = new FakeDatabase();
    const repository = new PostgresDeploymentRepository(database);
    const event: DeploymentEvent = {
      id: "30000000-0000-4000-8000-000000000001",
      deploymentId: deployment.id,
      eventType: "STATE_CHANGED",
      fromState: "WAITING_FOR_HEALTH",
      toState: "CANARY_10",
      message: "Candidate received 10% traffic",
      metadata: { stableWeight: 90, candidateWeight: 10 },
      createdAt: timestamp
    };
    const metric: RequestMetric = {
      id: "40000000-0000-4000-8000-000000000001",
      deploymentId: deployment.id,
      revisionId: "v2",
      target: "candidate",
      statusCode: 500,
      durationMs: 301,
      observedAt: timestamp
    };

    await repository.appendEvent(event);
    await repository.recordRequestMetric(metric);

    expect(database.queries[0]?.text).toContain("INSERT INTO deployment_events");
    expect(database.queries[0]?.values[6]).toBe(
      JSON.stringify(event.metadata)
    );
    expect(database.queries[1]?.text).toContain("INSERT INTO request_metrics");
  });

  it("writes a transition and its event atomically", async () => {
    const database = new FakeDatabase();
    const repository = new PostgresDeploymentRepository(database);
    database.results.push(queryResult([{ event_id: "event-1" }]));
    const event: DeploymentEvent = {
      id: "30000000-0000-4000-8000-000000000001",
      deploymentId: deployment.id,
      eventType: "STATE_CHANGED",
      fromState: "WAITING_FOR_HEALTH",
      toState: "CANARY_10",
      message: "Candidate received traffic",
      metadata: {},
      createdAt: timestamp
    };

    await expect(
      repository.transitionDeployment(deployment, 2, event)
    ).resolves.toBe(true);

    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]?.text).toContain("WITH updated AS");
    expect(database.queries[0]?.text).toContain(
      "INSERT INTO deployment_events"
    );
  });

  it("creates a deployment and initial event atomically", async () => {
    const database = new FakeDatabase();
    const repository = new PostgresDeploymentRepository(database);
    const event: DeploymentEvent = {
      id: "30000000-0000-4000-8000-000000000001",
      deploymentId: deployment.id,
      eventType: "DEPLOYMENT_CREATED",
      fromState: null,
      toState: "QUEUED",
      message: "Deployment created",
      metadata: {},
      createdAt: timestamp
    };

    await repository.createDeploymentWithEvent(deployment, event);

    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]?.text).toContain("WITH inserted AS");
    expect(database.queries[0]?.text).toContain(
      "INSERT INTO deployment_events"
    );
  });

  it("lists recent deployments with a bounded query", async () => {
    const database = new FakeDatabase();
    const repository = new PostgresDeploymentRepository(database);
    database.results.push(queryResult([]));

    await expect(repository.listDeployments(25)).resolves.toEqual([]);

    expect(database.queries[0]?.text).toContain("ORDER BY created_at DESC");
    expect(database.queries[0]?.values).toEqual([25]);
  });

  it("records retry state with optimistic concurrency", async () => {
    const database = new FakeDatabase();
    const repository = new PostgresDeploymentRepository(database);
    database.results.push(queryResult([{ state_version: 3 }]));
    const nextReconcileAt = new Date("2026-07-27T12:00:01.000Z");

    await expect(
      repository.recordReconcileFailure({
        deploymentId: deployment.id,
        expectedStateVersion: 2,
        error: "router unavailable",
        nextReconcileAt,
        isRollback: true
      })
    ).resolves.toBe(true);

    expect(database.queries[0]?.text).toContain(
      "reconcile_failure_count = reconcile_failure_count + 1"
    );
    expect(database.queries[0]?.values).toEqual([
      true,
      nextReconcileAt,
      "router unavailable",
      deployment.id,
      2
    ]);
  });
});
