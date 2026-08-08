import type { Deployment } from "@rollout-guard/database";
import { describe, expect, it, vi } from "vitest";
import { buildControlApi, type ControlApiService } from "./app.js";
import { ConflictError, NotFoundError } from "./service.js";

const now = new Date("2026-07-27T12:00:00.000Z");
const deployment: Deployment = {
  id: "deployment-1",
  serviceId: "service-1",
  stableRevisionId: "v1",
  candidateRevisionId: "v2",
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

function fakeService(
  overrides: Partial<ControlApiService> = {}
): ControlApiService {
  return {
    createDeployment: vi.fn(async () => deployment),
    listDeployments: vi.fn(async () => [deployment]),
    getDeployment: vi.fn(async () => {
      throw new NotFoundError("not found");
    }),
    requestRollback: vi.fn(async () => {
      throw new ConflictError("already terminal");
    }),
    startDemoLoad: vi.fn(),
    ...overrides
  };
}

describe("control API", () => {
  it("creates and lists deployments", async () => {
    const service = fakeService();
    const app = await buildControlApi({
      service,
      dashboardOrigin: "http://localhost:3000"
    });

    const created = await app.inject({
      method: "POST",
      url: "/deployments",
      payload: {
        serviceName: "demo-service",
        stableRevisionId: "v1",
        candidateRevisionId: "v2"
      }
    });
    const listed = await app.inject({ method: "GET", url: "/deployments" });

    expect(created.statusCode).toBe(201);
    expect(created.json().deployment.id).toBe("deployment-1");
    expect(listed.json().deployments).toHaveLength(1);
    await app.close();
  });

  it("validates deployment and load inputs", async () => {
    const app = await buildControlApi({
      service: fakeService(),
      dashboardOrigin: "http://localhost:3000"
    });
    const invalidDeployment = await app.inject({
      method: "POST",
      url: "/deployments",
      payload: {}
    });
    const invalidLoad = await app.inject({
      method: "POST",
      url: "/demo/load",
      payload: { durationSeconds: 0, requestsPerSecond: 25 }
    });

    expect(invalidDeployment.statusCode).toBe(400);
    expect(invalidLoad.statusCode).toBe(400);
    await app.close();
  });

  it("maps missing and conflicting deployments to HTTP errors", async () => {
    const app = await buildControlApi({
      service: fakeService(),
      dashboardOrigin: "http://localhost:3000"
    });

    expect(
      (await app.inject({ method: "GET", url: "/deployments/missing" }))
        .statusCode
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/deployments/deployment-1/rollback"
        })
      ).statusCode
    ).toBe(409);
    await app.close();
  });
});
