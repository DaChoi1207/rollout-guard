export type DemoServiceConfig = {
  appVersion: string;
  errorRate: number;
  responseDelayMs: number;
  port: number;
  host: string;
};

function readRequiredString(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  options: { defaultValue?: number; min: number; max?: number }
): number {
  const raw = env[name] ?? String(options.defaultValue ?? "");
  if (raw.length === 0) {
    throw new Error(`${name} is required`);
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < options.min) {
    throw new Error(`${name} must be a number >= ${options.min}`);
  }

  if (options.max !== undefined && value > options.max) {
    throw new Error(`${name} must be <= ${options.max}`);
  }

  return value;
}

export function loadDemoServiceConfig(
  env: NodeJS.ProcessEnv = process.env
): DemoServiceConfig {
  return {
    appVersion: readRequiredString(env, "APP_VERSION"),
    errorRate: readNumber(env, "ERROR_RATE", { defaultValue: 0, min: 0, max: 1 }),
    responseDelayMs: readNumber(env, "RESPONSE_DELAY_MS", {
      defaultValue: 0,
      min: 0
    }),
    port: readNumber(env, "PORT", { defaultValue: 3000, min: 1, max: 65535 }),
    host: env.HOST ?? "0.0.0.0"
  };
}

