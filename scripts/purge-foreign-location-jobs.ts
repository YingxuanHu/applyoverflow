// Foreign-location purge: enforces the North-America-only product scope for
// LIVE JobCanonical rows whose region could not be inferred (region IS NULL).
// Most region-less rows are legitimately ambiguous ("Remote"); this script
// targets only locations that explicitly name a non-NA geography
// (isClearlyNonNorthAmericanLocation in src/lib/geo-scope.ts — e.g. "Mobile
// Phone Shop Surabaya", "Unity Corporation Semarang") and re-indexes them so
// the feed gate in src/lib/ingestion/search-index.ts hides them. No rows are
// deleted.
//
// Usage:
//   npm run jobs:purge-foreign-locations                      (dry run)
//   npm run jobs:purge-foreign-locations -- --apply
//   npm run jobs:purge-foreign-locations -- --limit=2000 --apply

import "dotenv/config";

import { prisma } from "../src/lib/db";
import { isClearlyNonNorthAmericanLocation } from "../src/lib/geo-scope";
import { upsertJobFeedIndexes } from "../src/lib/ingestion/search-index";

type CliArgs = { limit: number; apply: boolean };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: 200_000, apply: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--limit=")) {
      args.limit = Math.max(
        1,
        Number.parseInt(raw.slice("--limit=".length), 10) || 200_000
      );
    }
  }
  return args;
}

const SCAN_PAGE_SIZE = 5_000;
const REINDEX_BATCH_SIZE = 200;
const SAMPLE_LOCATION_LIMIT = 30;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const matchedIds: string[] = [];
  const sampleLocations: string[] = [];
  let scanned = 0;
  let matched = 0;
  let cursor: string | null = null;

  for (;;) {
    const page: Array<{ id: string; location: string }> =
      await prisma.jobCanonical.findMany({
        where: { status: "LIVE", region: null },
        select: { id: true, location: true },
        orderBy: { id: "asc" },
        take: SCAN_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
    if (page.length === 0) break;

    scanned += page.length;
    for (const row of page) {
      if (!isClearlyNonNorthAmericanLocation(row.location)) continue;
      matched += 1;
      if (matchedIds.length < args.limit) matchedIds.push(row.id);
      if (sampleLocations.length < SAMPLE_LOCATION_LIMIT) {
        sampleLocations.push(row.location);
      }
    }

    cursor = page[page.length - 1]?.id ?? null;
    if (page.length < SCAN_PAGE_SIZE) break;
  }

  console.log(
    `[foreign-purge] scanned=${scanned} matched=${matched} limit=${args.limit} apply=${args.apply}`
  );
  console.log(
    `[foreign-purge] sample locations (first ${sampleLocations.length}):`
  );
  for (const location of sampleLocations) {
    console.log(`[foreign-purge]   ${location}`);
  }

  if (!args.apply) {
    console.log(
      "[foreign-purge] dry run — pass --apply to re-index the matched jobs"
    );
    return;
  }

  let reindexed = 0;
  for (let start = 0; start < matchedIds.length; start += REINDEX_BATCH_SIZE) {
    const batch = matchedIds.slice(start, start + REINDEX_BATCH_SIZE);
    await upsertJobFeedIndexes(batch);
    reindexed += batch.length;
    console.log(
      `[foreign-purge] re-indexed ${reindexed}/${matchedIds.length}`
    );
  }

  console.log(`[foreign-purge] done: reindexed=${reindexed}`);
}

main()
  .catch((error) => {
    console.error("[foreign-purge] fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
