// Coverage-gap report: companies whose indexed jobs we only see through
// aggregator boards while having NO healthy first-party source. Each row is
// a hiring lead (3+ aggregator-only indexed LIVE jobs) that a working
// first-party discovery could improve. Read-only.
//
// Usage:
//   npm run source:report-coverage-gaps
//   npm run source:report-coverage-gaps -- --limit=100 --json

import "dotenv/config";

import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import {
  COVERAGE_GAP_MIN_AGGREGATOR_JOBS,
  classifyCoverageGap,
} from "../src/lib/ingestion/coverage-gap-policy";
import {
  buildHealthySourceCoverageSql,
  SOURCE_COVERAGE_FRESHNESS_DAYS,
} from "../src/lib/ingestion/source-coverage-queries";

// Source families (lower(split_part("sourceName", ':', 1))) that reach us
// through aggregator boards rather than the employer's own portal. Derived
// from the aggregator tier in src/lib/ingestion/classify.ts (adzuna,
// himalayas, themuse, remoteok, remotive, jobicy, jobbank) plus the other
// aggregator-style connectors under src/lib/ingestion/connectors whose
// sourceName prefixes are Jooble, WeWorkRemotely, HiringCafe, JSearch and
// JobBankLive.
const AGGREGATOR_SOURCE_FAMILIES = [
  "adzuna",
  "himalayas",
  "hiringcafe",
  "jobbank",
  "jobbanklive",
  "jobicy",
  "jooble",
  "jsearch",
  "remoteok",
  "remotive",
  "themuse",
  "weworkremotely",
];

const DEFAULT_LIMIT = 50;

type CandidateRow = {
  company_key: string;
  company_name: string | null;
  domain: string | null;
  aggregator_jobs: bigint;
  first_party_jobs: bigint;
  aggregator_families: bigint;
  healthy_sources: bigint;
};

// Internal inventory, not the filtered public-board count. Examine all active
// mappings: a secondary employer source also provides first-party coverage.
// Bucket jobs by companyKey into aggregator-only vs first-party counts, then attach
// the company record (may not exist for a companyKey — still report) and
// its healthy-source count. The >= floor is pushed into SQL to keep the
// candidate set small; the final gap decision runs through
// classifyCoverageGap so it stays unit-testable.
async function fetchGapCandidates() {
  const now = new Date();
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SET TRANSACTION READ ONLY`;
    await db.$executeRaw`SET LOCAL statement_timeout = '25s'`;
    await db.$executeRaw`SET LOCAL lock_timeout = '1s'`;
    return db.$queryRaw<CandidateRow[]>(Prisma.sql`
    WITH visible AS (
      SELECT c."companyKey" AS company_key, c.id,
        LOWER(split_part(m."sourceName", ':', 1)) AS family
      FROM "JobFeedIndex" f
      JOIN "JobCanonical" c ON c.id = f."canonicalJobId"
      JOIN "JobSourceMapping" m ON m."canonicalJobId" = f."canonicalJobId"
        AND m."removedAt" IS NULL
      WHERE f.status = 'LIVE'
        AND c."companyKey" <> ''
    ),
    by_job AS (
      SELECT company_key, id,
        BOOL_OR(family = ANY(${AGGREGATOR_SOURCE_FAMILIES})) AS has_aggregator,
        BOOL_OR(family <> ALL(${AGGREGATOR_SOURCE_FAMILIES})) AS has_first_party
      FROM visible GROUP BY 1, 2
    ),
    by_company AS (
      SELECT company_key,
        COUNT(*) FILTER (WHERE has_aggregator AND NOT has_first_party) AS aggregator_jobs,
        COUNT(*) FILTER (WHERE has_first_party) AS first_party_jobs
      FROM by_job
      GROUP BY 1
    ),
    families AS (
      SELECT company_key, COUNT(DISTINCT family) AS aggregator_families
      FROM visible WHERE family = ANY(${AGGREGATOR_SOURCE_FAMILIES}) GROUP BY 1
    )
    SELECT b.company_key,
      co.name AS company_name,
      co.domain,
      b.aggregator_jobs,
      b.first_party_jobs,
      families.aggregator_families,
      COALESCE(hs.healthy_sources, 0)::bigint AS healthy_sources
    FROM by_company b
    JOIN families USING (company_key)
    LEFT JOIN "Company" co ON co."companyKey" = b.company_key
    LEFT JOIN (
      SELECT "companyId", COUNT(*) AS healthy_sources
      FROM "CompanySource" cs
      WHERE ${buildHealthySourceCoverageSql(now)}
      GROUP BY 1
    ) hs ON hs."companyId" = co.id
    WHERE b.aggregator_jobs >= ${COVERAGE_GAP_MIN_AGGREGATOR_JOBS}
    ORDER BY b.aggregator_jobs DESC, b.company_key ASC
    `);
  }, { timeout: 28_000 });
}

function toNumber(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

function parseLimit(argv: string[]): number {
  const arg = argv.find((value) => value.startsWith("--limit="));
  if (!arg) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(arg.slice("--limit=".length), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
}

async function main() {
  const asJson = process.argv.includes("--json");
  const limit = parseLimit(process.argv.slice(2));

  const candidates = await fetchGapCandidates();

  const gaps = candidates
    .map((row) => ({
      companyKey: row.company_key,
      companyName: row.company_name,
      domain: row.domain,
      aggregatorJobs: toNumber(row.aggregator_jobs),
      firstPartyJobs: toNumber(row.first_party_jobs),
      aggregatorFamilies: toNumber(row.aggregator_families),
      healthySources: toNumber(row.healthy_sources),
    }))
    .filter((row) =>
      classifyCoverageGap({
        aggregatorJobs: row.aggregatorJobs,
        firstPartyJobs: row.firstPartyJobs,
        healthySources: row.healthySources,
      })
    );

  const rows = gaps.slice(0, limit).map((row, index) => ({
    rank: index + 1,
    ...row,
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    minAggregatorJobs: COVERAGE_GAP_MIN_AGGREGATOR_JOBS,
    countsAreNonPublic: true,
    diagnosticScope: "Indexed LIVE inventory with active source mappings, not JobFeedSummaryCache.liveJobCount.",
    healthySourceMaxAgeDays: SOURCE_COVERAGE_FRESHNESS_DAYS,
    aggregatorSourceFamilies: AGGREGATOR_SOURCE_FAMILIES,
    candidateCompanies: candidates.length,
    gapCompanies: gaps.length,
    limit,
    rows,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Coverage gaps @ ${report.generatedAt}`);
  console.log(`Aggregator families: ${AGGREGATOR_SOURCE_FAMILIES.join(", ")}`);
  console.log(
    `Candidates (>=${COVERAGE_GAP_MIN_AGGREGATOR_JOBS} aggregator-only indexed jobs; non-public): ${candidates.length} | coverage gaps: ${gaps.length} | showing top ${rows.length}`
  );
  console.log("");
  console.log(
    `${"rank".padStart(4)}  ${"aggJobs".padStart(7)}  ${"families".padStart(8)}  ${"company".padEnd(40)}  domain`
  );
  for (const row of rows) {
    console.log(
      `${String(row.rank).padStart(4)}  ${String(row.aggregatorJobs).padStart(7)}  ${String(row.aggregatorFamilies).padStart(8)}  ${(row.companyName ?? row.companyKey).slice(0, 40).padEnd(40)}  ${row.domain ?? "-"}`
    );
  }
  if (rows.length === 0) {
    console.log("  (no coverage-gap companies found)");
  }
}

main()
  .catch((error) => {
    console.error("[coverage-gaps] fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
