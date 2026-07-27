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
         failure_reason, step_started_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
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
        deployment.failureReason,
        deployment.stepStartedAt,
        deployment.createdAt,
        deployment.updatedAt
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
       ORDER BY created_at ASC`
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
           failure_reason = $6,
           step_started_at = $7,
           updated_at = $8
       WHERE id = $9
         AND state_version = $10
       RETURNING state_version`,
      [
        deployment.candidateRevisionId,
        deployment.state,
        deployment.stableWeight,
        deployment.candidateWeight,
        deployment.currentStepIndex,
        deployment.failureReason,
        deployment.stepStartedAt,
        deployment.updatedAt,
        deployment.id,
        expectedStateVersion
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
