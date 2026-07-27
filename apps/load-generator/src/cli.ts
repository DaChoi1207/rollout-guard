import { parseLoadGeneratorArgs } from "./config.js";
import { formatLoadSummary, runLoadTest } from "./runner.js";

try {
  const config = parseLoadGeneratorArgs(process.argv.slice(2));
  const summary = await runLoadTest(config);
  console.log(formatLoadSummary(summary));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Load generator failed");
  process.exitCode = 1;
}

