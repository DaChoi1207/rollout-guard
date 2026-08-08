import {
  GetMetricDataCommand,
  type CloudWatchClient,
  type MetricDataResult
} from "@aws-sdk/client-cloudwatch";
import type {
  MetricsProvider,
  RevisionMetrics
} from "@rollout-guard/rollout-worker";

export type RevisionMetricDimensions = {
  loadBalancer: string;
  targetGroup: string;
};

export type CloudWatchMetricsConfig = {
  revisions: Readonly<Record<string, RevisionMetricDimensions>>;
  periodSeconds?: number;
};

type CloudWatchSender = Pick<CloudWatchClient, "send">;

export class CloudWatchMetricsProvider implements MetricsProvider {
  public constructor(
    private readonly cloudWatch: CloudWatchSender,
    private readonly config: CloudWatchMetricsConfig,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async getRevisionMetrics(input: {
    revisionId: string;
    since: Date;
  }): Promise<RevisionMetrics> {
    const dimensions = this.config.revisions[input.revisionId];
    if (!dimensions) {
      throw new Error(`No CloudWatch mapping for revision ${input.revisionId}`);
    }
    const period = this.config.periodSeconds ?? 60;
    const common = {
      Namespace: "AWS/ApplicationELB",
      Dimensions: [
        { Name: "LoadBalancer", Value: dimensions.loadBalancer },
        { Name: "TargetGroup", Value: dimensions.targetGroup }
      ],
      Period: period
    };
    const response = await this.cloudWatch.send(
      new GetMetricDataCommand({
        StartTime: input.since,
        EndTime: this.clock(),
        ScanBy: "TimestampAscending",
        MetricDataQueries: [
          this.query("requests", "RequestCount", "Sum", common),
          this.query("errors", "HTTPCode_Target_5XX_Count", "Sum", common),
          this.query("average", "TargetResponseTime", "Average", common),
          this.query("p50", "TargetResponseTime", "p50", common),
          this.query("p95", "TargetResponseTime", "p95", common),
          this.query("p99", "TargetResponseTime", "p99", common)
        ]
      })
    );

    const byId = new Map(
      (response.MetricDataResults ?? []).map((result) => [result.Id, result])
    );
    const requestCount = this.sum(byId.get("requests"));
    const errorCount = this.sum(byId.get("errors"));
    return {
      requestCount,
      errorCount,
      errorRate: requestCount === 0 ? 0 : errorCount / requestCount,
      averageLatencyMs: this.latest(byId.get("average")) * 1_000,
      p50LatencyMs: this.latest(byId.get("p50")) * 1_000,
      p95LatencyMs: this.latest(byId.get("p95")) * 1_000,
      p99LatencyMs: this.latest(byId.get("p99")) * 1_000
    };
  }

  private query(
    id: string,
    metricName: string,
    stat: string,
    common: {
      Namespace: string;
      Dimensions: { Name: string; Value: string }[];
      Period: number;
    }
  ) {
    return {
      Id: id,
      ReturnData: true,
      MetricStat: {
        Metric: {
          Namespace: common.Namespace,
          MetricName: metricName,
          Dimensions: common.Dimensions
        },
        Period: common.Period,
        Stat: stat
      }
    };
  }

  private sum(result: MetricDataResult | undefined): number {
    return (result?.Values ?? []).reduce((total, value) => total + value, 0);
  }

  private latest(result: MetricDataResult | undefined): number {
    return result?.Values?.at(-1) ?? 0;
  }
}
