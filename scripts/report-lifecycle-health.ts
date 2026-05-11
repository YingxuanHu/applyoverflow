import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { getLifecycleProfile, getLifecycleProfileName } from "@/lib/ingestion/lifecycle-config";

process.env.DATABASE_PROCESS_ROLE ??= "expansion_pipeline";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";

type CliArgs = {
  days: number;
  out: string;
};

type StatusRow = {
  status: string;
  count: bigint | number;
  avgLifetimeDays: number | null;
  avgCurrentAgeDays: number | null;
  avgVisibleAgeDays: number | null;
};

type DailyFlowRow = {
  day: string;
  createdCount: bigint | number;
  expiredCount: bigint | number;
  removedCount: bigint | number;
  visibleCount: bigint | number;
};

type EvidenceRow = {
  visibleWithActiveMappings: bigint | number;
  visibleHeldByConfirmationOnly: bigint | number;
  visibleAtRiskWithoutConfirmation: bigint | number;
  visibleRecentlyConfirmedAlive: bigint | number;
};

type SourceGapRow = {
  sourceName: string;
  visibleCount: bigint | number;
  activeMappingCount: bigint | number;
  recentlyConfirmedVisibleCount: bigint | number;
  confirmationLiftVisibleCount: bigint | number;
};

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    days: 60,
    out: "data/ops/lifecycle-health.json",
  };

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=", 2);
    const key = rawKey.trim();
    const value = rawValue?.trim();
    if (!key || !value) continue;

    if (key === "days") {
      const numeric = Number.parseInt(value, 10);
      if (Number.isFinite(numeric) && numeric > 0) {
        parsed.days = numeric;
      }
      continue;
    }

    if (key === "out") {
      parsed.out = value;
    }
  }

  return parsed;
}

function toNumber(value: bigint | number | null | undefined) {
  if (typeof value === "bigint") return Number(value);
  return value ?? 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const cutoff = new Date(now.getTime() - args.days * 24 * 60 * 60 * 1000);
  const lifecycleProfile = getLifecycleProfile();
  const liveConfirmationCutoff = new Date(
    now.getTime() -
      lifecycleProfile.confirmationWindowsDays.liveFloor * 24 * 60 * 60 * 1000
  );

  const [statusRows, dailyFlowRows, evidenceRows, sourceGapRows] = await Promise.all([
    prisma.$queryRaw<StatusRow[]>`
      SELECT
        status::text AS status,
        COUNT(*) AS count,
        AVG(
          EXTRACT(
            EPOCH FROM (
              COALESCE("expiredAt", "removedAt", NOW()) - "createdAt"
            )
          ) / 86400.0
        ) AS "avgLifetimeDays",
        AVG(EXTRACT(EPOCH FROM (NOW() - "createdAt")) / 86400.0) AS "avgCurrentAgeDays",
        AVG(EXTRACT(EPOCH FROM (NOW() - "createdAt")) / 86400.0)
          FILTER (WHERE status IN ('LIVE', 'AGING', 'STALE')) AS "avgVisibleAgeDays"
      FROM "JobCanonical"
      WHERE "createdAt" >= ${cutoff}
      GROUP BY 1
      ORDER BY COUNT(*) DESC, 1 ASC
    `,
    prisma.$queryRaw<DailyFlowRow[]>`
      WITH days AS (
        SELECT generate_series(
          date_trunc('day', ${cutoff}::timestamp),
          date_trunc('day', ${now}::timestamp),
          interval '1 day'
        ) AS day
      ),
      created_daily AS (
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS created_count
        FROM "JobCanonical"
        WHERE "createdAt" >= ${cutoff}
        GROUP BY 1
      ),
      expired_daily AS (
        SELECT date_trunc('day', "expiredAt") AS day, COUNT(*) AS expired_count
        FROM "JobCanonical"
        WHERE "expiredAt" IS NOT NULL
          AND "expiredAt" >= ${cutoff}
        GROUP BY 1
      ),
      removed_daily AS (
        SELECT date_trunc('day', "removedAt") AS day, COUNT(*) AS removed_count
        FROM "JobCanonical"
        WHERE "removedAt" IS NOT NULL
          AND "removedAt" >= ${cutoff}
        GROUP BY 1
      ),
      visible_daily AS (
        SELECT date_trunc('day', "createdAt") AS day,
          COUNT(*) FILTER (WHERE status IN ('LIVE', 'AGING', 'STALE')) AS visible_count
        FROM "JobCanonical"
        WHERE "createdAt" >= ${cutoff}
        GROUP BY 1
      )
      SELECT
        TO_CHAR(days.day, 'YYYY-MM-DD') AS day,
        COALESCE(created_daily.created_count, 0) AS "createdCount",
        COALESCE(expired_daily.expired_count, 0) AS "expiredCount",
        COALESCE(removed_daily.removed_count, 0) AS "removedCount",
        COALESCE(visible_daily.visible_count, 0) AS "visibleCount"
      FROM days
      LEFT JOIN created_daily ON created_daily.day = days.day
      LEFT JOIN expired_daily ON expired_daily.day = days.day
      LEFT JOIN removed_daily ON removed_daily.day = days.day
      LEFT JOIN visible_daily ON visible_daily.day = days.day
      ORDER BY days.day ASC
    `,
    prisma.$queryRaw<EvidenceRow[]>`
      WITH active_mapping_counts AS (
        SELECT
          "canonicalJobId",
          COUNT(*) FILTER (WHERE "removedAt" IS NULL) AS active_mapping_count
        FROM "JobSourceMapping"
        GROUP BY 1
      )
      SELECT
        COUNT(*) FILTER (
          WHERE jc.status IN ('LIVE', 'AGING', 'STALE')
            AND COALESCE(amc.active_mapping_count, 0) > 0
        ) AS "visibleWithActiveMappings",
        COUNT(*) FILTER (
          WHERE jc.status IN ('LIVE', 'AGING', 'STALE')
            AND COALESCE(amc.active_mapping_count, 0) = 0
            AND jc."lastConfirmedAliveAt" IS NOT NULL
        ) AS "visibleHeldByConfirmationOnly",
        COUNT(*) FILTER (
          WHERE jc.status IN ('LIVE', 'AGING', 'STALE')
            AND COALESCE(amc.active_mapping_count, 0) = 0
            AND jc."lastConfirmedAliveAt" IS NULL
        ) AS "visibleAtRiskWithoutConfirmation",
        COUNT(*) FILTER (
          WHERE jc.status IN ('LIVE', 'AGING', 'STALE')
            AND jc."lastConfirmedAliveAt" >= ${liveConfirmationCutoff}
        ) AS "visibleRecentlyConfirmedAlive"
      FROM "JobCanonical" jc
      LEFT JOIN active_mapping_counts amc
        ON amc."canonicalJobId" = jc.id
    `,
    prisma.$queryRaw<SourceGapRow[]>`
      WITH source_visibility AS (
        SELECT
          jsm."sourceName",
          COUNT(DISTINCT jsm."canonicalJobId") FILTER (
            WHERE jsm."removedAt" IS NULL
              AND jc.status IN ('LIVE', 'AGING', 'STALE')
          ) AS visible_count,
          COUNT(*) FILTER (WHERE jsm."removedAt" IS NULL) AS active_mapping_count,
          COUNT(DISTINCT jsm."canonicalJobId") FILTER (
            WHERE jsm."removedAt" IS NULL
              AND jc.status IN ('LIVE', 'AGING', 'STALE')
              AND jc."lastConfirmedAliveAt" >= ${liveConfirmationCutoff}
          ) AS recently_confirmed_visible_count,
          COUNT(DISTINCT jsm."canonicalJobId") FILTER (
            WHERE jsm."removedAt" IS NULL
              AND jc.status IN ('LIVE', 'AGING', 'STALE')
              AND jc."lastConfirmedAliveAt" >= ${liveConfirmationCutoff}
              AND (
                jc."lastSourceSeenAt" IS NULL OR
                jc."lastSourceSeenAt" < ${liveConfirmationCutoff}
              )
          ) AS confirmation_lift_visible_count
        FROM "JobSourceMapping" jsm
        JOIN "JobCanonical" jc
          ON jc.id = jsm."canonicalJobId"
        WHERE jsm."createdAt" >= ${cutoff}
        GROUP BY 1
      )
      SELECT
        "sourceName",
        visible_count AS "visibleCount",
        active_mapping_count AS "activeMappingCount",
        recently_confirmed_visible_count AS "recentlyConfirmedVisibleCount",
        confirmation_lift_visible_count AS "confirmationLiftVisibleCount"
      FROM source_visibility
      WHERE visible_count > 0
      ORDER BY confirmation_lift_visible_count DESC, recently_confirmed_visible_count DESC
      LIMIT 25
    `,
  ]);

  const output = {
    generatedAt: now.toISOString(),
    windowDays: args.days,
    cutoff: cutoff.toISOString(),
    lifecycleProfile: {
      name: getLifecycleProfileName(),
      config: lifecycleProfile,
    },
    statusBreakdown: statusRows.map((row) => ({
      status: row.status,
      count: toNumber(row.count),
      avgLifetimeDays:
        row.avgLifetimeDays == null ? null : Math.round(row.avgLifetimeDays * 100) / 100,
      avgCurrentAgeDays:
        row.avgCurrentAgeDays == null ? null : Math.round(row.avgCurrentAgeDays * 100) / 100,
      avgVisibleAgeDays:
        row.avgVisibleAgeDays == null ? null : Math.round(row.avgVisibleAgeDays * 100) / 100,
    })),
    evidenceSummary: evidenceRows.map((row) => ({
      visibleWithActiveMappings: toNumber(row.visibleWithActiveMappings),
      visibleHeldByConfirmationOnly: toNumber(row.visibleHeldByConfirmationOnly),
      visibleAtRiskWithoutConfirmation: toNumber(row.visibleAtRiskWithoutConfirmation),
      visibleRecentlyConfirmedAlive: toNumber(row.visibleRecentlyConfirmedAlive),
    }))[0] ?? null,
    dailyFlows: dailyFlowRows.map((row) => ({
      day: row.day,
      createdCount: toNumber(row.createdCount),
      expiredCount: toNumber(row.expiredCount),
      removedCount: toNumber(row.removedCount),
      visibleCount: toNumber(row.visibleCount),
      netVisibleDelta:
        toNumber(row.createdCount) - toNumber(row.expiredCount) - toNumber(row.removedCount),
    })),
    topSourcesWithRecentConfirmationDependency: sourceGapRows.map((row) => ({
      sourceName: row.sourceName,
      visibleCount: toNumber(row.visibleCount),
      activeMappingCount: toNumber(row.activeMappingCount),
      recentlyConfirmedVisibleCount: toNumber(row.recentlyConfirmedVisibleCount),
      confirmationLiftVisibleCount: toNumber(row.confirmationLiftVisibleCount),
    })),
  };

  const outputPath = path.resolve(args.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(
      "[lifecycle:report] failed:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
