import { readEvidenceConfig, redactedFailure } from "./lib/launch-evidence-safety";
import { runSyntheticFeedEvidence } from "./lib/synthetic-feed-evidence";

async function main() {
  const report = await runSyntheticFeedEvidence(await readEvidenceConfig(process.argv.slice(2)));
  console.log(JSON.stringify({ ...report, disposableClusterStoppedAndRemoved: true }, null, 2));
  process.exitCode = report.verificationPassed && report.componentThresholdsPassed ? 0 : 1;
}

main().catch((error) => {
  console.log(JSON.stringify(redactedFailure(error)));
  process.exitCode = 2;
});
