import { describe, expect, it } from "vitest";
import { loadAwsWorkerConfig } from "./config.js";

const required = {
  DATABASE_URL: "postgresql://example",
  ECS_CLUSTER: "rollout-guard",
  ALB_LISTENER_ARN: "listener",
  ALB_LOAD_BALANCER_DIMENSION: "app/demo/123",
  STABLE_ECS_SERVICE: "stable",
  STABLE_TARGET_GROUP_ARN: "stable-arn",
  STABLE_TARGET_GROUP_DIMENSION: "targetgroup/stable/123",
  CANDIDATE_ECS_SERVICE: "candidate",
  CANDIDATE_TARGET_GROUP_ARN: "candidate-arn",
  CANDIDATE_TARGET_GROUP_DIMENSION: "targetgroup/candidate/456"
};

describe("loadAwsWorkerConfig", () => {
  it("loads AWS resource mappings and safe defaults", () => {
    expect(loadAwsWorkerConfig(required)).toMatchObject({
      region: "us-east-1",
      stableRevisionId: "v1",
      candidateRevisionId: "v2",
      pollIntervalMs: 5_000
    });
  });

  it("rejects missing resource identifiers", () => {
    const { ALB_LISTENER_ARN: _, ...missingListener } = required;
    expect(() => loadAwsWorkerConfig(missingListener)).toThrow(
      "ALB_LISTENER_ARN is required"
    );
  });
});
