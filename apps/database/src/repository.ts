import type { QueryResult, QueryResultRow } from "pg";
import type {
  Deployment,
  DeploymentEvent,
  DeploymentState,
  RequestMetric,
  Service
} from "./types.js";

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<R>>;
}

type ServiceRow = {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
};

type DeploymentRow = {
  id: string;
  service_id: string;
  stable_revision_id: string;
  candidate_revision_id: string | null;
  state: DeploymentState;
  stable_weight: number;
  candidate_weight: number;
  current_step_index: number;
  state_version: number;
  reconcile_failure_count: number;
  rollback_attempt_count: number;
  next_reconcile_at: Date | null;
  last_reconcile_error: string | null;
  failure_reason: string | null;
  step_started_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type DeploymentEventRow = {
  id: string;
  deployment_id: string;
  event_type: string;
  from_state: DeploymentState | null;
  to_state: DeploymentState | null;
  message: string;
  metadata: Record<string, unknown>;
  created_at: Date;
};

function mapService(row: ServiceRow): Service {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    serviceId: row.service_id,
    stableRevisionId: row.stable_revision_id,
    candidateRevisionId: row.candidate_revision_id,
    state: row.state,
    stableWeight: row.stable_weight,
    candidateWeight: row.candidate_weight,
    currentStepIndex: row.current_step_index,
    stateVersion: row.state_version,
    reconcileFailureCount: row.reconcile_failure_count,
    rollbackAttemptCount: row.rollback_attempt_count,
    nextReconcileAt: row.next_reconcile_at,
    lastReconcileError: row.last_reconcile_error,
    failureReason: row.failure_reason,
    stepStartedAt: row.step_started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEvent(row: DeploymentEventRow): DeploymentEvent {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    eventType: row.event_type,
    fromState: row.from_state,
    toState: row.to_state,
    message: row.message,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}

export class PostgresDeploymentRepository {
  public constructor(private readonly database: Queryable) {}

  public async createService(service: Service): Promise<void> {
    await this.database.query(
      `INSERT INTO services (id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $4)`,
      [service.id, service.name, service.createdAt, service.updatedAt]
    );
  }

  public async getServiceById(id: string): Promise<Service | null> {
    const result = await this.database.query<ServiceRow>(
      `SELECT id, name, created_at, updated_at
       FROM services
       WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? mapService(row) : null;
  }

  public async getServiceByName(name: string): Promise<Service | null> {
    const result = await this.database.query<ServiceRow>(
      `SELECT id, name, created_at, updated_at
       FROM services
       WHERE name = $1`,
      [name]
    );
    const row = result.rows[0];
    return row ? mapService(row) : null;
  }

  public async createDeployment(deployment: Deployment): Promise<void> {
    await this.database.query(
      `INSERT INTO deployments (
         id, service_id, stable_revision_id, candidate_revision_id, state,
         stable_weight, candidate_weight, current_step_index, state_version,
         reconcile_failure_count, rollback_attempt_count, next_reconcile_at,
         last_reconcile_error, failure_reason, step_started_at, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17
       )`,
      [
        deployment.id,
        deployment.serviceId,
        deployment.stableRevisionId,
        deployment.candidateRevisionId,
        deployment.state,
        deployment.stableWeight,
        deployment.candidateWeight,
        deployment.currentStepIndex,
        deployment.stateVersion,
        deployment.reconcileFailureCount,
        deployment.rollbackAttemptCount,
        deployment.nextReconcileAt,
        deployment.lastReconcileError,
        deployment.failureReason,
        deployment.stepStartedAt,
        deployment.createdAt,
        deployment.updatedAt
      ]
    );
  }

  public async createDeploymentWithEvent(
    deployment: Deployment,
    event: DeploymentEvent
  ): Promise<void> {
    await this.database.query(
      `WITH inserted AS (
         INSERT INTO deployments (
           id, service_id, stable_revision_id, candidate_revision_id, state,
           stable_weight, candidate_weight, current_step_index, state_version,
           reconcile_failure_count, rollback_attempt_count, next_reconcile_at,
           last_reconcile_error, failure_reason, step_started_at, created_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
           $15, $16, $17
         )
         RETURNING id
       )
       INSERT INTO deployment_events (
         id, deployment_id, event_type, from_state, to_state,
         message, metadata, created_at
       )
       SELECT $18, inserted.id, $19, $20, $21, $22, $23::JSONB, $24
       FROM inserted`,
      [
        deployment.id,
        deployment.serviceId,
        deployment.stableRevisionId,
        deployment.candidateRevisionId,
        deployment.state,
        deployment.stableWeight,
        deployment.candidateWeight,
        deployment.currentStepIndex,
        deployment.stateVersion,
        deployment.reconcileFailureCount,
        deployment.rollbackAttemptCount,
        deployment.nextReconcileAt,
        deployment.lastReconcileError,
        deployment.failureReason,
        deployment.stepStartedAt,
        deployment.createdAt,
        deployment.updatedAt,
        event.id,
        event.eventType,
        event.fromState,
        event.toState,
        event.message,
        JSON.stringify(event.metadata),
        event.createdAt
      ]
    );
  }

  public async getDeploymentById(id: string): Promise<Deployment | null> {
    const result = await this.database.query<DeploymentRow>(
      `SELECT *
       FROM deployments
       WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? mapDeployment(row) : null;
  }

  public async listActiveDeployments(): Promise<Deployment[]> {
    const result = await this.database.query<DeploymentRow>(
      `SELECT *
       FROM deployments
       WHERE state NOT IN ('SUCCEEDED', 'ROLLED_BACK', 'FAILED')
         AND (next_reconcile_at IS NULL OR next_reconcile_at <= NOW())
       ORDER BY created_at ASC`
    );
    return result.rows.map(mapDeployment);
  }

  public async listDeployments(limit = 50): Promise<Deployment[]> {
    const result = await this.database.query<DeploymentRow>(
      `SELECT *
       FROM deployments
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map(mapDeployment);
  }

  public async updateDeployment(
    deployment: Deployment,
    expectedStateVersion: number
  ): Promise<boolean> {
    const result = await this.database.query<{ state_version: number }>(
      `UPDATE deployments
       SET candidate_revision_id = $1,
           state = $2,
           stable_weight = $3,
           candidate_weight = $4,
           current_step_index = $5,
           state_version = state_version + 1,
           reconcile_failure_count = $6,
           rollback_attempt_count = $7,
           next_reconcile_at = $8,
           last_reconcile_error = $9,
           failure_reason = $10,
           step_started_at = $11,
           updated_at = $12
       WHERE id = $13
         AND state_version = $14
       RETURNING state_version`,
      [
        deployment.candidateRevisionId,
        deployment.state,
        deployment.stableWeight,
        deployment.candidateWeight,
        deployment.currentStepIndex,
        deployment.reconcileFailureCount,
        deployment.rollbackAttemptCount,
        deployment.nextReconcileAt,
        deployment.lastReconcileError,
        deployment.failureReason,
        deployment.stepStartedAt,
        deployment.updatedAt,
        deployment.id,
        expectedStateVersion
      ]
    );
    return result.rowCount === 1;
  }

  public async transitionDeployment(
    deployment: Deployment,
    expectedStateVersion: number,
    event: DeploymentEvent
  ): Promise<boolean> {
    const result = await this.database.query<{ event_id: string }>(
      `WITH updated AS (
         UPDATE deployments
         SET candidate_revision_id = $1,
             state = $2,
             stable_weight = $3,
             candidate_weight = $4,
             current_step_index = $5,
             state_version = state_version + 1,
             reconcile_failure_count = $6,
             rollback_attempt_count = $7,
             next_reconcile_at = $8,
             last_reconcile_error = $9,
             failure_reason = $10,
             step_started_at = $11,
             updated_at = $12
         WHERE id = $13
           AND state_version = $14
         RETURNING id
       )
       INSERT INTO deployment_events (
         id, deployment_id, event_type, from_state, to_state,
         message, metadata, created_at
       )
       SELECT $15, updated.id, $16, $17, $18, $19, $20::JSONB, $21
       FROM updated
       RETURNING id AS event_id`,
      [
        deployment.candidateRevisionId,
        deployment.state,
        deployment.stableWeight,
        deployment.candidateWeight,
        deployment.currentStepIndex,
        deployment.reconcileFailureCount,
        deployment.rollbackAttemptCount,
        deployment.nextReconcileAt,
        deployment.lastReconcileError,
        deployment.failureReason,
        deployment.stepStartedAt,
        deployment.updatedAt,
        deployment.id,
        expectedStateVersion,
        event.id,
        event.eventType,
        event.fromState,
        event.toState,
        event.message,
        JSON.stringify(event.metadata),
        event.createdAt
      ]
    );
    return result.rowCount === 1;
  }

  public async recordReconcileFailure(input: {
    deploymentId: string;
    expectedStateVersion: number;
    error: string;
    nextReconcileAt: Date;
    isRollback: boolean;
  }): Promise<boolean> {
    const result = await this.database.query<{ state_version: number }>(
      `UPDATE deployments
       SET reconcile_failure_count = reconcile_failure_count + 1,
           rollback_attempt_count = rollback_attempt_count + CASE WHEN $1 THEN 1 ELSE 0 END,
           next_reconcile_at = $2,
           last_reconcile_error = $3,
           state_version = state_version + 1,
           updated_at = NOW()
       WHERE id = $4
         AND state_version = $5
       RETURNING state_version`,
      [
        input.isRollback,
        input.nextReconcileAt,
        input.error,
        input.deploymentId,
        input.expectedStateVersion
      ]
    );
    return result.rowCount === 1;
  }

  public async appendEvent(event: DeploymentEvent): Promise<void> {
    await this.database.query(
      `INSERT INTO deployment_events (
         id, deployment_id, event_type, from_state, to_state,
         message, metadata, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, $8)`,
      [
        event.id,
        event.deploymentId,
        event.eventType,
        event.fromState,
        event.toState,
        event.message,
        JSON.stringify(event.metadata),
        event.createdAt
      ]
    );
  }

  public async listEvents(deploymentId: string): Promise<DeploymentEvent[]> {
    const result = await this.database.query<DeploymentEventRow>(
      `SELECT *
       FROM deployment_events
       WHERE deployment_id = $1
       ORDER BY created_at ASC, id ASC`,
      [deploymentId]
    );
    return result.rows.map(mapEvent);
  }

  public async recordRequestMetric(metric: RequestMetric): Promise<void> {
    await this.database.query(
      `INSERT INTO request_metrics (
         id, deployment_id, revision_id, target, status_code, duration_ms, observed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        metric.id,
        metric.deploymentId,
        metric.revisionId,
        metric.target,
        metric.statusCode,
        metric.durationMs,
        metric.observedAt
      ]
    );
  }
}
