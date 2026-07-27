import type {
  Deployment,
  DeploymentEvent
} from "@rollout-guard/database";

export interface DeploymentStore {
  getDeploymentById(id: string): Promise<Deployment | null>;
  listActiveDeployments(): Promise<Deployment[]>;
  updateDeployment(
    deployment: Deployment,
    expectedStateVersion: number
  ): Promise<boolean>;
  appendEvent(event: DeploymentEvent): Promise<void>;
}

export interface RuntimeProvider {
  ensureCandidate(revisionId: string): Promise<void>;
  isRevisionHealthy(revisionId: string): Promise<boolean>;
}

export interface TrafficRouter {
  setWeights(input: {
    stableWeight: number;
    candidateWeight: number;
  }): Promise<void>;
}

export interface StepObservationProvider {
  getCandidateRequestCount(input: {
    revisionId: string;
    since: Date;
  }): Promise<number>;
}
