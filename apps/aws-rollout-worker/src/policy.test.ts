import { describe, expect, it } from "vitest";
import { awsRolloutPolicy } from "./policy.js";

describe("awsRolloutPolicy", () => {
  it("allows at least two CloudWatch periods before timing out", () => {
    expect(awsRolloutPolicy).toHaveLength(4);
    for (const step of awsRolloutPolicy) {
      expect(step.minimumDurationMs).toBeGreaterThanOrEqual(60_000);
      expect(step.maximumObservationMs).toBeGreaterThanOrEqual(120_000);
      expect(step.maximumObservationMs).toBeGreaterThan(
        step.minimumDurationMs
      );
    }
  });
});
