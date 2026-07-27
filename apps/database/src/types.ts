export const deploymentStates = [
  "QUEUED",
  "STARTING_CANDIDATE",
  "WAITING_FOR_HEALTH",
  "CANARY_10",
  "CANARY_50",
  "FULL_TRAFFIC",
  "OBSERVING",
  "SUCCEEDED",
  "ROLLING_BACK",
  "ROLLED_BACK",
  "FAILED"
] as const;

export type DeploymentState = (typeof deploymentStates)[number];

export type Service = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Deployment = {
  id: string;
  serviceId: string;
  stableRevisionId: string;
  candidateRevisionId: string | null;
  state: DeploymentState;
  stableWeight: number;
  candidateWeight: number;
  currentStepIndex: number;
  stateVersion: number;
  reconcileFailureCount: number;
  rollbackAttemptCount: number;
  nextReconcileAt: Date | null;
  lastReconcileError: string | null;
  failureReason: string | null;
  stepStartedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DeploymentEvent = {
  id: string;
  deploymentId: string;
  eventType: string;
  fromState: DeploymentState | null;
  toState: DeploymentState | null;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type RequestMetric = {
  id: string;
  deploymentId: string | null;
  revisionId: string;
  target: "stable" | "candidate";
  statusCode: number;
  durationMs: number;
  observedAt: Date;
};
