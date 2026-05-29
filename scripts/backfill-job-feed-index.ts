import { prisma } from "@/lib/db";
import {
  repairJobFeedIndexBatch,
  type JobFeedIndexRepairMode,
} from "@/lib/ingestion/search-index";
import { acquireRuntimeLock } from "./_runtime-lock";

let releaseRuntimeLock: (() => Promise<void>) | null = null;

function readIntArg(name: string, fallback: number) {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!exact) return fallback;
  const parsed = Number.parseInt(exact.slice(name.length + 1), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readModeArg(): JobFeedIndexRepairMode {
  const exact = process.argv.find((arg) => arg.startsWith("--mode="));
  const value = exact?.slice("--mode=".length) ?? "missing";
  if (value === "all" || value === "stale" || value === "missing") {
    return value;
  }
  return "missing";
}

async function main() {
  const batchSize = readIntArg("--batch-size", 500);
  const maxBatches = readIntArg("--max-batches", 100);
  const concurrency = readIntArg("--concurrency", 4);
  const sleepMs = readIntArg("--sleep-ms", 0);
  const idleSleepMs = readIntArg("--idle-sleep-ms", 10_000);
  const forever = process.argv.includes("--forever");
  const mode = readModeArg();
  const runtimeLock = await acquireRuntimeLock(`job-feed-index-backfill:${mode}`);

  if (!runtimeLock.acquired) {
    console.error(
      JSON.stringify(
        {
          refused: true,
          reason: "runtime-lock-held",
          existingPid: runtimeLock.existingPid,
          mode,
        },
        null,
        2
      )
    );
    await prisma.$disconnect();
    return;
  }

  let releaseRequested = false;
  const releaseLock = async () => {
    if (releaseRequested) return;
    releaseRequested = true;
    await runtimeLock.release();
  };
  releaseRuntimeLock = releaseLock;

  process.on("SIGINT", () => {
    void releaseLock().finally(() => process.exit(130));
  });
  process.on("SIGTERM", () => {
    void releaseLock().finally(() => process.exit(143));
  });

  const summary = {
    mode,
    batchSize,
    maxBatches,
    concurrency,
    forever,
    processed: 0,
    succeeded: 0,
    failed: 0,
    batches: 0,
    samples: [] as Array<Record<string, unknown>>,
  };

  do {
    let processedThisCycle = 0;

    for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
      const batch = await repairJobFeedIndexBatch({
        mode,
        limit: batchSize,
        concurrency,
      });

      if (batch.scanned === 0) {
        break;
      }

      summary.batches += 1;
      summary.processed += batch.processed;
      summary.succeeded += batch.succeeded;
      summary.failed += batch.failed;
      processedThisCycle += batch.processed;

      for (const sample of batch.samples) {
        if (summary.samples.length >= 20) {
          break;
        }
        summary.samples.push(sample);
      }

      console.log(
        JSON.stringify(
          {
            batch: summary.batches,
            mode,
            fetched: batch.scanned,
            processed: summary.processed,
            succeeded: summary.succeeded,
            failed: summary.failed,
          },
          null,
          2
        )
      );

      if (sleepMs > 0) {
        await sleep(sleepMs);
      }
    }

    if (!forever || processedThisCycle > 0) {
      if (!forever) break;
      continue;
    }

    console.log(
      JSON.stringify(
        {
          mode,
          idle: true,
          idleSleepMs,
          processed: summary.processed,
          succeeded: summary.succeeded,
          failed: summary.failed,
        },
        null,
        2
      )
    );
    await sleep(idleSleepMs);
  } while (forever);

  console.log(JSON.stringify(summary, null, 2));
  await releaseLock();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  prisma.$disconnect()
    .catch(() => {})
    .finally(async () => {
      if (releaseRuntimeLock) {
        await releaseRuntimeLock();
      }
    });
  process.exitCode = 1;
});
