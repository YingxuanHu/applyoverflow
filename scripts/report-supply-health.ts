// Supply-health scorecard: answers "why is the job board shrinking?" in one
// pass. Reports the add/expire/remove waterfall, evidence-age of the LIVE
// pool against the feed's visibility windows, poll coverage, jobs-at-risk,
// expiry attribution (real closures vs stale-evidence starvation), queue
// backlog, and zombie sources.
//
// Usage:
//   npm run supply:health
//   npm run supply:health -- --json

import "dotenv/config";

import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import {
  CAREER_STAGE_FILTER_CONFIDENCE_THRESHOLD,
  INDUSTRY_FILTER_CONFIDENCE_THRESHOLD,
  ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD,
} from "../src/lib/job-metadata";

const EVIDENCE_WINDOW_DAYS = 14;
const ALIVE_WINDOW_DAYS = 30;

// Steady-state pool target the growth program is driving toward.
const SUPPLY_TARGET_LIVE_JOBS = (() => {
  const parsed = Number.parseInt(process.env.SUPPLY_TARGET_LIVE_JOBS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1_000_000;
})();

type Report = Record<string, unknown>;

async function canonicalByStatus() {
  const rows = await prisma.jobCanonical.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

async function feedByStatus() {
  const rows = await prisma.jobFeedIndex.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

async function weeklyFlow(weeks: number) {
  return prisma.$queryRaw<
    Array<{ week: Date; added: bigint; expired: bigint; removed: bigint }>
  >(Prisma.sql`
    SELECT w.week,
      COALESCE(a.added, 0)::bigint AS added,
      COALESCE(e.expired, 0)::bigint AS expired,
      COALESCE(r.removed, 0)::bigint AS removed
    FROM (
      SELECT generate_series(
        date_trunc('week', now() - make_interval(days => ${weeks * 7}::int)),
        date_trunc('week', now()),
        '1 week'
      )::date AS week
    ) w
    LEFT JOIN (
      SELECT date_trunc('week', "firstSeenAt")::date wk, COUNT(*) added
      FROM "JobCanonical"
      WHERE "firstSeenAt" > now() - make_interval(days => ${weeks * 7 + 7}::int)
      GROUP BY 1
    ) a ON a.wk = w.week
    LEFT JOIN (
      SELECT date_trunc('week', "expiredAt")::date wk, COUNT(*) expired
      FROM "JobCanonical"
      WHERE "expiredAt" > now() - make_interval(days => ${weeks * 7 + 7}::int)
      GROUP BY 1
    ) e ON e.wk = w.week
    LEFT JOIN (
      SELECT date_trunc('week', "removedAt")::date wk, COUNT(*) removed
      FROM "JobCanonical"
      WHERE "removedAt" > now() - make_interval(days => ${weeks * 7 + 7}::int)
      GROUP BY 1
    ) r ON r.wk = w.week
    ORDER BY 1
  `);
}

async function liveEvidenceBuckets() {
  const [row] = await prisma.$queryRaw<
    Array<{
      live_total: bigint;
      fresh_0_7d: bigint;
      warn_7_11d: bigint;
      critical_11_14d: bigint;
      stale_over_14d: bigint;
      fails_both_windows: bigint;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*) AS live_total,
      COUNT(*) FILTER (
        WHERE COALESCE("lastSourceSeenAt", "lastSeenAt") > now() - interval '7 days'
      ) AS fresh_0_7d,
      COUNT(*) FILTER (
        WHERE COALESCE("lastSourceSeenAt", "lastSeenAt") <= now() - interval '7 days'
          AND COALESCE("lastSourceSeenAt", "lastSeenAt") > now() - interval '11 days'
      ) AS warn_7_11d,
      COUNT(*) FILTER (
        WHERE COALESCE("lastSourceSeenAt", "lastSeenAt") <= now() - interval '11 days'
          AND COALESCE("lastSourceSeenAt", "lastSeenAt") > now() - make_interval(days => ${EVIDENCE_WINDOW_DAYS}::int)
      ) AS critical_11_14d,
      COUNT(*) FILTER (
        WHERE COALESCE("lastSourceSeenAt", "lastSeenAt") <= now() - make_interval(days => ${EVIDENCE_WINDOW_DAYS}::int)
      ) AS stale_over_14d,
      COUNT(*) FILTER (
        WHERE COALESCE("lastSourceSeenAt", "lastSeenAt") <= now() - make_interval(days => ${EVIDENCE_WINDOW_DAYS}::int)
          AND (
            "lastConfirmedAliveAt" IS NULL
            OR "lastConfirmedAliveAt" <= now() - make_interval(days => ${ALIVE_WINDOW_DAYS}::int)
          )
      ) AS fails_both_windows
    FROM "JobCanonical"
    WHERE status = 'LIVE'
  `);
  return row;
}

async function hiddenButLive() {
  const [row] = await prisma.$queryRaw<Array<{ hidden_live: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS hidden_live
    FROM "JobFeedIndex" f
    JOIN "JobCanonical" c ON c.id = f."canonicalJobId"
    WHERE c.status = 'LIVE' AND f.status = 'REMOVED'
  `);
  return Number(row?.hidden_live ?? 0);
}

async function pollCoverage() {
  const [row] = await prisma.$queryRaw<
    Array<{
      pollable: bigint;
      polled_24h: bigint;
      polled_3d: bigint;
      polled_7d: bigint;
      polled_14d: bigint;
      never_polled: bigint;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*) AS pollable,
      COUNT(*) FILTER (WHERE "lastSuccessfulPollAt" > now() - interval '1 day') AS polled_24h,
      COUNT(*) FILTER (WHERE "lastSuccessfulPollAt" > now() - interval '3 days') AS polled_3d,
      COUNT(*) FILTER (WHERE "lastSuccessfulPollAt" > now() - interval '7 days') AS polled_7d,
      COUNT(*) FILTER (WHERE "lastSuccessfulPollAt" > now() - interval '14 days') AS polled_14d,
      COUNT(*) FILTER (WHERE "lastSuccessfulPollAt" IS NULL) AS never_polled
    FROM "CompanySource"
    WHERE status IN ('ACTIVE', 'PROVISIONED', 'DEGRADED')
      AND "pollState" NOT IN ('DISABLED', 'QUARANTINED')
  `);
  return row;
}

async function jobsAtRisk() {
  const [row] = await prisma.$queryRaw<
    Array<{ sources: bigint; retained_live_jobs: bigint }>
  >(Prisma.sql`
    SELECT COUNT(*) AS sources, COALESCE(SUM("retainedLiveJobCount"), 0) AS retained_live_jobs
    FROM "CompanySource"
    WHERE status IN ('ACTIVE', 'PROVISIONED', 'DEGRADED')
      AND ("lastSuccessfulPollAt" IS NULL OR "lastSuccessfulPollAt" < now() - interval '7 days')
      AND "retainedLiveJobCount" > 0
  `);
  return row;
}

async function expiryAttribution() {
  const [row] = await prisma.$queryRaw<
    Array<{
      expired_14d: bigint;
      evidence_starved: bigint;
      had_dead_signal: bigint;
      had_passed_deadline: bigint;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*) AS expired_14d,
      COUNT(*) FILTER (
        WHERE "expiredAt" - COALESCE("lastSourceSeenAt", "lastSeenAt") > make_interval(days => ${EVIDENCE_WINDOW_DAYS}::int)
      ) AS evidence_starved,
      COUNT(*) FILTER (WHERE "deadSignalAt" IS NOT NULL) AS had_dead_signal,
      COUNT(*) FILTER (WHERE deadline IS NOT NULL AND deadline < "expiredAt") AS had_passed_deadline
    FROM "JobCanonical"
    WHERE "expiredAt" > now() - interval '14 days'
  `);
  return row;
}

async function queueBacklog() {
  return prisma.$queryRaw<
    Array<{ kind: string; status: string; count: bigint; oldest_due: Date | null }>
  >(Prisma.sql`
    SELECT kind::text, status::text, COUNT(*) AS count, MIN("notBeforeAt") AS oldest_due
    FROM "SourceTask"
    WHERE status IN ('PENDING', 'RUNNING')
    GROUP BY 1, 2
    ORDER BY 3 DESC
  `);
}

// Label coverage over the visible feed: a job is only filterable when its
// structured labels clear the same confidence thresholds the feed filters
// use, so unlabeled supply is invisible to filtered searches even when LIVE.
async function labelCoverage() {
  const [row] = await prisma.$queryRaw<
    Array<{
      visible: bigint;
      role_labeled: bigint;
      industry_labeled: bigint;
      career_stage_labeled: bigint;
      work_mode_known: bigint;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*) AS visible,
      COUNT(*) FILTER (
        WHERE "normalizedRoleCategory" IS NOT NULL
          AND "normalizedRoleCategory" <> 'OTHER_UNKNOWN'
          AND COALESCE("normalizedRoleCategoryConfidence", 0) >= ${ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD}
      ) AS role_labeled,
      COUNT(*) FILTER (
        WHERE ("normalizedIndustry" IS NOT NULL OR cardinality("normalizedIndustries") > 0)
          AND COALESCE("normalizedIndustryConfidence", 0) >= ${INDUSTRY_FILTER_CONFIDENCE_THRESHOLD}
      ) AS industry_labeled,
      COUNT(*) FILTER (
        WHERE "experienceLevelGroup" IS NOT NULL
          AND "experienceLevelGroup" <> 'UNKNOWN'
          AND COALESCE("normalizedCareerStageConfidence", 0) >= ${CAREER_STAGE_FILTER_CONFIDENCE_THRESHOLD}
      ) AS career_stage_labeled,
      COUNT(*) FILTER (WHERE "workMode" <> 'UNKNOWN') AS work_mode_known
    FROM "JobFeedIndex"
    WHERE status = 'LIVE'
  `);
  return row;
}

async function zombieSources() {
  const [row] = await prisma.$queryRaw<
    Array<{ f10_plus: bigint; f100_plus: bigint; quarantined: bigint }>
  >(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE "consecutiveFailures" >= 10) AS f10_plus,
      COUNT(*) FILTER (WHERE "consecutiveFailures" >= 100) AS f100_plus,
      COUNT(*) FILTER (WHERE "pollState" = 'QUARANTINED') AS quarantined
    FROM "CompanySource"
  `);
  return row;
}

function toNumber(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

async function main() {
  const asJson = process.argv.includes("--json");

  const [
    canonical,
    feed,
    flow,
    evidence,
    hiddenLive,
    coverage,
    atRisk,
    expiry,
    backlog,
    zombies,
    labels,
  ] = await Promise.all([
    canonicalByStatus(),
    feedByStatus(),
    weeklyFlow(8),
    liveEvidenceBuckets(),
    hiddenButLive(),
    pollCoverage(),
    jobsAtRisk(),
    expiryAttribution(),
    queueBacklog(),
    zombieSources(),
    labelCoverage(),
  ]);

  const liveTotal = toNumber(evidence?.live_total);
  const staleOver14 = toNumber(evidence?.stale_over_14d);
  const critical = toNumber(evidence?.critical_11_14d);
  const pollable = toNumber(coverage?.pollable);
  const polled7d = toNumber(coverage?.polled_7d);
  const expired14 = toNumber(expiry?.expired_14d);
  const starved = toNumber(expiry?.evidence_starved);

  const recentFlow = flow.slice(-4).map((row) => ({
    week: row.week.toISOString().slice(0, 10),
    added: toNumber(row.added),
    expired: toNumber(row.expired),
    removed: toNumber(row.removed),
    net: toNumber(row.added) - toNumber(row.expired) - toNumber(row.removed),
  }));

  const warnings: string[] = [];
  if (liveTotal > 0 && staleOver14 / liveTotal > 0.15) {
    warnings.push(
      `${formatPercent(staleOver14, liveTotal)} of LIVE jobs already have >${EVIDENCE_WINDOW_DAYS}d-stale source evidence — retention polling is not keeping up.`
    );
  }
  if (liveTotal > 0 && critical / liveTotal > 0.05) {
    warnings.push(
      `${formatPercent(critical, liveTotal)} of LIVE jobs are 11-${EVIDENCE_WINDOW_DAYS}d stale (about to cross the visibility cliff).`
    );
  }
  if (pollable > 0 && polled7d / pollable < 0.5) {
    warnings.push(
      `Only ${formatPercent(polled7d, pollable)} of pollable sources had a successful poll in 7d.`
    );
  }
  if (expired14 > 0 && starved / expired14 > 0.5) {
    warnings.push(
      `${formatPercent(starved, expired14)} of expiries in the last 14d were evidence-starved (we stopped looking), not confirmed closures.`
    );
  }
  const lastNet = recentFlow[recentFlow.length - 1]?.net ?? 0;
  if (lastNet < 0) {
    warnings.push(`Net supply is negative this week (${lastNet}).`);
  }

  // Growth-target trajectory: average net over the last completed weeks
  // projects whether the pool is converging on the target at all.
  const visibleLive = toNumber(feed.LIVE ?? 0);
  const targetGap = SUPPLY_TARGET_LIVE_JOBS - visibleLive;
  const completedWeeks = recentFlow.slice(0, -1);
  const avgNetPerWeek =
    completedWeeks.length > 0
      ? Math.round(
          completedWeeks.reduce((sum, row) => sum + row.net, 0) /
            completedWeeks.length
        )
      : 0;
  const weeksToTarget =
    targetGap > 0 && avgNetPerWeek > 0
      ? Math.ceil(targetGap / avgNetPerWeek)
      : null;
  if (targetGap > 0 && avgNetPerWeek <= 0) {
    warnings.push(
      `Pool is ${targetGap} jobs below the ${SUPPLY_TARGET_LIVE_JOBS} target and NOT converging (avg net ${avgNetPerWeek}/wk).`
    );
  }

  // Filterability: unlabeled jobs are invisible to filtered searches.
  const visibleForLabels = toNumber(labels?.visible);
  const roleLabeled = toNumber(labels?.role_labeled);
  const industryLabeled = toNumber(labels?.industry_labeled);
  const careerStageLabeled = toNumber(labels?.career_stage_labeled);
  if (visibleForLabels > 0 && roleLabeled / visibleForLabels < 0.7) {
    warnings.push(
      `Only ${formatPercent(roleLabeled, visibleForLabels)} of visible jobs have a filter-grade role-category label.`
    );
  }
  if (visibleForLabels > 0 && industryLabeled / visibleForLabels < 0.6) {
    warnings.push(
      `Only ${formatPercent(industryLabeled, visibleForLabels)} of visible jobs have a filter-grade industry label.`
    );
  }

  const report: Report = {
    generatedAt: new Date().toISOString(),
    canonicalByStatus: canonical,
    feedByStatus: feed,
    weeklyFlow: recentFlow,
    liveEvidence: {
      liveTotal,
      fresh0to7d: toNumber(evidence?.fresh_0_7d),
      warn7to11d: toNumber(evidence?.warn_7_11d),
      critical11to14d: critical,
      staleOver14d: staleOver14,
      failsBothWindows: toNumber(evidence?.fails_both_windows),
      hiddenButLive: hiddenLive,
    },
    pollCoverage: {
      pollable,
      polled24h: toNumber(coverage?.polled_24h),
      polled3d: toNumber(coverage?.polled_3d),
      polled7d,
      polled14d: toNumber(coverage?.polled_14d),
      neverPolled: toNumber(coverage?.never_polled),
    },
    jobsAtRisk: {
      staleSources: toNumber(atRisk?.sources),
      retainedLiveJobs: toNumber(atRisk?.retained_live_jobs),
    },
    expiryAttribution: {
      expired14d: expired14,
      evidenceStarved: starved,
      hadDeadSignal: toNumber(expiry?.had_dead_signal),
      hadPassedDeadline: toNumber(expiry?.had_passed_deadline),
    },
    queueBacklog: backlog.map((row) => ({
      kind: row.kind,
      status: row.status,
      count: toNumber(row.count),
      oldestDue: row.oldest_due?.toISOString() ?? null,
    })),
    zombieSources: {
      failures10plus: toNumber(zombies?.f10_plus),
      failures100plus: toNumber(zombies?.f100_plus),
      quarantined: toNumber(zombies?.quarantined),
    },
    growthTarget: {
      target: SUPPLY_TARGET_LIVE_JOBS,
      visibleLive,
      gap: targetGap,
      avgNetPerWeek,
      weeksToTarget,
    },
    labelCoverage: {
      visible: visibleForLabels,
      roleCategoryLabeled: roleLabeled,
      industryLabeled,
      careerStageLabeled,
      workModeKnown: toNumber(labels?.work_mode_known),
    },
    warnings,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Supply health @ ${report.generatedAt}`);
  console.log("");
  console.log("Canonical by status:", canonical);
  console.log("Feed index by status:", feed);
  console.log("");
  console.log("Weekly flow (added / expired / removed / net):");
  for (const row of recentFlow) {
    console.log(
      `  ${row.week}  +${row.added}  -${row.expired}e  -${row.removed}r  net ${row.net}`
    );
  }
  console.log("");
  console.log(
    `LIVE evidence age: total ${liveTotal} | fresh<7d ${toNumber(evidence?.fresh_0_7d)} | 7-11d ${toNumber(evidence?.warn_7_11d)} | 11-14d ${critical} | >14d ${staleOver14} (${formatPercent(staleOver14, liveTotal)}) | fails both windows ${toNumber(evidence?.fails_both_windows)} | hidden-but-LIVE ${hiddenLive}`
  );
  console.log(
    `Poll coverage: pollable ${pollable} | 24h ${toNumber(coverage?.polled_24h)} | 3d ${toNumber(coverage?.polled_3d)} | 7d ${polled7d} (${formatPercent(polled7d, pollable)}) | 14d ${toNumber(coverage?.polled_14d)} | never ${toNumber(coverage?.never_polled)}`
  );
  console.log(
    `Jobs at risk: ${toNumber(atRisk?.retained_live_jobs)} live jobs on ${toNumber(atRisk?.sources)} sources not polled in 7d+`
  );
  console.log(
    `Expiry attribution (14d): ${expired14} expired | ${starved} evidence-starved (${formatPercent(starved, expired14)}) | ${toNumber(expiry?.had_dead_signal)} dead-signal | ${toNumber(expiry?.had_passed_deadline)} passed-deadline`
  );
  console.log(
    `Zombies: ${toNumber(zombies?.f10_plus)} sources with 10+ consecutive failures (${toNumber(zombies?.f100_plus)} with 100+), ${toNumber(zombies?.quarantined)} quarantined`
  );
  console.log("");
  console.log(
    `Growth target: ${visibleLive} / ${SUPPLY_TARGET_LIVE_JOBS} visible (gap ${targetGap}) | avg net ${avgNetPerWeek}/wk | ${
      weeksToTarget !== null
        ? `~${weeksToTarget} weeks to target at current pace`
        : targetGap <= 0
          ? "target reached"
          : "not converging at current pace"
    }`
  );
  console.log(
    `Label coverage (visible feed): role ${formatPercent(roleLabeled, visibleForLabels)} | industry ${formatPercent(industryLabeled, visibleForLabels)} | career stage ${formatPercent(careerStageLabeled, visibleForLabels)} | work mode ${formatPercent(toNumber(labels?.work_mode_known), visibleForLabels)}`
  );
  console.log("");
  console.log("Queue backlog:");
  for (const row of report.queueBacklog as Array<Record<string, unknown>>) {
    console.log(
      `  ${row.kind} ${row.status}: ${row.count} (oldest due ${row.oldestDue ?? "-"})`
    );
  }
  console.log("");
  if (warnings.length === 0) {
    console.log("No supply warnings.");
  } else {
    console.log("WARNINGS:");
    for (const warning of warnings) console.log(`  ! ${warning}`);
  }
}

main()
  .catch((error) => {
    console.error("[supply-health] fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
