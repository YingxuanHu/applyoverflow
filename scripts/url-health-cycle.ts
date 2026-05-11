import "dotenv/config";

import { setMaxListeners } from "node:events";
import { prisma } from "@/lib/db";
import {
  enqueuePriorityUrlHealthTasks,
  runUrlHealthTaskQueue,
} from "@/lib/ingestion/health-checker";

setMaxListeners(256);

function readLimitArg(name: string, fallback: number) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function main() {
  const now = new Date();
  const enqueueLimit = readLimitArg("enqueue-limit", 3_000);
  const runLimit = readLimitArg("run-limit", 3_000);

  const scheduled = await enqueuePriorityUrlHealthTasks({
    limit: enqueueLimit,
    now,
  });
  const executed = await runUrlHealthTaskQueue({
    limit: runLimit,
    now,
  });

  console.log(
    JSON.stringify(
      {
        now: now.toISOString(),
        scheduled: {
          enqueuedCount: scheduled.enqueuedCount,
        },
        executed,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("URL health cycle failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
