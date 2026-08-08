import type { Deployment, DeploymentDetail } from "./types";

const apiUrl = (
  import.meta.env.VITE_API_URL ?? "http://localhost:3005"
).replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }
  return body;
}

export async function listDeployments(): Promise<Deployment[]> {
  const body = await request<{ deployments: Deployment[] }>("/deployments");
  return body.deployments;
}

export async function getDeployment(id: string): Promise<DeploymentDetail> {
  return request<DeploymentDetail>(`/deployments/${id}`);
}

export async function createDeployment(): Promise<Deployment> {
  const body = await request<{ deployment: Deployment }>("/deployments", {
    method: "POST",
    body: JSON.stringify({
      serviceName: "demo-service",
      stableRevisionId: "v1",
      candidateRevisionId: "v2"
    })
  });
  return body.deployment;
}

export async function startDemoLoad(): Promise<void> {
  await request("/demo/load", {
    method: "POST",
    body: JSON.stringify({
      durationSeconds: 30,
      requestsPerSecond: 25
    })
  });
}

export async function requestRollback(id: string): Promise<void> {
  await request(`/deployments/${id}/rollback`, { method: "POST" });
}
