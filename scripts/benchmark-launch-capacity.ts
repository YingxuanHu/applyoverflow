import { runCapacity } from "./lib/capacity-harness";
import { readEvidenceConfig, redactedFailure } from "./lib/launch-evidence-safety";

async function main() {
  const report = await runCapacity(await readEvidenceConfig(process.argv.slice(2)));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => {
  console.log(JSON.stringify(redactedFailure(error)));
  process.exitCode = 2;
});
