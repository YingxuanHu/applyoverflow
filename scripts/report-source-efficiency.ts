import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";

type Args = {
  days: number;
  limit: number;
  output: string;
};

type SourceEfficiencyRow = {
  id: string;
  companyName: string;
  sourceName: string;
  connectorName: string;
  sourceType: string | null;
  status: string;
  validationState: string;
  pollState: string;
  cooldownUntil: Date | null;
  lastSuccessfulPollAt: Date | null;
  lastFailureAt: Date | null;
  lastHttpStatus: number | null;
  pollAttemptCount: number;
  pollSuccessCount: number;
  jobsFetchedCount: number;
  jobsAcceptedCount: number;
  jobsDedupedCount: number;
  jobsCreatedCount: number;
  retainedLiveJobCount: number;
  runCount: bigint | number | null;
  failedRunCount: bigint | number | null;
  fetchedCount: bigint | number | null;
  acceptedCount: bigint | number | null;
  canonicalCreatedCount: bigint | number | null;
  dedupedCount: bigint | number | null;
  runtimeMs: bigint | number | null;
};

type ReportRow = {
  companyName: string;
  connectorName: string;
  sourceType: string;
  sourceName: string;
  status: string;
  pollState: string;
  cooldownUntil: string;
  retainedLiveJobCount: number;
  allTimeJobsCreated: number;
  recentRuns: number;
  recentFailedRuns: number;
  recentFetched: number;
  recentAccepted: number;
  recentCreated: number;
  recentDeduped: number;
  runtimeMinutes: number;
  createdPerMinute: number;
  acceptedPerMinute: number;
  duplicateRate: number;
  failureRate: number;
  allTimePollSuccessRate: number;
  lastSuccessfulPollAt: string;
  lastFailureAt: string;
  lastHttpStatus: string;
  recommendation: string;
};

function parseArgs(argv: string[]): Args {
  let days = 7;
  let limit = 250;
  let output = path.resolve(
    process.cwd(),
    `data/exports/source-efficiency-${new Date().toISOString().slice(0, 10)}.csv`
  );

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if ((arg === "--days" || arg === "-d") && next) {
      days = parsePositiveInt(next, days);
      index += 1;
      continue;
    }

    if ((arg === "--limit" || arg === "-l") && next) {
      limit = parsePositiveInt(next, limit);
      index += 1;
      continue;
    }

    if ((arg === "--output" || arg === "-o") && next) {
      output = path.resolve(process.cwd(), next);
      index += 1;
    }
  }

  return { days, limit, output };
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toInt(value: bigint | number | null | undefined) {
  if (typeof value === "bigint") return Number(value);
  return value ?? 0;
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function formatDate(value: Date | null) {
  return value ? value.toISOString() : "";
}

function classifyRecommendation(input: {
  connectorName: string;
  sourceType: string;
  retainedLiveJobCount: number;
  recentRuns: number;
  recentCreated: number;
  recentAccepted: number;
  runtimeMinutes: number;
  createdPerMinute: number;
  duplicateRate: number;
  failureRate: number;
}) {
  if (input.recentRuns === 0) {
    return "NO_RECENT_RUNS";
  }

  if (input.createdPerMinute >= 0.1 && input.recentCreated >= 5 && input.failureRate <= 0.4) {
    return "PROMOTE";
  }

  if (
    input.runtimeMinutes >= 3 &&
    input.recentCreated <= 1 &&
    (input.failureRate >= 0.6 || input.duplicateRate >= 0.75 || input.recentAccepted === 0)
  ) {
    return "COOLDOWN_SLOW_LOW_YIELD";
  }

  if (
    input.connectorName === "company-site" &&
    input.sourceType === "COMPANY_HTML" &&
    input.recentCreated <= 1
  ) {
    return "COOLDOWN_HTML_FALLBACK";
  }

  if (input.recentAccepted >= 50 && input.recentCreated <= 1) {
    return "REFRESH_HEAVY_DUPLICATE";
  }

  if (input.retainedLiveJobCount > 0 && input.recentCreated === 0) {
    return "KEEP_BUT_SLOW_REFRESH";
  }

  return "KEEP";
}

function csvEscape(value: string | number) {
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cutoff = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<SourceEfficiencyRow[]>`
    WITH recent_runs AS (
      SELECT
        "sourceName",
        COUNT(*) AS "runCount",
        COUNT(*) FILTER (WHERE "status"::text = 'FAILED') AS "failedRunCount",
        COALESCE(SUM("fetchedCount"), 0) AS "fetchedCount",
        COALESCE(SUM("acceptedCount"), 0) AS "acceptedCount",
        COALESCE(SUM("canonicalCreatedCount"), 0) AS "canonicalCreatedCount",
        COALESCE(SUM("dedupedCount"), 0) AS "dedupedCount",
        COALESCE(SUM(
          CASE
            WHEN "endedAt" IS NULL THEN 0
            ELSE EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) * 1000
          END
        ), 0) AS "runtimeMs"
      FROM "IngestionRun"
      WHERE "startedAt" >= ${cutoff}
      GROUP BY 1
    )
    SELECT
      cs."id",
      c."name" AS "companyName",
      cs."sourceName",
      cs."connectorName",
      cs."sourceType",
      cs."status"::text AS "status",
      cs."validationState"::text AS "validationState",
      cs."pollState"::text AS "pollState",
      cs."cooldownUntil",
      cs."lastSuccessfulPollAt",
      cs."lastFailureAt",
      cs."lastHttpStatus",
      cs."pollAttemptCount",
      cs."pollSuccessCount",
      cs."jobsFetchedCount",
      cs."jobsAcceptedCount",
      cs."jobsDedupedCount",
      cs."jobsCreatedCount",
      cs."retainedLiveJobCount",
      rr."runCount",
      rr."failedRunCount",
      rr."fetchedCount",
      rr."acceptedCount",
      rr."canonicalCreatedCount",
      rr."dedupedCount",
      rr."runtimeMs"
    FROM "CompanySource" cs
    INNER JOIN "Company" c
      ON c."id" = cs."companyId"
    LEFT JOIN recent_runs rr
      ON rr."sourceName" = cs."sourceName"
    WHERE
      cs."validationState"::text = 'VALIDATED'
      AND cs."status"::text IN ('PROVISIONED', 'ACTIVE', 'DEGRADED')
    ORDER BY
      COALESCE(rr."canonicalCreatedCount", 0) ASC,
      COALESCE(rr."runtimeMs", 0) DESC,
      cs."retainedLiveJobCount" DESC
  `;

  const reportRows = rows
    .map((row): ReportRow => {
      const recentRuns = toInt(row.runCount);
      const recentFailedRuns = toInt(row.failedRunCount);
      const recentFetched = toInt(row.fetchedCount);
      const recentAccepted = toInt(row.acceptedCount);
      const recentCreated = toInt(row.canonicalCreatedCount);
      const recentDeduped = toInt(row.dedupedCount);
      const runtimeMinutes = toInt(row.runtimeMs) / 60_000;
      const createdPerMinute = ratio(recentCreated, runtimeMinutes);
      const acceptedPerMinute = ratio(recentAccepted, runtimeMinutes);
      const duplicateRate = ratio(recentDeduped, Math.max(recentAccepted, 1));
      const failureRate = ratio(recentFailedRuns, recentRuns);
      const allTimePollSuccessRate = ratio(row.pollSuccessCount, row.pollAttemptCount);
      const sourceType = row.sourceType ?? "";

      return {
        companyName: row.companyName,
        connectorName: row.connectorName,
        sourceType,
        sourceName: row.sourceName,
        status: row.status,
        pollState: row.pollState,
        cooldownUntil: formatDate(row.cooldownUntil),
        retainedLiveJobCount: row.retainedLiveJobCount,
        allTimeJobsCreated: row.jobsCreatedCount,
        recentRuns,
        recentFailedRuns,
        recentFetched,
        recentAccepted,
        recentCreated,
        recentDeduped,
        runtimeMinutes: round(runtimeMinutes),
        createdPerMinute: round(createdPerMinute),
        acceptedPerMinute: round(acceptedPerMinute),
        duplicateRate: round(duplicateRate),
        failureRate: round(failureRate),
        allTimePollSuccessRate: round(allTimePollSuccessRate),
        lastSuccessfulPollAt: formatDate(row.lastSuccessfulPollAt),
        lastFailureAt: formatDate(row.lastFailureAt),
        lastHttpStatus: row.lastHttpStatus == null ? "" : String(row.lastHttpStatus),
        recommendation: classifyRecommendation({
          connectorName: row.connectorName,
          sourceType,
          retainedLiveJobCount: row.retainedLiveJobCount,
          recentRuns,
          recentCreated,
          recentAccepted,
          runtimeMinutes,
          createdPerMinute,
          duplicateRate,
          failureRate,
        }),
      };
    })
    .sort((left, right) => {
      const recommendationRank = new Map([
        ["COOLDOWN_SLOW_LOW_YIELD", 0],
        ["COOLDOWN_HTML_FALLBACK", 1],
        ["REFRESH_HEAVY_DUPLICATE", 2],
        ["KEEP_BUT_SLOW_REFRESH", 3],
        ["PROMOTE", 4],
        ["KEEP", 5],
        ["NO_RECENT_RUNS", 6],
      ]);

      const leftRank = recommendationRank.get(left.recommendation) ?? 99;
      const rightRank = recommendationRank.get(right.recommendation) ?? 99;
      if (leftRank !== rightRank) return leftRank - rightRank;
      if (right.runtimeMinutes !== left.runtimeMinutes) {
        return right.runtimeMinutes - left.runtimeMinutes;
      }
      return right.retainedLiveJobCount - left.retainedLiveJobCount;
    })
    .slice(0, args.limit);

  const headers = Object.keys(reportRows[0] ?? {
    companyName: "",
    connectorName: "",
    sourceType: "",
    sourceName: "",
    status: "",
    pollState: "",
    cooldownUntil: "",
    retainedLiveJobCount: "",
    allTimeJobsCreated: "",
    recentRuns: "",
    recentFailedRuns: "",
    recentFetched: "",
    recentAccepted: "",
    recentCreated: "",
    recentDeduped: "",
    runtimeMinutes: "",
    createdPerMinute: "",
    acceptedPerMinute: "",
    duplicateRate: "",
    failureRate: "",
    allTimePollSuccessRate: "",
    lastSuccessfulPollAt: "",
    lastFailureAt: "",
    lastHttpStatus: "",
    recommendation: "",
  });
  const csvLines = [
    headers.join(","),
    ...reportRows.map((row) =>
      headers.map((header) => csvEscape(row[header as keyof ReportRow])).join(",")
    ),
  ];

  await mkdir(path.dirname(args.output), { recursive: true });
  await writeFile(args.output, `${csvLines.join("\n")}\n`, "utf8");

  const recommendationCounts = reportRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.recommendation] = (acc[row.recommendation] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        output: args.output,
        days: args.days,
        rows: reportRows.length,
        recommendationCounts,
        topRows: reportRows.slice(0, 10),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
