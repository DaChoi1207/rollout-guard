import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createDeployment,
  getDeployment,
  listDeployments,
  requestRollback,
  startDemoLoad
} from "./api";
import type {
  Deployment,
  DeploymentDetail,
  DeploymentState,
  Metrics
} from "./types";

const stateOrder: DeploymentState[] = [
  "QUEUED",
  "STARTING_CANDIDATE",
  "WAITING_FOR_HEALTH",
  "CANARY_10",
  "CANARY_50",
  "FULL_TRAFFIC",
  "OBSERVING",
  "SUCCEEDED"
];

const terminalStates: DeploymentState[] = [
  "SUCCEEDED",
  "ROLLED_BACK",
  "FAILED"
];

function stateLabel(state: DeploymentState): string {
  return state.replaceAll("_", " ");
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function MetricCard({
  label,
  revision,
  metrics,
  tone
}: {
  label: string;
  revision: string;
  metrics: Metrics;
  tone: "stable" | "candidate";
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-heading">
        <div>
          <span className="eyebrow">{label}</span>
          <h3>{revision}</h3>
        </div>
        <span className={`revision-dot ${tone}`} />
      </div>
      <div className="metric-grid">
        <div>
          <strong>{metrics.requestCount}</strong>
          <span>requests</span>
        </div>
        <div>
          <strong>{(metrics.errorRate * 100).toFixed(1)}%</strong>
          <span>error rate</span>
        </div>
        <div>
          <strong>{metrics.p95LatencyMs}ms</strong>
          <span>p95 latency</span>
        </div>
      </div>
    </article>
  );
}

export default function App() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeploymentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const nextDeployments = await listDeployments();
      setDeployments(nextDeployments);
      const nextId = selectedId ?? nextDeployments[0]?.id ?? null;
      if (nextId) {
        setSelectedId(nextId);
        setDetail(await getDeployment(nextId));
      }
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Dashboard refresh failed"
      );
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const active = detail?.deployment;
  const currentStep = active ? stateOrder.indexOf(active.state) : -1;
  const canRollback =
    active && !terminalStates.includes(active.state) && active.state !== "ROLLING_BACK";
  const outcomeTone = useMemo(() => {
    if (!active) return "neutral";
    if (active.state === "SUCCEEDED") return "success";
    if (active.state === "ROLLED_BACK" || active.state === "FAILED") return "danger";
    return "active";
  }, [active]);

  async function runBrokenRelease() {
    setBusy(true);
    try {
      await startDemoLoad();
      const deployment = await createDeployment();
      setSelectedId(deployment.id);
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Demo failed"
      );
    } finally {
      setBusy(false);
    }
  }

  async function rollback() {
    if (!active) return;
    setBusy(true);
    try {
      await requestRollback(active.id);
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Rollback request failed"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">RG</div>
          <div>
            <strong>RolloutGuard</strong>
            <span>Progressive delivery control plane</span>
          </div>
        </div>
        <div className="system-status">
          <span className="pulse" />
          LOCAL SYSTEM ONLINE
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">DEPLOYMENT CONTROL</span>
          <h1>Release with evidence.<br />Recover without panic.</h1>
          <p>
            Shift traffic gradually, compare candidate health against stable,
            and automatically restore the trusted revision when thresholds fail.
          </p>
        </div>
        <div className="hero-actions">
          <button
            className="primary-action"
            disabled={busy || deployments.some((item) => !terminalStates.includes(item.state))}
            onClick={() => void runBrokenRelease()}
          >
            <span>▶</span>
            {busy ? "STARTING…" : "RUN BROKEN RELEASE"}
          </button>
          <span>v1 → v2 · 15% injected errors · 30s load</span>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="control-grid">
        <aside className="deployment-list panel">
          <div className="panel-title">
            <span>DEPLOYMENTS</span>
            <b>{deployments.length}</b>
          </div>
          {deployments.length === 0 ? (
            <div className="empty-state">
              <span>◎</span>
              <p>No deployments yet.</p>
              <small>Run the broken release to see automatic rollback.</small>
            </div>
          ) : (
            deployments.map((deployment) => (
              <button
                className={`deployment-row ${
                  selectedId === deployment.id ? "selected" : ""
                }`}
                key={deployment.id}
                onClick={() => setSelectedId(deployment.id)}
              >
                <span className={`state-indicator ${deployment.state.toLowerCase()}`} />
                <span>
                  <strong>
                    {deployment.stableRevisionId} → {deployment.candidateRevisionId}
                  </strong>
                  <small>{formatTime(deployment.createdAt)}</small>
                </span>
                <em>{stateLabel(deployment.state)}</em>
              </button>
            ))
          )}
        </aside>

        <section className="deployment-focus">
          {!detail || !active ? (
            <div className="panel focus-empty">
              <span className="focus-glyph">↗</span>
              <h2>Ready for a controlled failure.</h2>
              <p>
                Start the demo to watch RolloutGuard expose v2 to 10% traffic,
                detect the regression, and restore v1.
              </p>
            </div>
          ) : (
            <>
              <div className="panel deployment-header">
                <div>
                  <span className="eyebrow">ACTIVE VIEW</span>
                  <h2>
                    {active.stableRevisionId}
                    <span>→</span>
                    {active.candidateRevisionId}
                  </h2>
                  <small>Deployment {active.id.slice(0, 8)}</small>
                </div>
                <div className={`state-chip ${outcomeTone}`}>
                  {stateLabel(active.state)}
                </div>
              </div>

              <div className="panel progression">
                <div className="panel-title">
                  <span>ROLLOUT PROGRESSION</span>
                  <b>STATE VERSION {active.stateVersion}</b>
                </div>
                <div className="state-track">
                  {stateOrder.map((state, index) => (
                    <div
                      className={`track-step ${
                        index <= currentStep ? "reached" : ""
                      } ${active.state === state ? "current" : ""}`}
                      key={state}
                    >
                      <i>{index + 1}</i>
                      <span>{stateLabel(state)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="traffic-and-action">
                <div className="panel traffic-panel">
                  <div className="panel-title">
                    <span>LIVE TRAFFIC</span>
                    <b>ROUTER :8080</b>
                  </div>
                  <div className="traffic-bar">
                    <div
                      className="stable-segment"
                      style={{ width: `${detail.traffic.stableWeight}%` }}
                    />
                    <div
                      className="candidate-segment"
                      style={{ width: `${detail.traffic.candidateWeight}%` }}
                    />
                  </div>
                  <div className="traffic-labels">
                    <span>
                      <i className="revision-dot stable" />
                      STABLE {detail.traffic.stableWeight}%
                    </span>
                    <span>
                      CANDIDATE {detail.traffic.candidateWeight}%
                      <i className="revision-dot candidate" />
                    </span>
                  </div>
                </div>
                <button
                  className="rollback-action"
                  disabled={!canRollback || busy}
                  onClick={() => void rollback()}
                >
                  ↶ REQUEST ROLLBACK
                </button>
              </div>

              {active.failureReason && (
                <div className="failure-callout">
                  <span>THRESHOLD VIOLATION</span>
                  <strong>{active.failureReason}</strong>
                </div>
              )}

              <div className="metrics-row">
                <MetricCard
                  label="TRUSTED BASELINE"
                  revision={active.stableRevisionId}
                  metrics={detail.metrics.stable}
                  tone="stable"
                />
                <MetricCard
                  label="RELEASE CANDIDATE"
                  revision={active.candidateRevisionId ?? "pending"}
                  metrics={detail.metrics.candidate}
                  tone="candidate"
                />
              </div>

              <div className="panel timeline">
                <div className="panel-title">
                  <span>DEPLOYMENT TIMELINE</span>
                  <b>{detail.events.length} EVENTS</b>
                </div>
                <div className="timeline-list">
                  {detail.events.map((event) => (
                    <div className="timeline-row" key={event.id}>
                      <time>{formatTime(event.createdAt)}</time>
                      <i />
                      <div>
                        <strong>{event.message}</strong>
                        <span>
                          {event.fromState
                            ? `${stateLabel(event.fromState)} → `
                            : ""}
                          {event.toState ? stateLabel(event.toState) : ""}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
