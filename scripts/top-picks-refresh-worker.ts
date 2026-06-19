import { prisma } from "@/lib/db";
import { runTopPicksRefreshQueue } from "@/lib/top-picks/refresh-worker";

function readArg(name: string) {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!exact) return null;
  return exact.slice(name.length + 1);
}

function readIntArg(name: string, fallback: number) {
  const raw = readArg(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce() {
  const limit = readIntArg("--limit", 5);
  const concurrency = readIntArg("--concurrency", 1);
  const result = await runTopPicksRefreshQueue({ limit, concurrency });
  console.log("[top-picks-refresh-worker]", {
    at: new Date().toISOString(),
    ...result,
    results: result.results.slice(0, 10),
  });
  return result;
}

async function main() {
  const forever = process.argv.includes("--forever");
  const idleSleepMs = readIntArg("--idle-sleep-ms", 30_000);
  const errorSleepMs = readIntArg("--error-sleep-ms", 60_000);

  if (!forever) {
    await runOnce();
    return;
  }

  let stopped = false;
  process.on("SIGINT", () => {
    stopped = true;
  });
  process.on("SIGTERM", () => {
    stopped = true;
  });

  while (!stopped) {
    try {
      const result = await runOnce();
      if (result.claimed === 0) {
        await sleep(idleSleepMs);
      }
    } catch (error) {
      console.error("[top-picks-refresh-worker] error", error);
      await sleep(errorSleepMs);
    }
  }
}

main()
  .catch((error) => {
    console.error("[top-picks-refresh-worker] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
