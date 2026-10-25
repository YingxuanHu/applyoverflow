import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { collectPublicFeedQuality, validateFeedQualityConfig } from "./lib/public-feed-quality";
import { readEvidenceConfig, redactedFailure } from "./lib/launch-evidence-safety";

async function main() {
  const config = await readEvidenceConfig(process.argv.slice(2));
  // Never load .env or the application's production-capable DB singleton.
  const connectionString = process.env.LAUNCH_EVIDENCE_DATABASE_URL ?? "";
  validateFeedQualityConfig(config, connectionString);
  const db = new PrismaClient({ adapter: new PrismaPg({
    connectionString, max: 1, connectionTimeoutMillis: 2000, idleTimeoutMillis: 1000,
    statement_timeout: config.statementTimeoutMs, lock_timeout: 500,
    options: "-c default_transaction_read_only=on -c max_parallel_workers_per_gather=0",
  }), log: [] });
  try {
    const report = await db.$transaction((transaction) => collectPublicFeedQuality(transaction, config), {
      isolationLevel: "RepeatableRead", maxWait: 2000, timeout: config.statementTimeoutMs + 3000,
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
  } finally { await db.$disconnect(); }
}

main().catch((error) => {
  console.log(JSON.stringify(redactedFailure(error)));
  process.exitCode = 2;
});
