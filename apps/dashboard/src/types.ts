export type DeploymentState =
  | "QUEUED"
  | "STARTING_CANDIDATE"
  | "WAITING_FOR_HEALTH"
  | "CANARY_10"
  | "CANARY_50"
  | "FULL_TRAFFIC"
  | "OBSERVING"
  | "SUCCEEDED"
  | "ROLLING_BACK"
  | "ROLLED_BACK"
  | "FAILED";

export type Deployment = {
  id: string;
  stableRevisionId: string;
  candidateRevisionId: string | null;
  state: DeploymentState;
  stableWeight: number;
  candidateWeight: number;
  stateVersion: number;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Metrics = {
  requestCount: number;
  errorCount: number;
  errorRate: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
};

export type DeploymentEvent = {
  id: string;
  eventType: string;
  fromState: DeploymentState | null;
  toState: DeploymentState | null;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type DeploymentDetail = {
  deployment: Deployment;
  events: DeploymentEvent[];
  traffic: {
    stableWeight: number;
    candidateWeight: number;
  };
  metrics: {
    stable: Metrics;
    candidate: Metrics;
  };
};
