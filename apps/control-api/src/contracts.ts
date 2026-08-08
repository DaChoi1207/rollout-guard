import type {
  Deployment,
  DeploymentEvent,
  Service
} from "@rollout-guard/database";

export interface ControlRepository {
  getServiceByName(name: string): Promise<Service | null>;
  createService(service: Service): Promise<void>;
  createDeploymentWithEvent(
    deployment: Deployment,
    event: DeploymentEvent
  ): Promise<void>;
  listDeployments(limit?: number): Promise<Deployment[]>;
  getDeploymentById(id: string): Promise<Deployment | null>;
  listEvents(deploymentId: string): Promise<DeploymentEvent[]>;
  transitionDeployment(
    deployment: Deployment,
    expectedStateVersion: number,
    event: DeploymentEvent
  ): Promise<boolean>;
}

export type RevisionMetrics = {
  requestCount: number;
  errorCount: number;
  errorRate: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
};

export interface RouterClient {
  getWeights(): Promise<{ stableWeight: number; candidateWeight: number }>;
  getMetrics(input: {
    revisionId: string;
    since: Date;
  }): Promise<RevisionMetrics>;
  generateLoad(input: {
    durationSeconds: number;
    requestsPerSecond: number;
  }): void;
}
