import { prisma, withPrismaConnectionRetry } from "@/lib/db";
import { getScheduledConnectorSnapshot } from "@/lib/ingestion/registry";
import { startOfUtcDay } from "@/lib/time-zone";
import type {
  IngestionOverview,
  IngestionRunListItem,
  IngestionSourceCoverage,
} from "@/lib/ingestion/types";

const RECENT_RUN_LIMIT = 20;
const VISIBLE_JOB_STATUSES = ["LIVE", "AGING"] as const;
const ACTIVE_COMPANY_SOURCE_POLL_STATES = ["READY", "ACTIVE", "BACKOFF"] as const;
// 5-minute TTL — the underlying counts (LIVE jobs, active sources) shift slowly
// (workers + lifecycle sweep run on a 30-min cadence). A short TTL was causing
// every tab switch to re-run the 3 queries against the shared DB pool.
const INGESTION_STATUS_TTL_MS = 300_000;
const INGESTION_HEARTBEAT_TTL_MS = 30_000;
const INGESTION_OBSERVABILITY_TTL_MS = 5 * 60_000;
const INGESTION_OBSERVABILITY_LOOKBACK_DAYS = 7;
const INGESTION_FRESHNESS_WINDOW_DAYS = 3;
const scheduledConnectorNames = new Set(
  getScheduledConnectorSnapshot().map((source) => source.sourceName)
);
let ingestionStatusCache: { expiresAt: number; value: IngestionStatus } | null = null;
let ingestionHeartbeatCache: { expiresAt: number; value: IngestionHeartbeat } | null = null;
let ingestionObservabilityCache:
  | { expiresAt: number; value: IngestionObservabilityOverview }
  | null = null;

export type IngestionStatus = {
  /** ISO timestamp of the most recent successful ingestion run, or null if none. */
  lastUpdatedAt: string | null;
  /** Total visible active canonical jobs in the pool (LIVE + AGING, unfiltered). */
  liveJobCount: number;
  /** Number of distinct ATS platforms (e.g. Greenhouse, Lever, SmartRecruiters) that have run successfully. */
  activeSourceCount: number;
};

export type IngestionHeartbeat = Pick<IngestionStatus, "lastUpdatedAt">;

export type IngestionSourceYieldFreshnessRow = {
  sourceName: string;
  isScheduled: boolean;
  scheduleCadenceMinutes: number | null;
  runs7d: number;
  successfulRuns7d: number;
  failedRuns7d: number;
  fetched7d: number;
  accepted7d: number;
  rejected7d: number;
  created7d: number;
  updated7d: number;
  deduped7d: number;
  removedMappings7d: number;
  currentLiveCount: number;
  currentAgingCount: number;
  currentStaleCount: number;
  currentExpiredCount: number;
  activeMappingCount: number;
  removedMappingCount: number;
  seenInFreshWindowCount: number;
  confirmedAliveInFreshWindowCount: number;
  heldByConfirmationCount: number;
  atRiskVisibleCount: number;
  lastRunStartedAt: string | null;
  lastSuccessfulRunAt: string | null;
  lastSourceSeenAt: string | null;
  lastConfirmedAliveAt: string | null;
};

export type IngestionLifecycleSnapshotRow = {
  date: string;
  snapshotCapturedAt: string | null;
  liveCount: number | null;
  staleCount: number | null;
  expiredCount: number | null;
  removedCount: number | null;
  hasSnapshot: boolean;
};

export type IngestionLifecycleTransitionRow = {
  date: string;
  createdCount: number;
  staleEnteredCount: number;
  expiredEnteredCount: number;
  removedEnteredCount: number;
  aliveConfirmedCount: number;
};

export type IngestionLifecycleEvidence = {
  liveCount: number;
  agingCount: number;
  staleCount: number;
  expiredCount: number;
  removedCount: number;
  sourceBackedVisibleCount: number;
  heldByConfirmationCount: number;
  atRiskVisibleCount: number;
  verificationBacklogCount: number;
  visibleDeadSignalCount: number;
  staleRecentlyConfirmedCount: number;
  expiredWithDeadSignalCount: number;
  recentlySeenVisibleCount: number;
  recentlyConfirmedVisibleCount: number;
};

export type IngestionObservabilityOverview = {
  generatedAt: string;
  lookbackDays: number;
  freshnessWindowDays: number;
  sourceYield7d: IngestionSourceYieldFreshnessRow[];
  lifecycleSnapshots7d: IngestionLifecycleSnapshotRow[];
  lifecycleTransitions7d: IngestionLifecycleTransitionRow[];
  lifecycleEvidence: IngestionLifecycleEvidence;
  notes: string[];
};

type SourceFreshnessSqlRow = {
  sourceName: string;
  activeMappingCount: number | bigint;
  removedMappingCount: number | bigint;
  currentLiveCount: number | bigint;
  currentAgingCount: number | bigint;
  currentStaleCount: number | bigint;
  currentExpiredCount: number | bigint;
  seenInFreshWindowCount: number | bigint;
  confirmedAliveInFreshWindowCount: number | bigint;
  heldByConfirmationCount: number | bigint;
  atRiskVisibleCount: number | bigint;
  lastSourceSeenAt: Date | string | null;
  lastConfirmedAliveAt: Date | string | null;
};

type LifecycleEvidenceSqlRow = {
  liveCount: number | bigint;
  agingCount: number | bigint;
  staleCount: number | bigint;
  expiredCount: number | bigint;
  removedCount: number | bigint;
  sourceBackedVisibleCount: number | bigint;
  heldByConfirmationCount: number | bigint;
  atRiskVisibleCount: number | bigint;
  verificationBacklogCount: number | bigint;
  visibleDeadSignalCount: number | bigint;
  staleRecentlyConfirmedCount: number | bigint;
  expiredWithDeadSignalCount: number | bigint;
  recentlySeenVisibleCount: number | bigint;
  recentlyConfirmedVisibleCount: number | bigint;
};

type LifecycleTransitionSqlRow = {
  date: Date | string;
  createdCount: number | bigint;
  staleEnteredCount: number | bigint;
  expiredEnteredCount: number | bigint;
  removedEnteredCount: number | bigint;
  aliveConfirmedCount: number | bigint;
};

/**
 * Lightweight status query for the user-facing feed.
 * Runs 3 small queries in parallel — does NOT call getIngestionOverview.
 */
export async function getIngestionStatus(): Promise<IngestionStatus> {
  const now = Date.now();
  if (ingestionStatusCache && ingestionStatusCache.expiresAt > now) {
    return ingestionStatusCache.value;
  }

  try {
    const [lastSuccessRun, summaryCache, activeManagedSourceCount] =
      await withPrismaConnectionRetry(() =>
        Promise.all([
          prisma.ingestionRun.findFirst({
            where: { status: "SUCCESS" },
            orderBy: { startedAt: "desc" },
            select: { endedAt: true, startedAt: true },
          }),
          prisma.jobFeedSummaryCache.findUnique({
            where: { id: "singleton" },
            select: { liveJobCount: true },
          }),
          prisma.companySource.count({
            where: {
              sourceName: { notIn: [...scheduledConnectorNames] },
              validationState: "VALIDATED",
              pollState: { in: [...ACTIVE_COMPANY_SOURCE_POLL_STATES] },
            },
          }),
        ])
      );

    const activeSourceNames = new Set(scheduledConnectorNames);

    const value = {
      lastUpdatedAt: lastSuccessRun
        ? (lastSuccessRun.endedAt ?? lastSuccessRun.startedAt).toISOString()
        : null,
      liveJobCount: summaryCache?.liveJobCount ?? 0,
      activeSourceCount: activeSourceNames.size + activeManagedSourceCount,
    } satisfies IngestionStatus;

    ingestionStatusCache = {
      expiresAt: now + INGESTION_STATUS_TTL_MS,
      value,
    };

    return value;
  } catch (error) {
    console.error("getIngestionStatus fallback:", error);
    if (ingestionStatusCache) {
      return ingestionStatusCache.value;
    }

    return {
      lastUpdatedAt: null,
      liveJobCount: 0,
      activeSourceCount: scheduledConnectorNames.size,
    };
  }
}

export async function getIngestionHeartbeat(): Promise<IngestionHeartbeat> {
  const now = Date.now();
  if (ingestionHeartbeatCache && ingestionHeartbeatCache.expiresAt > now) {
    return ingestionHeartbeatCache.value;
  }

  try {
    const lastSuccessRun = await withPrismaConnectionRetry(() =>
      prisma.ingestionRun.findFirst({
        where: { status: "SUCCESS" },
        orderBy: { startedAt: "desc" },
        select: { endedAt: true, startedAt: true },
      })
    );

    const value = {
      lastUpdatedAt: lastSuccessRun
        ? (lastSuccessRun.endedAt ?? lastSuccessRun.startedAt).toISOString()
        : null,
    };

    ingestionHeartbeatCache = { expiresAt: now + INGESTION_HEARTBEAT_TTL_MS, value };
    return value;
  } catch (error) {
    console.error("getIngestionHeartbeat fallback:", error);
    if (ingestionHeartbeatCache) {
      return ingestionHeartbeatCache.value;
    }

    return {
      lastUpdatedAt: null,
    };
  }
}

export async function getIngestionObservabilityOverview(): Promise<IngestionObservabilityOverview> {
  const nowMs = Date.now();
  if (ingestionObservabilityCache && ingestionObservabilityCache.expiresAt > nowMs) {
    return ingestionObservabilityCache.value;
  }

  const now = new Date(nowMs);
  const todayUtc = startOfUtcDay(now);
  const lookbackStart = addUtcDays(
    todayUtc,
    -(INGESTION_OBSERVABILITY_LOOKBACK_DAYS - 1)
  );
  const lookbackEndExclusive = addUtcDays(todayUtc, 1);
  const freshnessCutoff = new Date(
    now.getTime() - INGESTION_FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  try {
    const [runs7d, sourceFreshnessRows, lifecycleTransitions, lifecycleEvidence] =
      await withPrismaConnectionRetry(() =>
        Promise.all([
          prisma.ingestionRun.findMany({
            where: { startedAt: { gte: lookbackStart } },
            orderBy: { startedAt: "desc" },
            select: {
              sourceName: true,
              status: true,
              startedAt: true,
              fetchedCount: true,
              acceptedCount: true,
              rejectedCount: true,
              canonicalCreatedCount: true,
              canonicalUpdatedCount: true,
              dedupedCount: true,
              sourceMappingsRemovedCount: true,
              liveCount: true,
              staleCount: true,
              expiredCount: true,
              removedCount: true,
            },
          }),
          prisma.$queryRaw<SourceFreshnessSqlRow[]>`
            SELECT
              m."sourceName" AS "sourceName",
              COUNT(*) FILTER (WHERE m."removedAt" IS NULL)::int AS "activeMappingCount",
              COUNT(*) FILTER (WHERE m."removedAt" IS NOT NULL)::int AS "removedMappingCount",
              COUNT(DISTINCT m."canonicalJobId") FILTER (
                WHERE m."removedAt" IS NULL AND c."status" = 'LIVE'
              )::int AS "currentLiveCount",
              COUNT(DISTINCT m."canonicalJobId") FILTER (
                WHERE m."removedAt" IS NULL AND c."status" = 'AGING'
              )::int AS "currentAgingCount",
              COUNT(DISTINCT m."canonicalJobId") FILTER (
                WHERE m."removedAt" IS NULL AND c."status" = 'STALE'
              )::int AS "currentStaleCount",
              COUNT(DISTINCT m."canonicalJobId") FILTER (
                WHERE m."removedAt" IS NULL AND c."status" = 'EXPIRED'
              )::int AS "currentExpiredCount",
              COUNT(DISTINCT m."canonicalJobId") FILTER (
                WHERE
                  m."removedAt" IS NULL
                  AND c."status" IN ('LIVE', 'AGING')
                  AND m."lastSeenAt" >= ${freshnessCutoff}
              )::int AS "seenInFreshWindowCount",
              COUNT(DISTINCT m."canonicalJobId") FILTER (
                WHERE
                  m."removedAt" IS NULL
                  AND c."status" IN ('LIVE', 'AGING')
                  AND c."lastConfirmedAliveAt" >= ${freshnessCutoff}
              )::int AS "confirmedAliveInFreshWindowCount",
              COUNT(DISTINCT m."canonicalJobId") FILTER (
                WHERE
                  m."removedAt" IS NULL
                  AND c."status" IN ('LIVE', 'AGING')
                  AND c."lastConfirmedAliveAt" >= ${freshnessCutoff}
                  AND (c."lastSourceSeenAt" IS NULL OR c."lastSourceSeenAt" < ${freshnessCutoff})
              )::int AS "heldByConfirmationCount",
              COUNT(DISTINCT m."canonicalJobId") FILTER (
                WHERE
                  m."removedAt" IS NULL
                  AND c."status" IN ('LIVE', 'AGING')
                  AND (c."lastSourceSeenAt" IS NULL OR c."lastSourceSeenAt" < ${freshnessCutoff})
                  AND (
                    c."lastConfirmedAliveAt" IS NULL
                    OR c."lastConfirmedAliveAt" < ${freshnessCutoff}
                  )
              )::int AS "atRiskVisibleCount",
              MAX(m."lastSeenAt") AS "lastSourceSeenAt",
              MAX(c."lastConfirmedAliveAt") AS "lastConfirmedAliveAt"
            FROM "JobSourceMapping" m
            INNER JOIN "JobCanonical" c
              ON c."id" = m."canonicalJobId"
            GROUP BY m."sourceName"
            ORDER BY m."sourceName" ASC
          `,
          prisma.$queryRaw<LifecycleTransitionSqlRow[]>`
            WITH days AS (
              SELECT
                generate_series(
                  ${lookbackStart}::timestamp,
                  ${todayUtc}::timestamp,
                  interval '1 day'
                )::date AS day
            ),
            created_counts AS (
              SELECT
                date_trunc('day', "createdAt")::date AS day,
                COUNT(*)::int AS count
              FROM "JobCanonical"
              WHERE "createdAt" >= ${lookbackStart}
                AND "createdAt" < ${lookbackEndExclusive}
              GROUP BY 1
            ),
            stale_counts AS (
              SELECT
                date_trunc('day', "staleAt")::date AS day,
                COUNT(*)::int AS count
              FROM "JobCanonical"
              WHERE "staleAt" >= ${lookbackStart}
                AND "staleAt" < ${lookbackEndExclusive}
              GROUP BY 1
            ),
            expired_counts AS (
              SELECT
                date_trunc('day', "expiredAt")::date AS day,
                COUNT(*)::int AS count
              FROM "JobCanonical"
              WHERE "expiredAt" >= ${lookbackStart}
                AND "expiredAt" < ${lookbackEndExclusive}
              GROUP BY 1
            ),
            removed_counts AS (
              SELECT
                date_trunc('day', "removedAt")::date AS day,
                COUNT(*)::int AS count
              FROM "JobCanonical"
              WHERE "removedAt" >= ${lookbackStart}
                AND "removedAt" < ${lookbackEndExclusive}
              GROUP BY 1
            ),
            alive_confirm_counts AS (
              SELECT
                date_trunc('day', "lastConfirmedAliveAt")::date AS day,
                COUNT(*)::int AS count
              FROM "JobCanonical"
              WHERE "lastConfirmedAliveAt" >= ${lookbackStart}
                AND "lastConfirmedAliveAt" < ${lookbackEndExclusive}
              GROUP BY 1
            )
            SELECT
              days.day AS "date",
              COALESCE(created_counts.count, 0)::int AS "createdCount",
              COALESCE(stale_counts.count, 0)::int AS "staleEnteredCount",
              COALESCE(expired_counts.count, 0)::int AS "expiredEnteredCount",
              COALESCE(removed_counts.count, 0)::int AS "removedEnteredCount",
              COALESCE(alive_confirm_counts.count, 0)::int AS "aliveConfirmedCount"
            FROM days
            LEFT JOIN created_counts
              ON created_counts.day = days.day
            LEFT JOIN stale_counts
              ON stale_counts.day = days.day
            LEFT JOIN expired_counts
              ON expired_counts.day = days.day
            LEFT JOIN removed_counts
              ON removed_counts.day = days.day
            LEFT JOIN alive_confirm_counts
              ON alive_confirm_counts.day = days.day
            ORDER BY days.day DESC
          `,
          prisma.$queryRaw<LifecycleEvidenceSqlRow[]>`
            WITH active_mappings AS (
              SELECT
                "canonicalJobId",
                COUNT(*)::int AS active_mapping_count
              FROM "JobSourceMapping"
              WHERE "removedAt" IS NULL
              GROUP BY "canonicalJobId"
            )
            SELECT
              COUNT(*) FILTER (WHERE c."status" = 'LIVE')::int AS "liveCount",
              COUNT(*) FILTER (WHERE c."status" = 'AGING')::int AS "agingCount",
              COUNT(*) FILTER (WHERE c."status" = 'STALE')::int AS "staleCount",
              COUNT(*) FILTER (WHERE c."status" = 'EXPIRED')::int AS "expiredCount",
              COUNT(*) FILTER (WHERE c."status" = 'REMOVED')::int AS "removedCount",
              COUNT(*) FILTER (
                WHERE
                  c."status" IN ('LIVE', 'AGING')
                  AND COALESCE(active_mappings.active_mapping_count, 0) > 0
              )::int AS "sourceBackedVisibleCount",
              COUNT(*) FILTER (
                WHERE
                  c."status" IN ('LIVE', 'AGING')
                  AND COALESCE(active_mappings.active_mapping_count, 0) = 0
                  AND c."lastConfirmedAliveAt" >= ${freshnessCutoff}
              )::int AS "heldByConfirmationCount",
              COUNT(*) FILTER (
                WHERE
                  c."status" IN ('LIVE', 'AGING')
                  AND COALESCE(active_mappings.active_mapping_count, 0) = 0
                  AND (
                    c."lastConfirmedAliveAt" IS NULL
                    OR c."lastConfirmedAliveAt" < ${freshnessCutoff}
                  )
              )::int AS "atRiskVisibleCount",
              COUNT(*) FILTER (
                WHERE
                  c."status" IN ('LIVE', 'AGING')
                  AND COALESCE(active_mappings.active_mapping_count, 0) = 0
                  AND c."lastApplyCheckAt" IS NULL
              )::int AS "verificationBacklogCount",
              COUNT(*) FILTER (
                WHERE
                  c."status" IN ('LIVE', 'AGING')
                  AND c."deadSignalAt" IS NOT NULL
              )::int AS "visibleDeadSignalCount",
              COUNT(*) FILTER (
                WHERE
                  c."status" = 'STALE'
                  AND c."lastConfirmedAliveAt" >= ${freshnessCutoff}
              )::int AS "staleRecentlyConfirmedCount",
              COUNT(*) FILTER (
                WHERE
                  c."status" = 'EXPIRED'
                  AND c."deadSignalAt" IS NOT NULL
              )::int AS "expiredWithDeadSignalCount",
              COUNT(*) FILTER (
                WHERE
                  c."status" IN ('LIVE', 'AGING')
                  AND c."lastSourceSeenAt" >= ${freshnessCutoff}
              )::int AS "recentlySeenVisibleCount",
              COUNT(*) FILTER (
                WHERE
                  c."status" IN ('LIVE', 'AGING')
                  AND c."lastConfirmedAliveAt" >= ${freshnessCutoff}
              )::int AS "recentlyConfirmedVisibleCount"
            FROM "JobCanonical" c
            LEFT JOIN active_mappings
              ON active_mappings."canonicalJobId" = c."id"
          `,
        ])
      );

    const lifecycleSnapshots7d = buildLifecycleSnapshots({
      runs: runs7d,
      lookbackStart,
      dayCount: INGESTION_OBSERVABILITY_LOOKBACK_DAYS,
    });
    const sourceYield7d = buildSourceYieldFreshness({
      runs: runs7d,
      sourceFreshnessRows,
    });

    const value: IngestionObservabilityOverview = {
      generatedAt: now.toISOString(),
      lookbackDays: INGESTION_OBSERVABILITY_LOOKBACK_DAYS,
      freshnessWindowDays: INGESTION_FRESHNESS_WINDOW_DAYS,
      sourceYield7d,
      lifecycleSnapshots7d,
      lifecycleTransitions7d: lifecycleTransitions.map((row) => ({
        date: serializeDateOnly(row.date),
        createdCount: toInteger(row.createdCount),
        staleEnteredCount: toInteger(row.staleEnteredCount),
        expiredEnteredCount: toInteger(row.expiredEnteredCount),
        removedEnteredCount: toInteger(row.removedEnteredCount),
        aliveConfirmedCount: toInteger(row.aliveConfirmedCount),
      })),
      lifecycleEvidence: serializeLifecycleEvidence(lifecycleEvidence[0]),
      notes: [
        "Per-source freshness uses a rolling 3-day window over active mappings and recent URL-confirmation signals.",
        "Historical daily snapshots come from the last successful ingestion run recorded each day.",
        "Historical AGING counts were not persisted before this dashboard, so the daily trend view shows snapshots for LIVE/STALE/EXPIRED/REMOVED plus transition events instead of a fabricated AGING series.",
      ],
    };

    ingestionObservabilityCache = {
      expiresAt: nowMs + INGESTION_OBSERVABILITY_TTL_MS,
      value,
    };

    return value;
  } catch (error) {
    console.error("getIngestionObservabilityOverview fallback:", error);
    if (ingestionObservabilityCache) {
      return ingestionObservabilityCache.value;
    }

    return {
      generatedAt: now.toISOString(),
      lookbackDays: INGESTION_OBSERVABILITY_LOOKBACK_DAYS,
      freshnessWindowDays: INGESTION_FRESHNESS_WINDOW_DAYS,
      sourceYield7d: [],
      lifecycleSnapshots7d: buildLifecycleSnapshots({
        runs: [],
        lookbackStart,
        dayCount: INGESTION_OBSERVABILITY_LOOKBACK_DAYS,
      }),
      lifecycleTransitions7d: buildEmptyLifecycleTransitions({
        lookbackStart,
        dayCount: INGESTION_OBSERVABILITY_LOOKBACK_DAYS,
      }),
      lifecycleEvidence: {
        liveCount: 0,
        agingCount: 0,
        staleCount: 0,
        expiredCount: 0,
        removedCount: 0,
        sourceBackedVisibleCount: 0,
        heldByConfirmationCount: 0,
        atRiskVisibleCount: 0,
        verificationBacklogCount: 0,
        visibleDeadSignalCount: 0,
        staleRecentlyConfirmedCount: 0,
        expiredWithDeadSignalCount: 0,
        recentlySeenVisibleCount: 0,
        recentlyConfirmedVisibleCount: 0,
      },
      notes: [
        "Observability query failed; showing an empty fallback instead of forcing ad-hoc SQL against production.",
      ],
    };
  }
}

export async function getIngestionOverview(): Promise<IngestionOverview> {
  const [
    rawCount,
    canonicalCount,
    sourceMappingCount,
    liveCount,
    agingCount,
    staleCount,
    expiredCount,
    removedCount,
    readyToApplyCount,
    reviewRequiredCount,
    manualOnlyCount,
    recentRunCount,
    allRuns,
    rawSourceCounts,
    sourceMappings,
  ] = await Promise.all([
    prisma.jobRaw.count(),
    prisma.jobCanonical.count(),
    prisma.jobSourceMapping.count(),
    prisma.jobCanonical.count({ where: { status: { in: [...VISIBLE_JOB_STATUSES] } } }),
    prisma.jobCanonical.count({ where: { status: "AGING" } }),
    prisma.jobCanonical.count({ where: { status: "STALE" } }),
    prisma.jobCanonical.count({ where: { status: "EXPIRED" } }),
    prisma.jobCanonical.count({ where: { status: "REMOVED" } }),
    prisma.jobCanonical.count({
      where: {
        status: { in: [...VISIBLE_JOB_STATUSES] },
        eligibility: { submissionCategory: "READY_TO_APPLY" },
      },
    }),
    prisma.jobCanonical.count({
      where: {
        status: { in: [...VISIBLE_JOB_STATUSES] },
        eligibility: { submissionCategory: "REVIEW_REQUIRED" },
      },
    }),
    prisma.jobCanonical.count({
      where: {
        status: { in: [...VISIBLE_JOB_STATUSES] },
        eligibility: { submissionCategory: "MANUAL_ONLY" },
      },
    }),
    prisma.ingestionRun.count(),
    prisma.ingestionRun.findMany({
      orderBy: { startedAt: "desc" },
    }),
    prisma.jobRaw.groupBy({
      by: ["sourceName"],
      _count: { _all: true },
      orderBy: { sourceName: "asc" },
    }),
    prisma.jobSourceMapping.findMany({
      select: {
        sourceName: true,
        canonicalJobId: true,
        removedAt: true,
        canonicalJob: {
          select: {
            status: true,
          },
        },
      },
    }),
  ]);

  const recentRuns = allRuns.slice(0, RECENT_RUN_LIMIT).map(serializeRun);
  const sourceCoverage = buildSourceCoverage({
    rawSourceCounts,
    sourceMappings,
    allRuns: allRuns.map(serializeRun),
  });

  return {
    rawCount,
    canonicalCount,
    sourceMappingCount,
    liveCount,
    agingCount,
    staleCount,
    expiredCount,
    removedCount,
    readyToApplyCount,
    reviewRequiredCount,
    manualOnlyCount,
    recentRunCount,
    sources: sourceCoverage,
    recentRuns,
  };
}

function buildSourceYieldFreshness({
  runs,
  sourceFreshnessRows,
}: {
  runs: Array<{
    sourceName: string;
    status: IngestionRunListItem["status"];
    startedAt: Date;
    fetchedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    canonicalCreatedCount: number;
    canonicalUpdatedCount: number;
    dedupedCount: number;
    sourceMappingsRemovedCount: number;
  }>;
  sourceFreshnessRows: SourceFreshnessSqlRow[];
}): IngestionSourceYieldFreshnessRow[] {
  const scheduledSources = new Map(
    getScheduledConnectorSnapshot().map((source) => [source.sourceName, source])
  );
  const freshnessBySource = new Map(
    sourceFreshnessRows.map((row) => [row.sourceName, row] as const)
  );
  const rows = new Map<string, IngestionSourceYieldFreshnessRow>();

  for (const source of scheduledSources.values()) {
    rows.set(source.sourceName, {
      sourceName: source.sourceName,
      isScheduled: true,
      scheduleCadenceMinutes: source.cadenceMinutes,
      runs7d: 0,
      successfulRuns7d: 0,
      failedRuns7d: 0,
      fetched7d: 0,
      accepted7d: 0,
      rejected7d: 0,
      created7d: 0,
      updated7d: 0,
      deduped7d: 0,
      removedMappings7d: 0,
      currentLiveCount: 0,
      currentAgingCount: 0,
      currentStaleCount: 0,
      currentExpiredCount: 0,
      activeMappingCount: 0,
      removedMappingCount: 0,
      seenInFreshWindowCount: 0,
      confirmedAliveInFreshWindowCount: 0,
      heldByConfirmationCount: 0,
      atRiskVisibleCount: 0,
      lastRunStartedAt: null,
      lastSuccessfulRunAt: null,
      lastSourceSeenAt: null,
      lastConfirmedAliveAt: null,
    });
  }

  for (const row of sourceFreshnessRows) {
    const existing = rows.get(row.sourceName);
    rows.set(row.sourceName, {
      sourceName: row.sourceName,
      isScheduled: existing?.isScheduled ?? scheduledSources.has(row.sourceName),
      scheduleCadenceMinutes:
        existing?.scheduleCadenceMinutes ??
        scheduledSources.get(row.sourceName)?.cadenceMinutes ??
        null,
      runs7d: existing?.runs7d ?? 0,
      successfulRuns7d: existing?.successfulRuns7d ?? 0,
      failedRuns7d: existing?.failedRuns7d ?? 0,
      fetched7d: existing?.fetched7d ?? 0,
      accepted7d: existing?.accepted7d ?? 0,
      rejected7d: existing?.rejected7d ?? 0,
      created7d: existing?.created7d ?? 0,
      updated7d: existing?.updated7d ?? 0,
      deduped7d: existing?.deduped7d ?? 0,
      removedMappings7d: existing?.removedMappings7d ?? 0,
      currentLiveCount: toInteger(row.currentLiveCount),
      currentAgingCount: toInteger(row.currentAgingCount),
      currentStaleCount: toInteger(row.currentStaleCount),
      currentExpiredCount: toInteger(row.currentExpiredCount),
      activeMappingCount: toInteger(row.activeMappingCount),
      removedMappingCount: toInteger(row.removedMappingCount),
      seenInFreshWindowCount: toInteger(row.seenInFreshWindowCount),
      confirmedAliveInFreshWindowCount: toInteger(
        row.confirmedAliveInFreshWindowCount
      ),
      heldByConfirmationCount: toInteger(row.heldByConfirmationCount),
      atRiskVisibleCount: toInteger(row.atRiskVisibleCount),
      lastRunStartedAt: existing?.lastRunStartedAt ?? null,
      lastSuccessfulRunAt: existing?.lastSuccessfulRunAt ?? null,
      lastSourceSeenAt: serializeOptionalDateTime(row.lastSourceSeenAt),
      lastConfirmedAliveAt: serializeOptionalDateTime(row.lastConfirmedAliveAt),
    });
  }

  for (const run of runs) {
    const row =
      rows.get(run.sourceName) ??
      ({
        sourceName: run.sourceName,
        isScheduled: scheduledSources.has(run.sourceName),
        scheduleCadenceMinutes:
          scheduledSources.get(run.sourceName)?.cadenceMinutes ?? null,
        runs7d: 0,
        successfulRuns7d: 0,
        failedRuns7d: 0,
        fetched7d: 0,
        accepted7d: 0,
        rejected7d: 0,
        created7d: 0,
        updated7d: 0,
        deduped7d: 0,
        removedMappings7d: 0,
        currentLiveCount: 0,
        currentAgingCount: 0,
        currentStaleCount: 0,
        currentExpiredCount: 0,
        activeMappingCount: 0,
        removedMappingCount: 0,
        seenInFreshWindowCount: 0,
        confirmedAliveInFreshWindowCount: 0,
        heldByConfirmationCount: 0,
        atRiskVisibleCount: 0,
        lastRunStartedAt: null,
        lastSuccessfulRunAt: null,
        lastSourceSeenAt: freshnessBySource.has(run.sourceName)
          ? serializeOptionalDateTime(freshnessBySource.get(run.sourceName)?.lastSourceSeenAt ?? null)
          : null,
        lastConfirmedAliveAt: freshnessBySource.has(run.sourceName)
          ? serializeOptionalDateTime(
              freshnessBySource.get(run.sourceName)?.lastConfirmedAliveAt ?? null
            )
          : null,
      } satisfies IngestionSourceYieldFreshnessRow);

    row.runs7d += 1;
    row.fetched7d += run.fetchedCount;
    row.accepted7d += run.acceptedCount;
    row.rejected7d += run.rejectedCount;
    row.created7d += run.canonicalCreatedCount;
    row.updated7d += run.canonicalUpdatedCount;
    row.deduped7d += run.dedupedCount;
    row.removedMappings7d += run.sourceMappingsRemovedCount;

    if (!row.lastRunStartedAt || run.startedAt > new Date(row.lastRunStartedAt)) {
      row.lastRunStartedAt = run.startedAt.toISOString();
    }

    if (run.status === "SUCCESS") {
      row.successfulRuns7d += 1;
      if (!row.lastSuccessfulRunAt || run.startedAt > new Date(row.lastSuccessfulRunAt)) {
        row.lastSuccessfulRunAt = run.startedAt.toISOString();
      }
    } else if (run.status === "FAILED") {
      row.failedRuns7d += 1;
    }

    rows.set(run.sourceName, row);
  }

  return [...rows.values()].sort((left, right) => {
    const leftVisible = left.currentLiveCount + left.currentAgingCount;
    const rightVisible = right.currentLiveCount + right.currentAgingCount;
    if (rightVisible !== leftVisible) {
      return rightVisible - leftVisible;
    }

    if (right.created7d !== left.created7d) {
      return right.created7d - left.created7d;
    }

    if (left.isScheduled !== right.isScheduled) {
      return left.isScheduled ? -1 : 1;
    }

    return left.sourceName.localeCompare(right.sourceName);
  });
}

function buildLifecycleSnapshots({
  runs,
  lookbackStart,
  dayCount,
}: {
  runs: Array<{
    status: IngestionRunListItem["status"];
    startedAt: Date;
    liveCount: number;
    staleCount: number;
    expiredCount: number;
    removedCount: number;
  }>;
  lookbackStart: Date;
  dayCount: number;
}): IngestionLifecycleSnapshotRow[] {
  const lastSuccessfulByDay = new Map<
    string,
    {
      startedAt: Date;
      liveCount: number;
      staleCount: number;
      expiredCount: number;
      removedCount: number;
    }
  >();

  for (const run of runs) {
    if (run.status !== "SUCCESS") {
      continue;
    }

    const dayKey = formatUtcDay(run.startedAt);
    const existing = lastSuccessfulByDay.get(dayKey);
    if (!existing || run.startedAt > existing.startedAt) {
      lastSuccessfulByDay.set(dayKey, {
        startedAt: run.startedAt,
        liveCount: run.liveCount,
        staleCount: run.staleCount,
        expiredCount: run.expiredCount,
        removedCount: run.removedCount,
      });
    }
  }

  const rows: IngestionLifecycleSnapshotRow[] = [];
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const day = addUtcDays(lookbackStart, offset);
    const dayKey = formatUtcDay(day);
    const snapshot = lastSuccessfulByDay.get(dayKey);
    rows.push({
      date: dayKey,
      snapshotCapturedAt: snapshot?.startedAt.toISOString() ?? null,
      liveCount: snapshot?.liveCount ?? null,
      staleCount: snapshot?.staleCount ?? null,
      expiredCount: snapshot?.expiredCount ?? null,
      removedCount: snapshot?.removedCount ?? null,
      hasSnapshot: Boolean(snapshot),
    });
  }

  return rows.reverse();
}

function buildEmptyLifecycleTransitions({
  lookbackStart,
  dayCount,
}: {
  lookbackStart: Date;
  dayCount: number;
}): IngestionLifecycleTransitionRow[] {
  const rows: IngestionLifecycleTransitionRow[] = [];

  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    rows.push({
      date: formatUtcDay(addUtcDays(lookbackStart, offset)),
      createdCount: 0,
      staleEnteredCount: 0,
      expiredEnteredCount: 0,
      removedEnteredCount: 0,
      aliveConfirmedCount: 0,
    });
  }

  return rows.reverse();
}

function serializeRun(run: {
  id: string;
  connectorKey: string;
  sourceName: string;
  sourceTier: IngestionRunListItem["sourceTier"];
  runMode: IngestionRunListItem["runMode"];
  status: IngestionRunListItem["status"];
  startedAt: Date;
  endedAt: Date | null;
  fetchedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  rawCreatedCount: number;
  rawUpdatedCount: number;
  canonicalCreatedCount: number;
  canonicalUpdatedCount: number;
  dedupedCount: number;
  sourceMappingCreatedCount: number;
  sourceMappingUpdatedCount: number;
  sourceMappingsRemovedCount: number;
  liveCount: number;
  staleCount: number;
  expiredCount: number;
  removedCount: number;
  errorSummary: string | null;
}): IngestionRunListItem {
  return {
    id: run.id,
    connectorKey: run.connectorKey,
    sourceName: run.sourceName,
    sourceTier: run.sourceTier,
    runMode: run.runMode,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
    fetchedCount: run.fetchedCount,
    acceptedCount: run.acceptedCount,
    rejectedCount: run.rejectedCount,
    rawCreatedCount: run.rawCreatedCount,
    rawUpdatedCount: run.rawUpdatedCount,
    canonicalCreatedCount: run.canonicalCreatedCount,
    canonicalUpdatedCount: run.canonicalUpdatedCount,
    dedupedCount: run.dedupedCount,
    sourceMappingCreatedCount: run.sourceMappingCreatedCount,
    sourceMappingUpdatedCount: run.sourceMappingUpdatedCount,
    sourceMappingsRemovedCount: run.sourceMappingsRemovedCount,
    liveCount: run.liveCount,
    staleCount: run.staleCount,
    expiredCount: run.expiredCount,
    removedCount: run.removedCount,
    errorSummary: run.errorSummary,
  };
}

function serializeLifecycleEvidence(
  row: LifecycleEvidenceSqlRow | undefined
): IngestionLifecycleEvidence {
  return {
    liveCount: toInteger(row?.liveCount),
    agingCount: toInteger(row?.agingCount),
    staleCount: toInteger(row?.staleCount),
    expiredCount: toInteger(row?.expiredCount),
    removedCount: toInteger(row?.removedCount),
    sourceBackedVisibleCount: toInteger(row?.sourceBackedVisibleCount),
    heldByConfirmationCount: toInteger(row?.heldByConfirmationCount),
    atRiskVisibleCount: toInteger(row?.atRiskVisibleCount),
    verificationBacklogCount: toInteger(row?.verificationBacklogCount),
    visibleDeadSignalCount: toInteger(row?.visibleDeadSignalCount),
    staleRecentlyConfirmedCount: toInteger(row?.staleRecentlyConfirmedCount),
    expiredWithDeadSignalCount: toInteger(row?.expiredWithDeadSignalCount),
    recentlySeenVisibleCount: toInteger(row?.recentlySeenVisibleCount),
    recentlyConfirmedVisibleCount: toInteger(row?.recentlyConfirmedVisibleCount),
  };
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatUtcDay(date: Date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function serializeDateOnly(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function serializeOptionalDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function toInteger(value: number | bigint | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }

  return 0;
}

function buildSourceCoverage({
  rawSourceCounts,
  sourceMappings,
  allRuns,
}: {
  rawSourceCounts: Array<{
    sourceName: string;
    _count: { _all: number };
  }>;
  sourceMappings: Array<{
    sourceName: string;
    canonicalJobId: string;
    removedAt: Date | null;
    canonicalJob: {
      status: "LIVE" | "AGING" | "STALE" | "EXPIRED" | "REMOVED";
    };
  }>;
  allRuns: IngestionRunListItem[];
}): IngestionSourceCoverage[] {
  const scheduledSources = new Map(
    getScheduledConnectorSnapshot().map((source) => [source.sourceName, source])
  );
  const sources = new Map<string, IngestionSourceCoverage>();

  for (const scheduledSource of scheduledSources.values()) {
    sources.set(scheduledSource.sourceName, {
      sourceName: scheduledSource.sourceName,
      rawCount: 0,
      activeMappingCount: 0,
      liveCanonicalCount: 0,
      staleCanonicalCount: 0,
      removedMappingCount: 0,
      lastRunStatus: null,
      lastRunStartedAt: null,
      lastSuccessfulRunAt: null,
      scheduleCadenceMinutes: scheduledSource.cadenceMinutes,
      isScheduled: true,
    });
  }

  for (const rawSource of rawSourceCounts) {
    sources.set(rawSource.sourceName, {
      sourceName: rawSource.sourceName,
      rawCount: rawSource._count._all,
      activeMappingCount: 0,
      liveCanonicalCount: 0,
      staleCanonicalCount: 0,
      removedMappingCount: 0,
      lastRunStatus: null,
      lastRunStartedAt: null,
      lastSuccessfulRunAt: null,
      scheduleCadenceMinutes:
        scheduledSources.get(rawSource.sourceName)?.cadenceMinutes ?? null,
      isScheduled: scheduledSources.has(rawSource.sourceName),
    });
  }

  const liveCanonicalBySource = new Map<string, Set<string>>();
  const staleCanonicalBySource = new Map<string, Set<string>>();

  for (const sourceMapping of sourceMappings) {
    const source = sources.get(sourceMapping.sourceName) ?? {
      sourceName: sourceMapping.sourceName,
      rawCount: 0,
      activeMappingCount: 0,
      liveCanonicalCount: 0,
      staleCanonicalCount: 0,
      removedMappingCount: 0,
      lastRunStatus: null,
      lastRunStartedAt: null,
      lastSuccessfulRunAt: null,
      scheduleCadenceMinutes:
        scheduledSources.get(sourceMapping.sourceName)?.cadenceMinutes ?? null,
      isScheduled: scheduledSources.has(sourceMapping.sourceName),
    };

    if (sourceMapping.removedAt) {
      source.removedMappingCount += 1;
      sources.set(source.sourceName, source);
      continue;
    }

    source.activeMappingCount += 1;
    sources.set(source.sourceName, source);

    if (
      sourceMapping.canonicalJob.status === "LIVE" ||
      sourceMapping.canonicalJob.status === "AGING"
    ) {
      const liveIds = liveCanonicalBySource.get(source.sourceName) ?? new Set<string>();
      liveIds.add(sourceMapping.canonicalJobId);
      liveCanonicalBySource.set(source.sourceName, liveIds);
    }

    if (sourceMapping.canonicalJob.status === "STALE") {
      const staleIds = staleCanonicalBySource.get(source.sourceName) ?? new Set<string>();
      staleIds.add(sourceMapping.canonicalJobId);
      staleCanonicalBySource.set(source.sourceName, staleIds);
    }
  }

  for (const [sourceName, liveIds] of liveCanonicalBySource) {
    const source = sources.get(sourceName);
    if (!source) continue;
    source.liveCanonicalCount = liveIds.size;
  }

  for (const [sourceName, staleIds] of staleCanonicalBySource) {
    const source = sources.get(sourceName);
    if (!source) continue;
    source.staleCanonicalCount = staleIds.size;
  }

  const lastRunBySource = new Map<string, IngestionRunListItem>();
  const lastSuccessBySource = new Map<string, IngestionRunListItem>();

  for (const run of allRuns) {
    if (!lastRunBySource.has(run.sourceName)) {
      lastRunBySource.set(run.sourceName, run);
    }

    if (run.status === "SUCCESS" && !lastSuccessBySource.has(run.sourceName)) {
      lastSuccessBySource.set(run.sourceName, run);
    }
  }

  for (const [sourceName, run] of lastRunBySource) {
    const source = sources.get(sourceName) ?? {
      sourceName,
      rawCount: 0,
      activeMappingCount: 0,
      liveCanonicalCount: 0,
      staleCanonicalCount: 0,
      removedMappingCount: 0,
      lastRunStatus: null,
      lastRunStartedAt: null,
      lastSuccessfulRunAt: null,
      scheduleCadenceMinutes: scheduledSources.get(sourceName)?.cadenceMinutes ?? null,
      isScheduled: scheduledSources.has(sourceName),
    };

    source.lastRunStatus = run.status;
    source.lastRunStartedAt = run.startedAt;
    source.lastSuccessfulRunAt =
      lastSuccessBySource.get(sourceName)?.startedAt ?? null;
    sources.set(sourceName, source);
  }

  return [...sources.values()].sort((left, right) => {
    if (right.liveCanonicalCount !== left.liveCanonicalCount) {
      return right.liveCanonicalCount - left.liveCanonicalCount;
    }

    if (left.isScheduled !== right.isScheduled) {
      return left.isScheduled ? -1 : 1;
    }

    return left.sourceName.localeCompare(right.sourceName);
  });
}
