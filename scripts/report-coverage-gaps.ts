// Coverage-gap report: companies whose visible jobs we only see through
// aggregator boards while having NO healthy first-party source. Each row is
// a proven hiring company (3+ aggregator-primary LIVE jobs) that a single
// first-party discovery would upgrade wholesale — the highest-value
// discovery targets. Read-only.
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

// One pass over the visible feed: bucket every LIVE job's primary source
// mapping by companyKey into aggregator vs first-party counts, then attach
// the company record (may not exist for a companyKey — still report) and
// its healthy-source count. The >= floor is pushed into SQL to keep the
// candidate set small; the final gap decision runs through
// classifyCoverageGap so it stays unit-testable.
async function fetchGapCandidates() {
  return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    WITH visible AS (
      SELECT c."companyKey" AS company_key,
        LOWER(split_part(m."sourceName", ':', 1)) AS family
      FROM "JobFeedIndex" f
      JOIN "JobCanonical" c ON c.id = f."canonicalJobId"
      JOIN "JobSourceMapping" m ON m."canonicalJobId" = f."canonicalJobId"
        AND m."isPrimary" = true
        AND m."removedAt" IS NULL
      WHERE f.status = 'LIVE'
        AND c."companyKey" <> ''
    ),
    by_company AS (
      SELECT company_key,
        COUNT(*) FILTER (WHERE family = ANY(${AGGREGATOR_SOURCE_FAMILIES})) AS aggregator_jobs,
        COUNT(*) FILTER (WHERE family <> ALL(${AGGREGATOR_SOURCE_FAMILIES})) AS first_party_jobs,
        COUNT(DISTINCT family) FILTER (WHERE family = ANY(${AGGREGATOR_SOURCE_FAMILIES})) AS aggregator_families
      FROM visible
      GROUP BY 1
    )
    SELECT b.company_key,
      co.name AS company_name,
      co.domain,
      b.aggregator_jobs,
      b.first_party_jobs,
      b.aggregator_families,
      COALESCE(hs.healthy_sources, 0)::bigint AS healthy_sources
    FROM by_company b
    LEFT JOIN "Company" co ON co."companyKey" = b.company_key
    LEFT JOIN (
      SELECT "companyId", COUNT(*) AS healthy_sources
      FROM "CompanySource"
      WHERE status IN ('ACTIVE', 'PROVISIONED', 'DEGRADED')
      GROUP BY 1
    ) hs ON hs."companyId" = co.id
    WHERE b.aggregator_jobs >= ${COVERAGE_GAP_MIN_AGGREGATOR_JOBS}
    ORDER BY b.aggregator_jobs DESC, b.company_key ASC
  `);
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
    `Candidates (>=${COVERAGE_GAP_MIN_AGGREGATOR_JOBS} aggregator-primary visible jobs): ${candidates.length} | coverage gaps: ${gaps.length} | showing top ${rows.length}`
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
