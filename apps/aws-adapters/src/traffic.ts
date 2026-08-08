import {
  ModifyListenerCommand,
  type ElasticLoadBalancingV2Client
} from "@aws-sdk/client-elastic-load-balancing-v2";
import type { TrafficRouter } from "@rollout-guard/rollout-worker";

export type AlbTrafficRouterConfig = {
  listenerArn: string;
  stableTargetGroupArn: string;
  candidateTargetGroupArn: string;
};

type ElbSender = Pick<ElasticLoadBalancingV2Client, "send">;

export class AlbTrafficRouter implements TrafficRouter {
  public constructor(
    private readonly elb: ElbSender,
    private readonly config: AlbTrafficRouterConfig
  ) {}

  public async setWeights(input: {
    stableWeight: number;
    candidateWeight: number;
  }): Promise<void> {
    this.assertWeight(input.stableWeight, "stableWeight");
    this.assertWeight(input.candidateWeight, "candidateWeight");
    if (input.stableWeight + input.candidateWeight !== 100) {
      throw new Error("ALB target group weights must add up to 100");
    }

    await this.elb.send(
      new ModifyListenerCommand({
        ListenerArn: this.config.listenerArn,
        DefaultActions: [
          {
            Type: "forward",
            ForwardConfig: {
              TargetGroups: [
                {
                  TargetGroupArn: this.config.stableTargetGroupArn,
                  Weight: input.stableWeight
                },
                {
                  TargetGroupArn: this.config.candidateTargetGroupArn,
                  Weight: input.candidateWeight
                }
              ]
            }
          }
        ]
      })
    );
  }

  private assertWeight(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new Error(`${name} must be an integer between 0 and 100`);
    }
  }
}
