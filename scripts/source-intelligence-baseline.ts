import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

process.env.DATABASE_PROCESS_ROLE ??= "expansion_pipeline";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";

type Args = {
  days: number;
  top: number;
  outputDir: string;
  label: string;
};

type CountRow = {
  label: string | null;
  count: bigint | number;
};

type SourceTaskRow = {
  kind: string;
  status: string;
  count: bigint | number;
  readyCount: bigint | number;
  staleRunningCount: bigint | number;
};

type IngestionFamilyRow = {
  sourceFamily: string | null;
  runCount: bigint | number;
  successCount: bigint | number;
  failedCount: bigint | number;
  fetchedCount: bigint | number;
  acceptedCount: bigint | number;
  canonicalCreatedCount: bigint | number;
  dedupedCount: bigint | number;
  runtimeMs: bigint | number;
};

type IngestionSourceRow = IngestionFamilyRow & {
  sourceName: string;
};

type RepairCandidateRow = {
  companyName: string;
  domain: string | null;
  careersUrl: string | null;
  sourceName: string;
  connectorName: string;
  boardUrl: string;
  status: string;
  validationState: string;
  pollState: string;
  extractionRoute: string;
  sourceQualityScore: number;
  yieldScore: number;
  priorityScore: number;
  retainedLiveJobCount: number;
  lastSuccessfulPollAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  lastHttpStatus: number | null;
};

type CompanyCoverageGapRow = {
  companyName: string;
  domain: string | null;
  careersUrl: string | null;
  sourceCount: bigint | number;
  activeSourceCount: bigint | number;
  validatedSourceCount: bigint | number;
  feedLiveJobCount: bigint | number;
  canonicalVisibleJobCount: bigint | number;
  maxSourceQualityScore: number | null;
  maxPriorityScore: number | null;
};

type SourceCandidateRow = {
  candidateType: string;
  status: string;
  atsPlatform: string | null;
  count: bigint | number;
  avgConfidence: number | null;
  avgCoverageGapScore: number | null;
  avgPotentialYieldScore: number | null;
};

type TopCandidateRow = {
  companyName: string | null;
  companyNameHint: string | null;
  candidateType: string;
  status: string;
  candidateUrl: string;
  rootDomain: string | null;
  atsPlatform: string | null;
  confidence: number;
  coverageGapScore: number;
  potentialYieldScore: number;
  noveltyScore: number;
  sourceQualityScore: number;
  failureCount: number;
};

type SourceIntelligenceMarkdownReport = {
  generatedAt: string;
  windowDays: number;
  summary: Record<string, number>;
  jobs: {
    canonicalByStatus: Record<string, number>;
    feedIndexByStatus: Record<string, number>;
    applyUrlValidationStatus: Record<string, number>;
  };
  sourceRegistry: {
    activeValidatedPollableCount: number;
    byStatus: Record<string, number>;
    byValidationState: Record<string, number>;
    byPollState: Record<string, number>;
    byExtractionRoute: Record<string, number>;
  };
  ingestion: {
    topSources: Array<{
      sourceName: string;
      sourceFamily: string;
      canonicalCreatedCount: number;
      acceptedCount: number;
      noveltyRate: number;
      duplicateRate: number;
      runCount: number;
    }>;
    windowTotals: {
      canonicalCreatedCount: number;
      acceptedCount: number;
      noveltyRate: number;
      duplicateRate: number;
    };
  };
  queues: {
    pendingCount: number;
    runningCount: number;
    byKindStatus: Array<{
      kind: string;
      status: string;
      count: number;
      readyCount: number;
      staleRunningCount: number;
    }>;
  };
  repairCandidates: Array<{
    companyName: string;
    connectorName: string;
    status: string;
    validationState: string;
    pollState: string;
    retainedLiveJobCount: number;
    sourceQualityScore: number;
    yieldScore: number;
    consecutiveFailures: number;
  }>;
  companyCoverageGaps: Array<{
    companyName: string;
    sourceCount: number;
    activeSourceCount: number;
    validatedSourceCount: number;
    feedLiveJobCount: number;
    canonicalVisibleJobCount: number;
    maxSourceQualityScore: number;
  }>;
};

const VISIBLE_STATUSES = ["LIVE", "AGING", "STALE"] as const;

function parseArgs(argv: string[]): Args {
  const today = new Date().toISOString().slice(0, 10);
  let days = 7;
  let top = 25;
  let outputDir = path.resolve(process.cwd(), "data/discovery");
  let label = today;

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];
    const equalsIndex = rawArg.indexOf("=");
    const arg = equalsIndex >= 0 ? rawArg.slice(0, equalsIndex) : rawArg;
    const inlineValue = equalsIndex >= 0 ? rawArg.slice(equalsIndex + 1) : undefined;
    const next = argv[index + 1];

    if (arg === "--days" || arg === "-d") {
      const value = inlineValue ?? next;
      if (!value) continue;
      days = parsePositiveInt(value, days);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--top" || arg === "--limit") {
      const value = inlineValue ?? next;
      if (!value) continue;
      top = parsePositiveInt(value, top);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--output-dir") {
      const value = inlineValue ?? next;
      if (!value) continue;
      outputDir = path.resolve(process.cwd(), value);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--label") {
      const value = inlineValue ?? next;
      if (!value) continue;
      label = value.replace(/[^a-zA-Z0-9._-]/g, "-");
      if (!inlineValue) index += 1;
    }
  }

  return { days, top, outputDir, label };
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
  return round(numerator / denominator, 4);
}

function countRowsToRecord(rows: CountRow[]) {
  return Object.fromEntries(
    rows.map((row) => [row.label ?? "UNKNOWN", toInt(row.count)])
  );
}

function sourceFamily(sourceName: string | null | undefined) {
  return (sourceName?.split(":")[0] ?? "unknown").trim().toLowerCase() || "unknown";
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : value;
}

function redactDatabaseUrl(raw: string | undefined) {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return {
      protocol: parsed.protocol,
      host: parsed.hostname,
      port: parsed.port || null,
      database: parsed.pathname.replace(/^\//, "") || null,
      sslmode: parsed.searchParams.get("sslmode"),
    };
  } catch {
    return { host: "unparseable" };
  }
}

function buildRunMetrics(row: IngestionFamilyRow) {
  const runCount = toInt(row.runCount);
  const successCount = toInt(row.successCount);
  const failedCount = toInt(row.failedCount);
  const fetchedCount = toInt(row.fetchedCount);
  const acceptedCount = toInt(row.acceptedCount);
  const canonicalCreatedCount = toInt(row.canonicalCreatedCount);
  const dedupedCount = toInt(row.dedupedCount);
  const runtimeMinutes = toInt(row.runtimeMs) / 60_000;

  return {
    runCount,
    successCount,
    failedCount,
    fetchedCount,
    acceptedCount,
    canonicalCreatedCount,
    dedupedCount,
    runtimeMinutes: round(runtimeMinutes, 2),
    failureRate: ratio(failedCount, runCount),
    acceptanceRate: ratio(acceptedCount, fetchedCount),
    noveltyRate: ratio(canonicalCreatedCount, acceptedCount),
    duplicateRate: ratio(dedupedCount, acceptedCount),
    createdPerMinute: round(canonicalCreatedCount / Math.max(runtimeMinutes, 1 / 60), 4),
  };
}

function table(rows: Array<Record<string, string | number | null | undefined>>, columns: string[]) {
  if (rows.length === 0) return "_None._";
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) =>
    `| ${columns
      .map((column) => String(row[column] ?? "").replace(/\|/g, "\\|"))
      .join(" | ")} |`
  );
  return [header, divider, ...body].join("\n");
}

function buildMarkdownReport(report: SourceIntelligenceMarkdownReport) {
  const summary = report.summary;
  const sourceRegistry = report.sourceRegistry;
  const ingestion = report.ingestion;
  const queues = report.queues;

  const topSourceRows = ingestion.topSources.map((row) => ({
    source: row.sourceName,
    family: row.sourceFamily,
    created: row.canonicalCreatedCount,
    accepted: row.acceptedCount,
    novelty: row.noveltyRate,
    duplicate: row.duplicateRate,
    runs: row.runCount,
  }));

  const repairRows = report.repairCandidates.slice(0, 12).map((row) => ({
    company: row.companyName,
    connector: row.connectorName,
    state: `${row.status}/${row.validationState}/${row.pollState}`,
    live: row.retainedLiveJobCount,
    quality: row.sourceQualityScore,
    yield: row.yieldScore,
    failures: row.consecutiveFailures,
  }));

  const gapRows = report.companyCoverageGaps.slice(0, 12).map((row) => ({
    company: row.companyName,
    sources: row.sourceCount,
    active: row.activeSourceCount,
    validated: row.validatedSourceCount,
    feedLive: row.feedLiveJobCount,
    canonicalVisible: row.canonicalVisibleJobCount,
    quality: row.maxSourceQualityScore,
  }));

  return `# Source Intelligence Baseline

Generated at: ${report.generatedAt}

Window: last ${report.windowDays} days

## Summary

- Feed-index live jobs: ${summary.feedIndexLiveJobCount}
- Strict canonical-visible jobs: ${summary.strictCanonicalVisibleJobCount}
- Broader canonical visible-status jobs: ${summary.canonicalVisibleStatusJobCount}
- Canonical jobs total: ${summary.canonicalTotalJobCount}
- Companies: ${summary.companyCount}
- Company sources: ${summary.companySourceCount}
- Active validated pollable sources: ${sourceRegistry.activeValidatedPollableCount}
- Source candidates: ${summary.sourceCandidateCount}
- ATS tenants: ${summary.atsTenantCount}
- Pending source tasks: ${queues.pendingCount}
- Running source tasks: ${queues.runningCount}
- Ingestion created in window: ${ingestion.windowTotals.canonicalCreatedCount}
- Ingestion accepted in window: ${ingestion.windowTotals.acceptedCount}
- Ingestion novelty rate: ${ingestion.windowTotals.noveltyRate}
- Ingestion duplicate rate: ${ingestion.windowTotals.duplicateRate}

## Source State

- Status: ${JSON.stringify(sourceRegistry.byStatus)}
- Validation: ${JSON.stringify(sourceRegistry.byValidationState)}
- Poll: ${JSON.stringify(sourceRegistry.byPollState)}
- Extraction route: ${JSON.stringify(sourceRegistry.byExtractionRoute)}

## Job State

- Canonical by status: ${JSON.stringify(report.jobs.canonicalByStatus)}
- Feed index by status: ${JSON.stringify(report.jobs.feedIndexByStatus)}
- Apply URL validation: ${JSON.stringify(report.jobs.applyUrlValidationStatus)}

## Top Sources By Net-New Created Jobs

${table(topSourceRows, ["source", "family", "created", "accepted", "novelty", "duplicate", "runs"])}

## Highest Priority Repair Candidates

${table(repairRows, ["company", "connector", "state", "live", "quality", "yield", "failures"])}

## Company Coverage Gaps

${table(gapRows, ["company", "sources", "active", "validated", "feedLive", "canonicalVisible", "quality"])}

## Queue Health

${table(
    queues.byKindStatus.map((row) => ({
      kind: row.kind,
      status: row.status,
      count: row.count,
      ready: row.readyCount,
      staleRunning: row.staleRunningCount,
    })),
    ["kind", "status", "count", "ready", "staleRunning"]
  )}

## Phase 1 Use

Use this report as the pre-change benchmark. After source repair, ATS frontier expansion, or scheduler changes, rerun:

\`\`\`bash
npm run source:intelligence-baseline -- --label=after-phase-1
\`\`\`
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { prisma } = await import("../src/lib/db");
  const now = new Date();
  const cutoff = new Date(now.getTime() - args.days * 86_400_000);

  const [
    canonicalTotalJobCount,
    canonicalVisibleStatusJobCount,
    strictCanonicalVisibleJobCount,
    feedIndexLiveJobCount,
    companyCount,
    companySourceCount,
    sourceCandidateCount,
    atsTenantCount,
    canonicalByStatusRows,
    feedIndexByStatusRows,
    applyUrlValidationRows,
    sourceStatusRows,
    sourceValidationRows,
    sourcePollRows,
    sourceExtractionRows,
    sourceConnectorRows,
    sourceTypeRows,
    activeValidatedPollableCount,
    sourceTaskRows,
    candidateRows,
    atsTenantRows,
    staleSourceCounts,
    recentJobRows,
  ] = await Promise.all([
    prisma.jobCanonical.count(),
    prisma.jobCanonical.count({ where: { status: { in: [...VISIBLE_STATUSES] } } }),
    prisma.jobCanonical.count({
      where: {
        status: "LIVE",
        availabilityScore: { gte: 60 },
        deadSignalAt: null,
        OR: [{ deadline: null }, { deadline: { gte: now } }],
        AND: [
          {
            OR: [
              { applyUrlValidationStatus: null },
              {
                applyUrlValidationStatus: {
                  notIn: [
                    "EXPIRED",
                    "BROKEN_APPLY_LINK",
                    "GENERIC_APPLY_PAGE",
                    "SOURCE_STALE",
                    "HIDDEN_LOW_QUALITY",
                  ],
                },
              },
            ],
          },
          {
            OR: [
              { lastSourceSeenAt: { gte: new Date(now.getTime() - 14 * 86_400_000) } },
              { lastConfirmedAliveAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
            ],
          },
        ],
      },
    }),
    prisma.jobFeedIndex.count({ where: { status: "LIVE" } }),
    prisma.company.count(),
    prisma.companySource.count(),
    prisma.sourceCandidate.count(),
    prisma.aTSTenant.count(),
    prisma.$queryRaw<CountRow[]>`
      SELECT status::text AS label, COUNT(*) AS count
      FROM "JobCanonical"
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT status::text AS label, COUNT(*) AS count
      FROM "JobFeedIndex"
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COALESCE(NULLIF("applyUrlValidationStatus", ''), 'UNVALIDATED') AS label, COUNT(*) AS count
      FROM "JobCanonical"
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT status::text AS label, COUNT(*) AS count
      FROM "CompanySource"
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT "validationState"::text AS label, COUNT(*) AS count
      FROM "CompanySource"
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT "pollState"::text AS label, COUNT(*) AS count
      FROM "CompanySource"
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT "extractionRoute"::text AS label, COUNT(*) AS count
      FROM "CompanySource"
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT "connectorName" AS label, COUNT(*) AS count
      FROM "CompanySource"
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 40
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COALESCE(NULLIF("sourceType", ''), 'UNKNOWN') AS label, COUNT(*) AS count
      FROM "CompanySource"
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 40
    `,
    prisma.companySource.count({
      where: {
        status: { in: ["PROVISIONED", "ACTIVE", "DEGRADED"] },
        validationState: "VALIDATED",
        pollState: { in: ["READY", "ACTIVE"] },
      },
    }),
    prisma.$queryRaw<SourceTaskRow[]>`
      SELECT
        kind::text AS kind,
        status::text AS status,
        COUNT(*) AS count,
        COUNT(*) FILTER (
          WHERE status = 'PENDING' AND "notBeforeAt" <= ${now}
        ) AS "readyCount",
        COUNT(*) FILTER (
          WHERE status = 'RUNNING'
            AND "startedAt" < (${now}::timestamp - CASE kind
              WHEN 'CONNECTOR_POLL'::"SourceTaskKind" THEN INTERVAL '20 minutes'
              WHEN 'SOURCE_VALIDATION'::"SourceTaskKind" THEN INTERVAL '60 minutes'
              WHEN 'URL_HEALTH'::"SourceTaskKind" THEN INTERVAL '45 minutes'
              ELSE INTERVAL '180 minutes'
            END)
        ) AS "staleRunningCount"
      FROM "SourceTask"
      GROUP BY 1, 2
      ORDER BY 1, 2
    `,
    prisma.$queryRaw<SourceCandidateRow[]>`
      SELECT
        "candidateType"::text AS "candidateType",
        status::text AS status,
        "atsPlatform"::text AS "atsPlatform",
        COUNT(*) AS count,
        AVG(confidence) AS "avgConfidence",
        AVG("coverageGapScore") AS "avgCoverageGapScore",
        AVG("potentialYieldScore") AS "avgPotentialYieldScore"
      FROM "SourceCandidate"
      GROUP BY 1, 2, 3
      ORDER BY 4 DESC
      LIMIT 80
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT CONCAT(platform::text, '/', status::text) AS label, COUNT(*) AS count
      FROM "ATSTenant"
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 80
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT label, count
      FROM (
        SELECT 'never_polled' AS label, COUNT(*) AS count
        FROM "CompanySource"
        WHERE "lastSuccessfulPollAt" IS NULL
        UNION ALL
        SELECT 'not_polled_24h' AS label, COUNT(*) AS count
        FROM "CompanySource"
        WHERE "lastSuccessfulPollAt" IS NULL OR "lastSuccessfulPollAt" < ${new Date(now.getTime() - 86_400_000)}
        UNION ALL
        SELECT 'not_polled_7d' AS label, COUNT(*) AS count
        FROM "CompanySource"
        WHERE "lastSuccessfulPollAt" IS NULL OR "lastSuccessfulPollAt" < ${new Date(now.getTime() - 7 * 86_400_000)}
        UNION ALL
        SELECT 'zero_retained_live' AS label, COUNT(*) AS count
        FROM "CompanySource"
        WHERE "retainedLiveJobCount" = 0
        UNION ALL
        SELECT 'consecutive_failures' AS label, COUNT(*) AS count
        FROM "CompanySource"
        WHERE "consecutiveFailures" > 0
      ) counts
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT label, count
      FROM (
        SELECT 'first_seen_24h' AS label, COUNT(*) AS count
        FROM "JobCanonical"
        WHERE "firstSeenAt" >= ${new Date(now.getTime() - 86_400_000)}
        UNION ALL
        SELECT 'feed_live_first_seen_24h' AS label, COUNT(*) AS count
        FROM "JobFeedIndex"
        WHERE status = 'LIVE' AND "indexedAt" >= ${new Date(now.getTime() - 86_400_000)}
        UNION ALL
        SELECT 'expired_or_removed_24h' AS label, COUNT(*) AS count
        FROM "JobCanonical"
        WHERE "updatedAt" >= ${new Date(now.getTime() - 86_400_000)}
          AND status IN ('EXPIRED', 'REMOVED')
        UNION ALL
        SELECT 'first_seen_window' AS label, COUNT(*) AS count
        FROM "JobCanonical"
        WHERE "firstSeenAt" >= ${cutoff}
      ) counts
    `,
  ]);

  const familyRows = await prisma.$queryRaw<IngestionFamilyRow[]>`
    SELECT
      LOWER(split_part("sourceName", ':', 1)) AS "sourceFamily",
      COUNT(*) AS "runCount",
      COUNT(*) FILTER (WHERE status = 'SUCCESS') AS "successCount",
      COUNT(*) FILTER (WHERE status = 'FAILED') AS "failedCount",
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
    ORDER BY 7 DESC, 6 DESC
  `;

  const topSourceRows = await prisma.$queryRaw<IngestionSourceRow[]>`
    SELECT
      "sourceName",
      LOWER(split_part("sourceName", ':', 1)) AS "sourceFamily",
      COUNT(*) AS "runCount",
      COUNT(*) FILTER (WHERE status = 'SUCCESS') AS "successCount",
      COUNT(*) FILTER (WHERE status = 'FAILED') AS "failedCount",
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
    GROUP BY 1, 2
    ORDER BY 8 DESC, 7 DESC
    LIMIT ${args.top}
  `;

  const repairCandidates = await prisma.$queryRaw<RepairCandidateRow[]>`
    SELECT
      c.name AS "companyName",
      c.domain,
      c."careersUrl",
      cs."sourceName",
      cs."connectorName",
      cs."boardUrl",
      cs.status::text AS status,
      cs."validationState"::text AS "validationState",
      cs."pollState"::text AS "pollState",
      cs."extractionRoute"::text AS "extractionRoute",
      cs."sourceQualityScore",
      cs."yieldScore",
      cs."priorityScore",
      cs."retainedLiveJobCount",
      cs."lastSuccessfulPollAt",
      cs."lastFailureAt",
      cs."consecutiveFailures",
      cs."lastHttpStatus"
    FROM "CompanySource" cs
    JOIN "Company" c ON c.id = cs."companyId"
    WHERE
      cs.status <> 'DISABLED'
      AND (
        cs."validationState" IN ('SUSPECT', 'NEEDS_REDISCOVERY', 'BLOCKED')
        OR cs."pollState" IN ('BACKOFF', 'QUARANTINED')
        OR cs.status IN ('DEGRADED', 'REDISCOVER_REQUIRED')
        OR cs."consecutiveFailures" >= 2
        OR (
          cs."retainedLiveJobCount" = 0
          AND (cs."sourceQualityScore" >= 0.7 OR cs."priorityScore" >= 0.7)
        )
      )
    ORDER BY
      cs."priorityScore" DESC,
      cs."sourceQualityScore" DESC,
      cs."yieldScore" DESC,
      cs."retainedLiveJobCount" ASC
    LIMIT ${args.top}
  `;

  const companyCoverageGaps = await prisma.$queryRaw<CompanyCoverageGapRow[]>`
    SELECT
      c.name AS "companyName",
      c.domain,
      c."careersUrl",
      COUNT(DISTINCT cs.id) AS "sourceCount",
      COUNT(DISTINCT cs.id) FILTER (
        WHERE cs.status IN ('PROVISIONED', 'ACTIVE', 'DEGRADED')
      ) AS "activeSourceCount",
      COUNT(DISTINCT cs.id) FILTER (
        WHERE cs."validationState" = 'VALIDATED'
      ) AS "validatedSourceCount",
      COUNT(DISTINCT jfi."canonicalJobId") FILTER (
        WHERE jfi.status = 'LIVE'
      ) AS "feedLiveJobCount",
      COUNT(DISTINCT jc.id) FILTER (
        WHERE jc.status IN ('LIVE', 'AGING', 'STALE')
      ) AS "canonicalVisibleJobCount",
      MAX(cs."sourceQualityScore") AS "maxSourceQualityScore",
      MAX(cs."priorityScore") AS "maxPriorityScore"
    FROM "Company" c
    LEFT JOIN "CompanySource" cs ON cs."companyId" = c.id
    LEFT JOIN "JobCanonical" jc ON jc."companyId" = c.id
    LEFT JOIN "JobFeedIndex" jfi ON jfi."canonicalJobId" = jc.id
    GROUP BY c.id
    HAVING
      COUNT(DISTINCT cs.id) > 0
      AND COUNT(DISTINCT jfi."canonicalJobId") FILTER (WHERE jfi.status = 'LIVE') <= 2
    ORDER BY
      MAX(cs."priorityScore") DESC NULLS LAST,
      MAX(cs."sourceQualityScore") DESC NULLS LAST,
      COUNT(DISTINCT cs.id) DESC
    LIMIT ${args.top}
  `;

  const topCandidates = await prisma.$queryRaw<TopCandidateRow[]>`
    SELECT
      c.name AS "companyName",
      sc."companyNameHint",
      sc."candidateType"::text AS "candidateType",
      sc.status::text AS status,
      sc."candidateUrl",
      sc."rootDomain",
      sc."atsPlatform"::text AS "atsPlatform",
      sc.confidence,
      sc."coverageGapScore",
      sc."potentialYieldScore",
      sc."noveltyScore",
      sc."sourceQualityScore",
      sc."failureCount"
    FROM "SourceCandidate" sc
    LEFT JOIN "Company" c ON c.id = sc."companyId"
    WHERE sc.status IN ('NEW', 'VALIDATED', 'STALE')
    ORDER BY
      sc."coverageGapScore" DESC,
      sc."potentialYieldScore" DESC,
      sc.confidence DESC,
      sc."sourceQualityScore" DESC
    LIMIT ${args.top}
  `;

  const sourceFamilies = familyRows.map((row) => ({
    sourceFamily: row.sourceFamily ?? "unknown",
    ...buildRunMetrics(row),
  }));

  const topSources = topSourceRows.map((row) => ({
    sourceName: row.sourceName,
    sourceFamily: row.sourceFamily ?? sourceFamily(row.sourceName),
    ...buildRunMetrics(row),
  }));

  const windowTotals = sourceFamilies.reduce(
    (acc, row) => {
      acc.runCount += row.runCount;
      acc.successCount += row.successCount;
      acc.failedCount += row.failedCount;
      acc.fetchedCount += row.fetchedCount;
      acc.acceptedCount += row.acceptedCount;
      acc.canonicalCreatedCount += row.canonicalCreatedCount;
      acc.dedupedCount += row.dedupedCount;
      acc.runtimeMinutes += row.runtimeMinutes;
      return acc;
    },
    {
      runCount: 0,
      successCount: 0,
      failedCount: 0,
      fetchedCount: 0,
      acceptedCount: 0,
      canonicalCreatedCount: 0,
      dedupedCount: 0,
      runtimeMinutes: 0,
    }
  );

  const report = {
    generatedAt: now.toISOString(),
    windowDays: args.days,
    cutoff: cutoff.toISOString(),
    database: redactDatabaseUrl(process.env.DATABASE_URL),
    summary: {
      canonicalTotalJobCount,
      canonicalVisibleStatusJobCount,
      strictCanonicalVisibleJobCount,
      feedIndexLiveJobCount,
      companyCount,
      companySourceCount,
      sourceCandidateCount,
      atsTenantCount,
    },
    jobs: {
      canonicalByStatus: countRowsToRecord(canonicalByStatusRows),
      feedIndexByStatus: countRowsToRecord(feedIndexByStatusRows),
      applyUrlValidationStatus: countRowsToRecord(applyUrlValidationRows),
      recent: countRowsToRecord(recentJobRows),
    },
    sourceRegistry: {
      activeValidatedPollableCount,
      byStatus: countRowsToRecord(sourceStatusRows),
      byValidationState: countRowsToRecord(sourceValidationRows),
      byPollState: countRowsToRecord(sourcePollRows),
      byExtractionRoute: countRowsToRecord(sourceExtractionRows),
      byConnector: countRowsToRecord(sourceConnectorRows),
      bySourceType: countRowsToRecord(sourceTypeRows),
      staleSourceCounts: countRowsToRecord(staleSourceCounts),
    },
    sourceCandidates: {
      byTypeStatusPlatform: candidateRows.map((row) => ({
        candidateType: row.candidateType,
        status: row.status,
        atsPlatform: row.atsPlatform ?? "UNKNOWN",
        count: toInt(row.count),
        avgConfidence: round(row.avgConfidence ?? 0),
        avgCoverageGapScore: round(row.avgCoverageGapScore ?? 0),
        avgPotentialYieldScore: round(row.avgPotentialYieldScore ?? 0),
      })),
      topCandidates: topCandidates.map((row) => ({
        ...row,
        confidence: round(row.confidence),
        coverageGapScore: round(row.coverageGapScore),
        potentialYieldScore: round(row.potentialYieldScore),
        noveltyScore: round(row.noveltyScore),
        sourceQualityScore: round(row.sourceQualityScore),
      })),
    },
    atsTenants: countRowsToRecord(atsTenantRows),
    queues: {
      pendingCount: sourceTaskRows
        .filter((row) => row.status === "PENDING")
        .reduce((sum, row) => sum + toInt(row.count), 0),
      runningCount: sourceTaskRows
        .filter((row) => row.status === "RUNNING")
        .reduce((sum, row) => sum + toInt(row.count), 0),
      byKindStatus: sourceTaskRows.map((row) => ({
        kind: row.kind,
        status: row.status,
        count: toInt(row.count),
        readyCount: toInt(row.readyCount),
        staleRunningCount: toInt(row.staleRunningCount),
      })),
    },
    ingestion: {
      sourceFamilies,
      topSources,
      windowTotals: {
        ...windowTotals,
        runtimeMinutes: round(windowTotals.runtimeMinutes, 2),
        failureRate: ratio(windowTotals.failedCount, windowTotals.runCount),
        acceptanceRate: ratio(windowTotals.acceptedCount, windowTotals.fetchedCount),
        noveltyRate: ratio(windowTotals.canonicalCreatedCount, windowTotals.acceptedCount),
        duplicateRate: ratio(windowTotals.dedupedCount, windowTotals.acceptedCount),
        createdPerMinute: round(
          windowTotals.canonicalCreatedCount / Math.max(windowTotals.runtimeMinutes, 1 / 60),
          4
        ),
      },
    },
    repairCandidates: repairCandidates.map((row) => ({
      ...row,
      sourceQualityScore: round(row.sourceQualityScore),
      yieldScore: round(row.yieldScore),
      priorityScore: round(row.priorityScore),
      lastSuccessfulPollAt: formatDate(row.lastSuccessfulPollAt),
      lastFailureAt: formatDate(row.lastFailureAt),
    })),
    companyCoverageGaps: companyCoverageGaps.map((row) => ({
      ...row,
      sourceCount: toInt(row.sourceCount),
      activeSourceCount: toInt(row.activeSourceCount),
      validatedSourceCount: toInt(row.validatedSourceCount),
      feedLiveJobCount: toInt(row.feedLiveJobCount),
      canonicalVisibleJobCount: toInt(row.canonicalVisibleJobCount),
      maxSourceQualityScore: round(row.maxSourceQualityScore ?? 0),
      maxPriorityScore: round(row.maxPriorityScore ?? 0),
    })),
  };

  const baseName = `source-intelligence-baseline-${args.label}`;
  const jsonPath = path.join(args.outputDir, `${baseName}.json`);
  const mdPath = path.join(args.outputDir, `${baseName}.md`);

  await mkdir(args.outputDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, buildMarkdownReport(report), "utf8");

  console.log(
    JSON.stringify(
      {
        generatedAt: report.generatedAt,
        jsonPath,
        mdPath,
        summary: report.summary,
        sourceRegistry: {
          activeValidatedPollableCount,
          byStatus: report.sourceRegistry.byStatus,
          byValidationState: report.sourceRegistry.byValidationState,
          byPollState: report.sourceRegistry.byPollState,
        },
        ingestionWindowTotals: report.ingestion.windowTotals,
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(
    "[source:intelligence-baseline] failed:",
    error instanceof Error ? error.stack ?? error.message : error
  );
  process.exitCode = 1;
});
