import { describe, expect, it } from "vitest";
import {
  assertTransitionAllowed,
  isTransitionAllowed
} from "./state-machine.js";

describe("deployment state machine", () => {
  it("allows the healthy rollout path", () => {
    expect(isTransitionAllowed("QUEUED", "STARTING_CANDIDATE")).toBe(true);
    expect(isTransitionAllowed("WAITING_FOR_HEALTH", "CANARY_10")).toBe(true);
    expect(isTransitionAllowed("CANARY_10", "CANARY_50")).toBe(true);
    expect(isTransitionAllowed("OBSERVING", "SUCCEEDED")).toBe(true);
  });

  it("rejects skipped and terminal-state transitions", () => {
    expect(() => assertTransitionAllowed("QUEUED", "CANARY_50")).toThrow(
      "Illegal deployment transition"
    );
    expect(() => assertTransitionAllowed("SUCCEEDED", "CANARY_10")).toThrow(
      "Illegal deployment transition"
    );
  });
});
