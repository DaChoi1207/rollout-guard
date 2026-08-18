import {
  DescribeServicesCommand,
  UpdateServiceCommand,
  type ECSClient
} from "@aws-sdk/client-ecs";
import {
  DescribeTargetHealthCommand,
  type ElasticLoadBalancingV2Client
} from "@aws-sdk/client-elastic-load-balancing-v2";
import type { RuntimeProvider } from "@rollout-guard/rollout-worker";

export type RevisionRuntime = {
  serviceName: string;
  targetGroupArn: string;
};

export type EcsRuntimeConfig = {
  cluster: string;
  revisions: Readonly<Record<string, RevisionRuntime>>;
  candidateDesiredCount?: number;
};

type EcsSender = Pick<ECSClient, "send">;
type ElbSender = Pick<ElasticLoadBalancingV2Client, "send">;

export class EcsRuntimeProvider implements RuntimeProvider {
  public constructor(
    private readonly ecs: EcsSender,
    private readonly elb: ElbSender,
    private readonly config: EcsRuntimeConfig
  ) {}

  public async ensureCandidate(revisionId: string): Promise<void> {
    await this.setDesiredCount(
      revisionId,
      this.config.candidateDesiredCount ?? 1
    );
  }

  public async stopCandidate(revisionId: string): Promise<void> {
    await this.setDesiredCount(revisionId, 0);
  }

  private async setDesiredCount(
    revisionId: string,
    desiredCount: number
  ): Promise<void> {
    const revision = this.revision(revisionId);
    const response = await this.ecs.send(
      new DescribeServicesCommand({
        cluster: this.config.cluster,
        services: [revision.serviceName]
      })
    );
    const service = response.services?.[0];
    if (!service || service.status === "INACTIVE") {
      throw new Error(`ECS service ${revision.serviceName} was not found`);
    }

    if (service.desiredCount !== desiredCount) {
      await this.ecs.send(
        new UpdateServiceCommand({
          cluster: this.config.cluster,
          service: revision.serviceName,
          desiredCount
        })
      );
    }
  }

  public async isRevisionHealthy(revisionId: string): Promise<boolean> {
    const revision = this.revision(revisionId);
    const response = await this.elb.send(
      new DescribeTargetHealthCommand({
        TargetGroupArn: revision.targetGroupArn
      })
    );
    const targets = response.TargetHealthDescriptions ?? [];
    return (
      targets.length > 0 &&
      targets.every((target) => target.TargetHealth?.State === "healthy")
    );
  }

  private revision(revisionId: string): RevisionRuntime {
    const revision = this.config.revisions[revisionId];
    if (!revision) {
      throw new Error(`No AWS runtime mapping for revision ${revisionId}`);
    }
    return revision;
  }
}
