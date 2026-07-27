export type LoadGeneratorConfig = {
  targetUrl: string;
  requestsPerSecond: number;
  durationSeconds: number;
  concurrency: number;
  requestTimeoutMs: number;
};

const defaults = {
  concurrency: 10,
  requestTimeoutMs: 2000
};

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function readPositiveInteger(
  args: string[],
  flag: string,
  options: { defaultValue?: number; required?: boolean }
): number {
  const raw = readFlagValue(args, flag);
  if (raw === undefined) {
    if (options.required) {
      throw new Error(`${flag} is required`);
    }
    return options.defaultValue ?? 0;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }

  return value;
}

function readTargetUrl(args: string[]): string {
  const raw = readFlagValue(args, "--target");
  if (!raw) {
    throw new Error("--target is required");
  }

  try {
    return new URL(raw).toString();
  } catch {
    throw new Error("--target must be a valid URL");
  }
}

export function parseLoadGeneratorArgs(args: string[]): LoadGeneratorConfig {
  return {
    targetUrl: readTargetUrl(args),
    requestsPerSecond: readPositiveInteger(args, "--requests-per-second", {
      required: true
    }),
    durationSeconds: readPositiveInteger(args, "--duration-seconds", {
      required: true
    }),
    concurrency: readPositiveInteger(args, "--concurrency", {
      defaultValue: defaults.concurrency
    }),
    requestTimeoutMs: readPositiveInteger(args, "--request-timeout-ms", {
      defaultValue: defaults.requestTimeoutMs
    })
  };
}

