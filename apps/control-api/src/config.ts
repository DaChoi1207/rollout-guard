export type ControlApiConfig = {
  databaseUrl: string;
  routerUrl: string;
  port: number;
  host: string;
  dashboardOrigin: string;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number
): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function validUrl(value: string, name: string): string {
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

export function loadControlApiConfig(
  env: NodeJS.ProcessEnv = process.env
): ControlApiConfig {
  return {
    databaseUrl: required(env, "DATABASE_URL"),
    routerUrl: validUrl(required(env, "ROUTER_URL"), "ROUTER_URL"),
    port: positiveInteger(env, "PORT", 3005),
    host: env.HOST ?? "0.0.0.0",
    dashboardOrigin: validUrl(
      env.DASHBOARD_ORIGIN ?? "http://localhost:3000",
      "DASHBOARD_ORIGIN"
    )
  };
}
