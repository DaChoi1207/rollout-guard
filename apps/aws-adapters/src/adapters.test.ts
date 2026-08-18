import { describe, expect, it, vi } from "vitest";
import {
  DescribeServicesCommand,
  UpdateServiceCommand
} from "@aws-sdk/client-ecs";
import {
  DescribeTargetHealthCommand,
  ModifyListenerCommand
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { EcsRuntimeProvider } from "./runtime.js";
import { AlbTrafficRouter } from "./traffic.js";
import { CloudWatchMetricsProvider } from "./metrics.js";

describe("EcsRuntimeProvider", () => {
  it("scales a stopped candidate service to one task", async () => {
    const ecs = {
      send: vi
        .fn()
        .mockResolvedValueOnce({
          services: [{ status: "ACTIVE", desiredCount: 0 }]
        })
        .mockResolvedValueOnce({})
    };
    const elb = { send: vi.fn() };
    const runtime = new EcsRuntimeProvider(ecs as never, elb as never, {
      cluster: "demo",
      revisions: {
        v2: { serviceName: "candidate", targetGroupArn: "candidate-tg" }
      }
    });

    await runtime.ensureCandidate("v2");

    expect(ecs.send.mock.calls[0]?.[0]).toBeInstanceOf(
      DescribeServicesCommand
    );
    expect(ecs.send.mock.calls[1]?.[0]).toBeInstanceOf(UpdateServiceCommand);
    expect(ecs.send.mock.calls[1]?.[0].input).toMatchObject({
      cluster: "demo",
      service: "candidate",
      desiredCount: 1
    });
  });

  it("scales a running candidate service to zero during rollback", async () => {
    const ecs = {
      send: vi
        .fn()
        .mockResolvedValueOnce({
          services: [{ status: "ACTIVE", desiredCount: 1 }]
        })
        .mockResolvedValueOnce({})
    };
    const runtime = new EcsRuntimeProvider(
      ecs as never,
      { send: vi.fn() } as never,
      {
        cluster: "demo",
        revisions: {
          v2: { serviceName: "candidate", targetGroupArn: "candidate-tg" }
        }
      }
    );

    await runtime.stopCandidate("v2");

    expect(ecs.send.mock.calls[1]?.[0]).toBeInstanceOf(UpdateServiceCommand);
    expect(ecs.send.mock.calls[1]?.[0].input).toMatchObject({
      cluster: "demo",
      service: "candidate",
      desiredCount: 0
    });
  });

  it("uses target health for readiness", async () => {
    const elb = {
      send: vi.fn().mockResolvedValue({
        TargetHealthDescriptions: [
          { TargetHealth: { State: "healthy" } },
          { TargetHealth: { State: "healthy" } }
        ]
      })
    };
    const runtime = new EcsRuntimeProvider(
      { send: vi.fn() } as never,
      elb as never,
      {
        cluster: "demo",
        revisions: {
          v2: { serviceName: "candidate", targetGroupArn: "candidate-tg" }
        }
      }
    );

    await expect(runtime.isRevisionHealthy("v2")).resolves.toBe(true);
    expect(elb.send.mock.calls[0]?.[0]).toBeInstanceOf(
      DescribeTargetHealthCommand
    );
  });
});

describe("AlbTrafficRouter", () => {
  it("writes absolute weighted forwarding configuration", async () => {
    const elb = { send: vi.fn().mockResolvedValue({}) };
    const router = new AlbTrafficRouter(elb as never, {
      listenerArn: "listener",
      stableTargetGroupArn: "stable",
      candidateTargetGroupArn: "candidate"
    });

    await router.setWeights({ stableWeight: 90, candidateWeight: 10 });

    const command = elb.send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(ModifyListenerCommand);
    expect(command.input.DefaultActions[0].ForwardConfig.TargetGroups).toEqual([
      { TargetGroupArn: "stable", Weight: 90 },
      { TargetGroupArn: "candidate", Weight: 10 }
    ]);
  });

  it("rejects invalid totals before calling AWS", async () => {
    const elb = { send: vi.fn() };
    const router = new AlbTrafficRouter(elb as never, {
      listenerArn: "listener",
      stableTargetGroupArn: "stable",
      candidateTargetGroupArn: "candidate"
    });

    await expect(
      router.setWeights({ stableWeight: 80, candidateWeight: 10 })
    ).rejects.toThrow("add up to 100");
    expect(elb.send).not.toHaveBeenCalled();
  });
});

describe("CloudWatchMetricsProvider", () => {
  it("combines ALB counters and latency percentiles", async () => {
    const cloudWatch = {
      send: vi.fn().mockResolvedValue({
        MetricDataResults: [
          { Id: "requests", Values: [40, 60] },
          { Id: "errors", Values: [1, 2] },
          { Id: "average", Values: [0.12] },
          { Id: "p50", Values: [0.1] },
          { Id: "p95", Values: [0.4] },
          { Id: "p99", Values: [0.8] }
        ]
      })
    };
    const metrics = new CloudWatchMetricsProvider(
      cloudWatch as never,
      {
        revisions: {
          v2: {
            loadBalancer: "app/demo/123",
            targetGroup: "targetgroup/candidate/456"
          }
        }
      },
      () => new Date("2026-01-01T00:05:00Z")
    );

    await expect(
      metrics.getRevisionMetrics({
        revisionId: "v2",
        since: new Date("2026-01-01T00:00:00Z")
      })
    ).resolves.toEqual({
      requestCount: 100,
      errorCount: 3,
      errorRate: 0.03,
      averageLatencyMs: 120,
      p50LatencyMs: 100,
      p95LatencyMs: 400,
      p99LatencyMs: 800
    });
    const command = cloudWatch.send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(GetMetricDataCommand);
    expect(command.input.MetricDataQueries).toHaveLength(6);
    expect(
      command.input.MetricDataQueries[0]?.MetricStat?.Metric?.MetricName
    ).toBe("RequestCountPerTarget");
  });
});
