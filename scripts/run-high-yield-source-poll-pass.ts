import "dotenv/config";

process.env.DATABASE_PROCESS_ROLE ??= "recovery_poll";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";
process.env.INGEST_GROWTH_MODE ??= "true";

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { enqueueUniqueSourceTask } from "@/lib/ingestion/task-queue";
import { runCompanySourcePollSlice } from "@/lib/ingestion/company-discovery";
import { acquireRuntimeLock } from "./_runtime-lock";

const VISIBLE_STATUSES = ["LIVE", "AGING"] as const;
const RECENT_BLOCKED_WORKDAY_STATUSES = [401, 403, 429, 500, 502, 503, 504] as const;
const INCLUDE_WORKDAY_IN_HIGH_YIELD = process.env.HIGH_YIELD_INCLUDE_WORKDAY === "1";
const HIGH_YIELD_CHURN_HEAVY_RECENT_REMOVED_THRESHOLD = Math.max(
  10,
  Number.parseInt(
    process.env.HIGH_YIELD_CHURN_HEAVY_RECENT_REMOVED_THRESHOLD ?? "50",
    10
  ) || 50
);
const HIGH_YIELD_CHURN_HEAVY_RATIO_X100 = Math.max(
  100,
  Number.parseInt(process.env.HIGH_YIELD_CHURN_HEAVY_RATIO_X100 ?? "200", 10) ||
    200
);
const HIGH_YIELD_FAMILY_CHURN_HEAVY_RECENT_REMOVED_THRESHOLD = Math.max(
  HIGH_YIELD_CHURN_HEAVY_RECENT_REMOVED_THRESHOLD,
  Number.parseInt(
    process.env.HIGH_YIELD_FAMILY_CHURN_HEAVY_RECENT_REMOVED_THRESHOLD ?? "120",
    10
  ) || 120
);
const HIGH_YIELD_FAMILY_CHURN_HEAVY_RATIO_X100 = Math.max(
  HIGH_YIELD_CHURN_HEAVY_RATIO_X100,
  Number.parseInt(
    process.env.HIGH_YIELD_FAMILY_CHURN_HEAVY_RATIO_X100 ?? "160",
    10
  ) || 160
);
const HIGH_YIELD_FALLBACK_ENABLED = process.env.HIGH_YIELD_FALLBACK_ENABLED !== "0";
const HIGH_YIELD_FALLBACK_MIN_SOURCE_QUALITY = Math.max(
  0.5,
  Math.min(
    0.95,
    Number.parseFloat(process.env.HIGH_YIELD_FALLBACK_MIN_SOURCE_QUALITY ?? "0.65") ||
      0.65
  )
);
const HIGH_YIELD_FALLBACK_MIN_RETAINED_LIVE = Math.max(
  10,
  Number.parseInt(process.env.HIGH_YIELD_FALLBACK_MIN_RETAINED_LIVE ?? "25", 10) ||
    25
);

type ParsedArgs = {
  limit: number;
  concurrency: number;
  minAgeMinutes: number;
  maxRuntimeMs: number;
  minLastCreated: number;
  minTotalCreated: number;
  minRecentCreated: number;
  lookbackHours: number;
  growthOnly: boolean;
  // Retention mode: poll the OLDEST-polled healthy sources first (regardless of
  // growth signal) to keep their jobs inside the evidence window. The default
  // high-yield selection is discovery-optimized and structurally starves the
  // steady tail, so their still-live jobs age out and get removed.
  retention: boolean;
  dryRun: boolean;
};

type HighYieldSourceCandidate = {
  id: string;
  companyId: string;
  sourceName: string;
  connectorName: string;
  sourceType: string | null;
  lastSuccessfulPollAt: Date | null;
  lastJobsCreatedCount: number;
  jobsCreatedCount: number;
  retainedLiveJobCount: number;
  yieldScore: number;
  sourceQualityScore: number;
  priorityScore: number;
  recentRunCount: bigint | number;
  recentFetchedCount: bigint | number;
  recentAcceptedCount: bigint | number;
  recentCreatedCount: bigint | number;
  recentRemovedCount: bigint | number;
  recentRuntimeMs: bigint | number;
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
    minRecentCreated: readIntArg("--min-recent-created", 2),
    lookbackHours: readIntArg("--lookback-hours", 24),
    growthOnly: process.argv.includes("--growth-only"),
    retention: process.argv.includes("--retention"),
    dryRun: process.argv.includes("--dry-run"),
  };
}

function toInt(value: bigint | number | null | undefined) {
  if (typeof value === "bigint") return Number(value);
  return value ?? 0;
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

function scoreSourceCandidate(
  source: HighYieldSourceCandidate,
  args: Pick<ParsedArgs, "growthOnly">,
  now: Date
) {
  const ageHours = sourceAgeHours(source.lastSuccessfulPollAt, now);
  const recentCreated = toInt(source.recentCreatedCount);
  const recentRemoved = toInt(source.recentRemovedCount);
  const recentAccepted = toInt(source.recentAcceptedCount);
  const recentRuntimeMinutes = Math.max(toInt(source.recentRuntimeMs) / 60_000, 1);
  const recentCreatedPerMinute = recentCreated / recentRuntimeMinutes;
  const recentNoveltyRate =
    recentAccepted > 0 ? recentCreated / Math.max(recentAccepted, 1) : 0;
  const recentNetCreated = recentCreated - recentRemoved;
  const churnHeavy =
    recentRemoved >= HIGH_YIELD_CHURN_HEAVY_RECENT_REMOVED_THRESHOLD &&
    recentRemoved * 100 >
      Math.max(recentCreated, source.lastJobsCreatedCount, 1) *
        HIGH_YIELD_CHURN_HEAVY_RATIO_X100;
  const churnPenalty =
    recentRemoved > recentCreated
      ? Math.min(
          20_000,
          (recentRemoved - recentCreated) * (args.growthOnly ? 420 : 120) +
            recentRemoved * (args.growthOnly ? 45 : 15)
        )
      : Math.min(1_000, recentRemoved * 3);
  const staleRefreshPenalty =
    recentCreated === 0 && source.lastJobsCreatedCount === 0
      ? args.growthOnly
        ? 5_000
        : 700
      : 0;

  return (
    connectorBonus(source.connectorName, source.sourceType) +
    recentCreated * 125 +
    Math.max(recentNetCreated, 0) * 55 +
    recentCreatedPerMinute * 1_400 +
    recentNoveltyRate * 1_100 +
    source.lastJobsCreatedCount * 100 +
    Math.min(source.jobsCreatedCount, 800) * 0.35 +
    Math.min(source.retainedLiveJobCount, 800) * 0.15 +
    source.yieldScore * 260 +
    source.sourceQualityScore * 180 +
    source.priorityScore * 80 +
    Math.min(ageHours, 48) * 10 +
    Math.min(recentNetCreated, 0) * (args.growthOnly ? 420 : 120) -
    churnPenalty -
    (churnHeavy ? 6_000 : 0) -
    staleRefreshPenalty
  );
}

function rankCandidates(
  candidates: HighYieldSourceCandidate[],
  args: Pick<ParsedArgs, "growthOnly" | "limit">,
  now: Date
) {
  return candidates
    .map((source) => ({
      source,
      score: scoreSourceCandidate(source, args, now),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, args.limit);
}

// Retention selection: the healthy, validated sources that hold live jobs but
// are furthest past their last successful poll — oldest (and never-polled)
// first. No growth-signal or churn filter: the goal is to RE-CONFIRM existing
// jobs before they age past the evidence window, not to find new ones. Generic
// company-site sources are excluded to respect the standing skip policy.
async function selectRetentionSources(args: ParsedArgs, now: Date) {
  const minAgeCutoff = new Date(now.getTime() - args.minAgeMinutes * 60_000);
  const rows = await prisma.$queryRaw<HighYieldSourceCandidate[]>(Prisma.sql`
    SELECT
      cs."id", cs."companyId", cs."sourceName", cs."connectorName", cs."sourceType",
      cs."lastSuccessfulPollAt", cs."lastJobsCreatedCount", cs."jobsCreatedCount",
      cs."retainedLiveJobCount", cs."yieldScore", cs."sourceQualityScore", cs."priorityScore",
      0::bigint AS "recentRunCount", 0::bigint AS "recentFetchedCount",
      0::bigint AS "recentAcceptedCount", 0::bigint AS "recentCreatedCount",
      0::bigint AS "recentRemovedCount", 0::bigint AS "recentRuntimeMs"
    FROM "CompanySource" cs
    WHERE cs."status" IN ('ACTIVE', 'DEGRADED')
      AND cs."validationState" = 'VALIDATED'
      AND cs."pollState" = 'READY'
      AND cs."sourceQualityScore" >= 0.5
      AND cs."connectorName" <> 'company-site'
      AND (cs."cooldownUntil" IS NULL OR cs."cooldownUntil" <= ${now})
      AND cs."retainedLiveJobCount" > 0
      AND NOT (cs."connectorName" = 'workday' AND cs."consecutiveFailures" > 0)
      AND (
        cs."lastSuccessfulPollAt" IS NULL
        OR cs."lastSuccessfulPollAt" <= ${minAgeCutoff}
      )
    ORDER BY cs."lastSuccessfulPollAt" ASC NULLS FIRST
    LIMIT ${args.limit}
  `);
  return rows.map((source) => ({ source, score: 0 }));
}

async function selectSources(args: ParsedArgs, now: Date) {
  if (args.retention) {
    return selectRetentionSources(args, now);
  }
  const minAgeCutoff = new Date(now.getTime() - args.minAgeMinutes * 60_000);
  const recentWorkdayBlockCutoff = new Date(now.getTime() - 24 * 60 * 60_000);
  const connectorExclusions = INCLUDE_WORKDAY_IN_HIGH_YIELD
    ? ["smartrecruiters"]
    : ["smartrecruiters", "workday"];
  const recentCutoff = new Date(now.getTime() - args.lookbackHours * 60 * 60_000);
  const growthSignalFilter = args.growthOnly
    ? Prisma.sql`
      AND (
        COALESCE(rr."recentCreatedCount", 0) >= ${args.minRecentCreated}
        OR cs."lastJobsCreatedCount" >= ${args.minLastCreated}
      )
      AND (
        COALESCE(rr."recentRunCount", 0) = 0
        OR COALESCE(rr."recentCreatedCount", 0) > COALESCE(rr."recentRemovedCount", 0)
      )
    `
    : Prisma.sql`
      AND (
        cs."lastJobsCreatedCount" >= ${args.minLastCreated}
        OR cs."jobsCreatedCount" >= ${args.minTotalCreated}
        OR cs."connectorName" = 'official-company'
        OR COALESCE(rr."recentCreatedCount", 0) >= ${args.minRecentCreated}
      )
    `;
  const churnHeavyFilter = Prisma.sql`
    AND NOT (
      COALESCE(rr."recentRemovedCount", 0) >= ${HIGH_YIELD_CHURN_HEAVY_RECENT_REMOVED_THRESHOLD}
      AND COALESCE(rr."recentRemovedCount", 0) * 100 >
        GREATEST(COALESCE(rr."recentCreatedCount", 0), cs."lastJobsCreatedCount", 1) *
        ${HIGH_YIELD_CHURN_HEAVY_RATIO_X100}
    )
  `;
  const familyChurnHeavyFilter = Prisma.sql`
    AND NOT EXISTS (
      SELECT 1
      FROM recent_family_runs fr
      WHERE fr."sourceFamily" = regexp_replace(lower(cs."connectorName"), '[^a-z0-9]+', '', 'g')
        AND fr."recentRemovedCount" >= ${HIGH_YIELD_FAMILY_CHURN_HEAVY_RECENT_REMOVED_THRESHOLD}
        AND fr."recentRemovedCount" * 100 >
          GREATEST(fr."recentCreatedCount", 1) *
          ${HIGH_YIELD_FAMILY_CHURN_HEAVY_RATIO_X100}
    )
  `;

  const candidates = await prisma.$queryRaw<HighYieldSourceCandidate[]>(Prisma.sql`
    WITH recent_runs AS (
      SELECT
        "sourceName",
        COUNT(*)::bigint AS "recentRunCount",
        COALESCE(SUM("fetchedCount"), 0)::bigint AS "recentFetchedCount",
        COALESCE(SUM("acceptedCount"), 0)::bigint AS "recentAcceptedCount",
        COALESCE(SUM("canonicalCreatedCount"), 0)::bigint AS "recentCreatedCount",
        COALESCE(SUM("removedCount"), 0)::bigint AS "recentRemovedCount",
        COALESCE(SUM(
          CASE
            WHEN "endedAt" IS NULL THEN 0
            ELSE EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) * 1000
          END
        ), 0)::bigint AS "recentRuntimeMs"
      FROM "IngestionRun"
      WHERE "startedAt" >= ${recentCutoff}
      GROUP BY "sourceName"
    ),
    recent_family_runs AS (
      SELECT
        regexp_replace(lower(split_part("sourceName", ':', 1)), '[^a-z0-9]+', '', 'g') AS "sourceFamily",
        COALESCE(SUM("canonicalCreatedCount"), 0)::bigint AS "recentCreatedCount",
        COALESCE(SUM("removedCount"), 0)::bigint AS "recentRemovedCount"
      FROM "IngestionRun"
      WHERE "startedAt" >= ${recentCutoff}
      GROUP BY 1
    )
    SELECT
      cs."id",
      cs."companyId",
      cs."sourceName",
      cs."connectorName",
      cs."sourceType",
      cs."lastSuccessfulPollAt",
      cs."lastJobsCreatedCount",
      cs."jobsCreatedCount",
      cs."retainedLiveJobCount",
      cs."yieldScore",
      cs."sourceQualityScore",
      cs."priorityScore",
      COALESCE(rr."recentRunCount", 0)::bigint AS "recentRunCount",
      COALESCE(rr."recentFetchedCount", 0)::bigint AS "recentFetchedCount",
      COALESCE(rr."recentAcceptedCount", 0)::bigint AS "recentAcceptedCount",
      COALESCE(rr."recentCreatedCount", 0)::bigint AS "recentCreatedCount",
      COALESCE(rr."recentRemovedCount", 0)::bigint AS "recentRemovedCount",
      COALESCE(rr."recentRuntimeMs", 0)::bigint AS "recentRuntimeMs"
    FROM "CompanySource" cs
    LEFT JOIN recent_runs rr ON rr."sourceName" = cs."sourceName"
    WHERE
      cs."connectorName" NOT IN (${Prisma.join(connectorExclusions)})
      AND cs."status" IN ('ACTIVE', 'DEGRADED')
      AND cs."validationState" = 'VALIDATED'
      AND cs."pollState" = 'READY'
      AND cs."sourceQualityScore" >= 0.5
      AND (cs."cooldownUntil" IS NULL OR cs."cooldownUntil" <= ${now})
      AND (
        cs."lastSuccessfulPollAt" IS NULL
        OR cs."lastSuccessfulPollAt" <= ${minAgeCutoff}
      )
      AND NOT (
        cs."connectorName" = 'workday'
        AND (
          (
            cs."lastHttpStatus" IN (${Prisma.join([...RECENT_BLOCKED_WORKDAY_STATUSES])})
            AND cs."lastFailureAt" >= ${recentWorkdayBlockCutoff}
          )
          OR cs."consecutiveFailures" > 0
        )
      )
      ${growthSignalFilter}
      ${churnHeavyFilter}
      ${familyChurnHeavyFilter}
    ORDER BY
      COALESCE(rr."recentCreatedCount", 0) DESC,
      cs."lastJobsCreatedCount" DESC,
      cs."jobsCreatedCount" DESC,
      cs."yieldScore" DESC
    LIMIT ${Math.max(args.limit * 8, args.limit)}
  `);

  const selected = rankCandidates(candidates, args, now);
  if (
    !args.growthOnly ||
    !HIGH_YIELD_FALLBACK_ENABLED ||
    selected.length >= args.limit
  ) {
    return selected;
  }

  const selectedIds = selected.map(({ source }) => source.id);
  const selectedIdFilter =
    selectedIds.length > 0
      ? Prisma.sql`AND cs."id" NOT IN (${Prisma.join(selectedIds)})`
      : Prisma.empty;

  const fallbackCandidates = await prisma.$queryRaw<HighYieldSourceCandidate[]>(Prisma.sql`
    WITH recent_runs AS (
      SELECT
        "sourceName",
        COUNT(*)::bigint AS "recentRunCount",
        COALESCE(SUM("fetchedCount"), 0)::bigint AS "recentFetchedCount",
        COALESCE(SUM("acceptedCount"), 0)::bigint AS "recentAcceptedCount",
        COALESCE(SUM("canonicalCreatedCount"), 0)::bigint AS "recentCreatedCount",
        COALESCE(SUM("removedCount"), 0)::bigint AS "recentRemovedCount",
        COALESCE(SUM(
          CASE
            WHEN "endedAt" IS NULL THEN 0
            ELSE EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) * 1000
          END
        ), 0)::bigint AS "recentRuntimeMs"
      FROM "IngestionRun"
      WHERE "startedAt" >= ${recentCutoff}
      GROUP BY "sourceName"
    ),
    recent_family_runs AS (
      SELECT
        regexp_replace(lower(split_part("sourceName", ':', 1)), '[^a-z0-9]+', '', 'g') AS "sourceFamily",
        COALESCE(SUM("canonicalCreatedCount"), 0)::bigint AS "recentCreatedCount",
        COALESCE(SUM("removedCount"), 0)::bigint AS "recentRemovedCount"
      FROM "IngestionRun"
      WHERE "startedAt" >= ${recentCutoff}
      GROUP BY 1
    )
    SELECT
      cs."id",
      cs."companyId",
      cs."sourceName",
      cs."connectorName",
      cs."sourceType",
      cs."lastSuccessfulPollAt",
      cs."lastJobsCreatedCount",
      cs."jobsCreatedCount",
      cs."retainedLiveJobCount",
      cs."yieldScore",
      cs."sourceQualityScore",
      cs."priorityScore",
      COALESCE(rr."recentRunCount", 0)::bigint AS "recentRunCount",
      COALESCE(rr."recentFetchedCount", 0)::bigint AS "recentFetchedCount",
      COALESCE(rr."recentAcceptedCount", 0)::bigint AS "recentAcceptedCount",
      COALESCE(rr."recentCreatedCount", 0)::bigint AS "recentCreatedCount",
      COALESCE(rr."recentRemovedCount", 0)::bigint AS "recentRemovedCount",
      COALESCE(rr."recentRuntimeMs", 0)::bigint AS "recentRuntimeMs"
    FROM "CompanySource" cs
    LEFT JOIN recent_runs rr ON rr."sourceName" = cs."sourceName"
    WHERE
      cs."connectorName" NOT IN (${Prisma.join(connectorExclusions)})
      AND cs."status" IN ('ACTIVE', 'DEGRADED')
      AND cs."validationState" = 'VALIDATED'
      AND cs."pollState" = 'READY'
      AND cs."sourceQualityScore" >= ${HIGH_YIELD_FALLBACK_MIN_SOURCE_QUALITY}
      AND (cs."cooldownUntil" IS NULL OR cs."cooldownUntil" <= ${now})
      AND (
        cs."lastSuccessfulPollAt" IS NULL
        OR cs."lastSuccessfulPollAt" <= ${minAgeCutoff}
      )
      AND (
        cs."lastJobsCreatedCount" >= ${args.minLastCreated}
        OR cs."jobsCreatedCount" >= ${args.minTotalCreated}
        OR cs."retainedLiveJobCount" >= ${HIGH_YIELD_FALLBACK_MIN_RETAINED_LIVE}
      )
      AND (
        COALESCE(rr."recentRunCount", 0) = 0
        OR COALESCE(rr."recentCreatedCount", 0) >= COALESCE(rr."recentRemovedCount", 0)
      )
      AND NOT (
        cs."connectorName" = 'workday'
        AND (
          (
            cs."lastHttpStatus" IN (${Prisma.join([...RECENT_BLOCKED_WORKDAY_STATUSES])})
            AND cs."lastFailureAt" >= ${recentWorkdayBlockCutoff}
          )
          OR cs."consecutiveFailures" > 0
        )
      )
      ${selectedIdFilter}
      ${churnHeavyFilter}
      ${familyChurnHeavyFilter}
    ORDER BY
      cs."lastJobsCreatedCount" DESC,
      cs."retainedLiveJobCount" DESC,
      cs."jobsCreatedCount" DESC,
      cs."yieldScore" DESC
    LIMIT ${Math.max((args.limit - selected.length) * 8, args.limit - selected.length)}
  `);

  const fallback = rankCandidates(
    fallbackCandidates,
    { ...args, limit: args.limit - selected.length, growthOnly: false },
    now
  );

  if (fallback.length > 0) {
    console.log(
      `[high-yield-source-poll] Growth selector returned ${selected.length}/${args.limit}; added ${fallback.length} validated fallback source(s).`
    );
  }

  return [...selected, ...fallback].slice(0, args.limit);
}

async function main() {
  const args = parseArgs();
  // Retention and high-yield passes run the same script concurrently, so they
  // must hold DISTINCT runtime locks or they would starve each other.
  const lock = await acquireRuntimeLock(
    args.retention ? "retention-source-poll-pass" : "high-yield-source-poll-pass"
  );
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
            recentRunCount: toInt(source.recentRunCount),
            recentAcceptedCount: toInt(source.recentAcceptedCount),
            recentCreatedCount: toInt(source.recentCreatedCount),
            recentRemovedCount: toInt(source.recentRemovedCount),
            recentNetCreatedCount:
              toInt(source.recentCreatedCount) - toInt(source.recentRemovedCount),
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
