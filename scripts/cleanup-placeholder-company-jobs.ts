// Placeholder-company cleanup: the JobBank connectors used to attribute jobs
// to placeholder "companies" ("Job Bank Employer" or bare NAICS sector names
// like "Retail trade") when the real employer was anonymized. Users saw these
// as employer names on job cards. This script finds the affected LIVE
// JobCanonical rows and re-indexes them so the extended generic-company
// detection (PLACEHOLDER_COMPANY_NAMES in src/lib/job-cleanup.ts) hides them
// from the job feed. No rows are deleted.
//
// Usage:
//   npm run jobs:cleanup-placeholder-companies                      (dry run)
//   npm run jobs:cleanup-placeholder-companies -- --apply
//   npm run jobs:cleanup-placeholder-companies -- --limit=2000 --apply

import "dotenv/config";

import { prisma } from "../src/lib/db";
import { upsertJobFeedIndexes } from "../src/lib/ingestion/search-index";
import { PLACEHOLDER_COMPANY_NAMES } from "../src/lib/job-cleanup";

type CliArgs = { limit: number; apply: boolean };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: 50_000, apply: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--limit=")) {
      args.limit = Math.max(
        1,
        Number.parseInt(raw.slice("--limit=".length), 10) || 50_000
      );
    }
  }
  return args;
}

const REINDEX_BATCH_SIZE = 200;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const where = {
    status: "LIVE" as const,
    company: {
      in: [...PLACEHOLDER_COMPANY_NAMES],
      mode: "insensitive" as const,
    },
  };

  const grouped = await prisma.jobCanonical.groupBy({
    by: ["company"],
    where,
    _count: { _all: true },
  });
  const counts = grouped
    .map((row) => ({ company: row.company, count: row._count._all }))
    .sort((a, b) => b.count - a.count);
  const total = counts.reduce((sum, row) => sum + row.count, 0);

  console.log(
    `[placeholder-cleanup] matched=${total} distinctCompanies=${counts.length} limit=${args.limit} apply=${args.apply}`
  );
  for (const row of counts) {
    console.log(`[placeholder-cleanup]   ${row.count}\t${row.company}`);
  }

  if (!args.apply) {
    console.log(
      "[placeholder-cleanup] dry run — pass --apply to re-index the matched jobs"
    );
    return;
  }

  const rows = await prisma.jobCanonical.findMany({
    where,
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: args.limit,
  });

  let reindexed = 0;
  for (let start = 0; start < rows.length; start += REINDEX_BATCH_SIZE) {
    const batch = rows
      .slice(start, start + REINDEX_BATCH_SIZE)
      .map((row) => row.id);
    await upsertJobFeedIndexes(batch);
    reindexed += batch.length;
    console.log(`[placeholder-cleanup] re-indexed ${reindexed}/${rows.length}`);
  }

  console.log(`[placeholder-cleanup] done: reindexed=${reindexed}`);
}

main()
  .catch((error) => {
    console.error("[placeholder-cleanup] fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
