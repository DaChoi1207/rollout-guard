import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migration.js";
import { createDatabasePool } from "./pool.js";
import { PostgresDeploymentRepository } from "./repository.js";
import type { Deployment, Service } from "./types.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? createDatabasePool(databaseUrl) : null;
const deploymentIds: string[] = [];
const serviceIds: string[] = [];

describeWithDatabase("PostgreSQL persistence", () => {
  beforeAll(async () => {
    if (!databaseUrl || !pool) {
      return;
    }
    await runMigrations(databaseUrl);
  });

  afterAll(async () => {
    if (pool && deploymentIds.length > 0) {
      await pool.query("DELETE FROM deployments WHERE id = ANY($1::UUID[])", [
        deploymentIds
      ]);
    }
    if (pool && serviceIds.length > 0) {
      await pool.query("DELETE FROM services WHERE id = ANY($1::UUID[])", [
        serviceIds
      ]);
    }
    await pool?.end();
  });

  it("reloads a deployment through a new repository instance", async () => {
    if (!pool) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const service: Service = {
      id: randomUUID(),
      name: `demo-${randomUUID()}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const deployment: Deployment = {
      id: randomUUID(),
      serviceId: service.id,
      stableRevisionId: "v1",
      candidateRevisionId: "v2",
      state: "SUCCEEDED",
      stableWeight: 0,
      candidateWeight: 100,
      currentStepIndex: 0,
      stateVersion: 0,
      reconcileFailureCount: 0,
      rollbackAttemptCount: 0,
      nextReconcileAt: null,
      lastReconcileError: null,
      failureReason: null,
      stepStartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    serviceIds.push(service.id);
    deploymentIds.push(deployment.id);

    await new PostgresDeploymentRepository(pool).createService(service);
    await new PostgresDeploymentRepository(pool).createDeployment(deployment);

    const reloaded = await new PostgresDeploymentRepository(
      pool
    ).getDeploymentById(deployment.id);

    expect(reloaded).toEqual(deployment);
  });
});
