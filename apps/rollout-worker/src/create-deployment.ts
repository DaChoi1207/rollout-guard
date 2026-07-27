import { randomUUID } from "node:crypto";
import {
  createDatabasePool,
  PostgresDeploymentRepository,
  type Deployment,
  type Service
} from "@rollout-guard/database";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const databaseUrl = required("DATABASE_URL");
const serviceName = process.env.SERVICE_NAME ?? "demo-service";
const stableRevisionId = process.env.STABLE_REVISION_ID ?? "v1";
const candidateRevisionId = process.env.CANDIDATE_REVISION_ID ?? "v2";
const pool = createDatabasePool(databaseUrl);
const repository = new PostgresDeploymentRepository(pool);

try {
  let service = await repository.getServiceByName(serviceName);
  if (!service) {
    const now = new Date();
    service = {
      id: randomUUID(),
      name: serviceName,
      createdAt: now,
      updatedAt: now
    } satisfies Service;
    await repository.createService(service);
  }

  const now = new Date();
  const deployment: Deployment = {
    id: randomUUID(),
    serviceId: service.id,
    stableRevisionId,
    candidateRevisionId,
    state: "QUEUED",
    stableWeight: 100,
    candidateWeight: 0,
    currentStepIndex: 0,
    stateVersion: 0,
    reconcileFailureCount: 0,
    rollbackAttemptCount: 0,
    nextReconcileAt: null,
    lastReconcileError: null,
    failureReason: null,
    stepStartedAt: null,
    createdAt: now,
    updatedAt: now
  };
  await repository.createDeployment(deployment);
  await repository.appendEvent({
    id: randomUUID(),
    deploymentId: deployment.id,
    eventType: "DEPLOYMENT_CREATED",
    fromState: null,
    toState: "QUEUED",
    message: `Deployment from ${stableRevisionId} to ${candidateRevisionId} created`,
    metadata: { serviceName },
    createdAt: now
  });

  console.log(
    JSON.stringify(
      {
        deploymentId: deployment.id,
        serviceId: service.id,
        state: deployment.state,
        stableRevisionId,
        candidateRevisionId
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
