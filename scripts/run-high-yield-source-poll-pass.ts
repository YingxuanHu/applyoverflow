import "dotenv/config";

process.env.DATABASE_PROCESS_ROLE ??= "recovery_poll";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";
process.env.INGEST_GROWTH_MODE ??= "true";

import { prisma } from "@/lib/db";
import { enqueueUniqueSourceTask } from "@/lib/ingestion/task-queue";
import { runCompanySourcePollSlice } from "@/lib/ingestion/company-discovery";
import { acquireRuntimeLock } from "./_runtime-lock";

const VISIBLE_STATUSES = ["LIVE", "AGING"] as const;

type ParsedArgs = {
  limit: number;
  concurrency: number;
  minAgeMinutes: number;
  maxRuntimeMs: number;
  minLastCreated: number;
  minTotalCreated: number;
  dryRun: boolean;
};

function readIntArg(name: string, fallback: number) {
  const raw = process.argv
    .find((arg) => arg.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(): ParsedArgs {
  return {
    limit: readIntArg("--limit", 120),
    concurrency: Math.min(readIntArg("--concurrency", 8), 16),
    minAgeMinutes: readIntArg("--min-age-minutes", 90),
    maxRuntimeMs: readIntArg("--max-runtime-ms", 180_000),
    minLastCreated: readIntArg("--min-last-created", 2),
    minTotalCreated: readIntArg("--min-total-created", 20),
    dryRun: process.argv.includes("--dry-run"),
  };
}

async function countVisibleJobs() {
  return prisma.jobCanonical.count({
    where: { status: { in: [...VISIBLE_STATUSES] } },
  });
}

async function countFirstSeenSince(since: Date) {
  return prisma.jobCanonical.count({
    where: {
      firstSeenAt: { gte: since },
      status: { in: [...VISIBLE_STATUSES] },
    },
  });
}

function sourceAgeHours(lastSuccessfulPollAt: Date | null, now: Date) {
  if (!lastSuccessfulPollAt) return 72;
  return Math.max(0, (now.getTime() - lastSuccessfulPollAt.getTime()) / 3_600_000);
}

function connectorBonus(connectorName: string, sourceType: string | null) {
  if (connectorName === "official-company") return 600;
  if (sourceType === "COMPANY_JSON") return 420;
  if (sourceType === "COMPANY_HTML") return 260;
  if (connectorName === "oraclecloud") return 250;
  if (connectorName === "workday") return 240;
  if (connectorName === "greenhouse") return 80;
  if (connectorName === "icims") return 70;
  if (connectorName === "successfactors") return 70;
  if (connectorName === "lever" || connectorName === "ashby") return 35;
  return 0;
}

async function selectSources(args: ParsedArgs, now: Date) {
  const minAgeCutoff = new Date(now.getTime() - args.minAgeMinutes * 60_000);
  const candidates = await prisma.companySource.findMany({
    where: {
      connectorName: { notIn: ["smartrecruiters"] },
      status: { in: ["ACTIVE", "DEGRADED"] },
      validationState: "VALIDATED",
      pollState: "READY",
      sourceQualityScore: { gte: 0.5 },
      AND: [
        { OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }] },
        {
          OR: [
            { lastSuccessfulPollAt: null },
            { lastSuccessfulPollAt: { lte: minAgeCutoff } },
          ],
        },
        {
          OR: [
            { lastJobsCreatedCount: { gte: args.minLastCreated } },
            { jobsCreatedCount: { gte: args.minTotalCreated } },
            { connectorName: "official-company" },
          ],
        },
      ],
    },
    select: {
      id: true,
      companyId: true,
      sourceName: true,
      connectorName: true,
      sourceType: true,
      lastSuccessfulPollAt: true,
      lastJobsCreatedCount: true,
      jobsCreatedCount: true,
      retainedLiveJobCount: true,
      yieldScore: true,
      sourceQualityScore: true,
      priorityScore: true,
    },
    take: Math.max(args.limit * 6, args.limit),
    orderBy: [
      { lastJobsCreatedCount: "desc" },
      { jobsCreatedCount: "desc" },
      { yieldScore: "desc" },
    ],
  });

  return candidates
    .map((source) => {
      const ageHours = sourceAgeHours(source.lastSuccessfulPollAt, now);
      const score =
        connectorBonus(source.connectorName, source.sourceType) +
        source.lastJobsCreatedCount * 85 +
        Math.min(source.jobsCreatedCount, 800) * 0.9 +
        Math.min(source.retainedLiveJobCount, 800) * 0.15 +
        source.yieldScore * 260 +
        source.sourceQualityScore * 180 +
        source.priorityScore * 80 +
        Math.min(ageHours, 48) * 10;

      return { source, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, args.limit);
}

async function main() {
  const args = parseArgs();
  const lock = await acquireRuntimeLock("high-yield-source-poll-pass");
  if (!lock.acquired) {
    console.error(
      JSON.stringify({
        ok: false,
        reason: "runtime-lock-held",
        existingPid: lock.existingPid,
      })
    );
    return;
  }

  try {
    const startedAt = new Date();
    const visibleBefore = await countVisibleJobs();
    const selected = await selectSources(args, startedAt);

    if (!args.dryRun) {
      for (const { source, score } of selected) {
        await enqueueUniqueSourceTask({
          kind: "CONNECTOR_POLL",
          companyId: source.companyId,
          companySourceId: source.id,
          notBeforeAt: startedAt,
          priorityScore: Math.round(150_000 + score),
          payloadJson: {
            source: "high-yield-source-poll-pass",
            score: Math.round(score * 100) / 100,
          },
        });
      }
    }

    const poll = args.dryRun
      ? { processedCount: 0, successCount: 0, failedCount: 0 }
      : await runCompanySourcePollSlice({
          companySourceIds: selected.map(({ source }) => source.id),
          limit: args.limit,
          now: new Date(),
          maxRuntimeMs: args.maxRuntimeMs,
          concurrency: args.concurrency,
        });

    const visibleAfter = await countVisibleJobs();
    const firstSeen = await countFirstSeenSince(startedAt);

    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: args.dryRun,
          startedAt: startedAt.toISOString(),
          selectedCount: selected.length,
          processedCount: poll.processedCount,
          successCount: poll.successCount,
          failedCount: poll.failedCount,
          visibleBefore,
          visibleAfter,
          visibleDelta: visibleAfter - visibleBefore,
          currentlyVisibleFirstSeen: firstSeen,
          topSelected: selected.slice(0, 15).map(({ source, score }) => ({
            sourceName: source.sourceName,
            connectorName: source.connectorName,
            sourceType: source.sourceType,
            lastJobsCreatedCount: source.lastJobsCreatedCount,
            jobsCreatedCount: source.jobsCreatedCount,
            score: Math.round(score * 100) / 100,
          })),
        },
        null,
        2
      )
    );
  } finally {
    await lock.release();
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main().catch(async (error) => {
  console.error(
    "[run-high-yield-source-poll-pass] failed:",
    error instanceof Error ? (error.stack ?? error.message) : error
  );
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
