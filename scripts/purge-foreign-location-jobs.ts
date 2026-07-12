// Foreign-location purge: enforces the North-America-only product scope for
// LIVE JobCanonical rows whose region could not be inferred (region IS NULL).
// Most region-less rows are legitimately ambiguous ("Remote"); this script
// targets only locations that explicitly name a non-NA geography
// (isClearlyNonNorthAmericanLocation in src/lib/geo-scope.ts — e.g. "Mobile
// Phone Shop Surabaya", "Unity Corporation Semarang") and re-indexes them so
// the feed gate in src/lib/ingestion/search-index.ts hides them. No rows are
// deleted.
//
// --recheck-regioned additionally scans LIVE rows whose region IS set:
// trailing-country-code collisions (Indonesia's ID read as Idaho, India's IN
// as Indiana) and foreign-city collisions with US city markers ("Cambridge,
// UK") historically stamped thousands of foreign rows with region US/CA.
// For any such row where the FIXED inferRegion now yields null and the
// foreign detector fires, the canonical region is cleared and the row is
// re-indexed (the feed gate then hides it).
//
// Usage:
//   npm run jobs:purge-foreign-locations                      (dry run)
//   npm run jobs:purge-foreign-locations -- --apply
//   npm run jobs:purge-foreign-locations -- --recheck-regioned --apply

import "dotenv/config";

import { prisma } from "../src/lib/db";
import { isClearlyNonNorthAmericanLocation } from "../src/lib/geo-scope";
import { inferRegion } from "../src/lib/ingestion/normalize";
import { upsertJobFeedIndexes } from "../src/lib/ingestion/search-index";

type CliArgs = { limit: number; apply: boolean; recheckRegioned: boolean };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: 200_000, apply: false, recheckRegioned: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw === "--recheck-regioned") args.recheckRegioned = true;
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
  const regionClearIds: string[] = [];
  const sampleLocations: string[] = [];
  let scanned = 0;
  let matched = 0;
  let cursor: string | null = null;

  for (;;) {
    const page: Array<{ id: string; location: string; region: string | null }> =
      await prisma.jobCanonical.findMany({
        where: args.recheckRegioned
          ? { status: "LIVE" }
          : { status: "LIVE", region: null },
        select: { id: true, location: true, region: true },
        orderBy: { id: "asc" },
        take: SCAN_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
    if (page.length === 0) break;

    scanned += page.length;
    for (const row of page) {
      if (!isClearlyNonNorthAmericanLocation(row.location)) continue;
      // A regioned row only counts when the fixed inference no longer
      // supports the stamped region — inferRegion's early explicit-NA checks
      // ("Fort Wayne, Indiana, United States; Mumbai, India") keep genuine
      // multi-location NA postings out of scope here.
      if (row.region !== null && inferRegion(row.location) !== null) continue;
      matched += 1;
      if (matchedIds.length < args.limit) {
        matchedIds.push(row.id);
        if (row.region !== null) regionClearIds.push(row.id);
      }
      if (sampleLocations.length < SAMPLE_LOCATION_LIMIT) {
        sampleLocations.push(`${row.region ?? "-"} | ${row.location}`);
      }
    }

    cursor = page[page.length - 1]?.id ?? null;
    if (page.length < SCAN_PAGE_SIZE) break;
  }

  console.log(
    `[foreign-purge] scanned=${scanned} matched=${matched} (regioned=${regionClearIds.length}) limit=${args.limit} apply=${args.apply} recheckRegioned=${args.recheckRegioned}`
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

  // Clear the wrongly-stamped regions first so the subsequent re-index sees
  // region=null and the location-based feed gate applies.
  let regionsCleared = 0;
  for (let start = 0; start < regionClearIds.length; start += REINDEX_BATCH_SIZE) {
    const batch = regionClearIds.slice(start, start + REINDEX_BATCH_SIZE);
    const result = await prisma.jobCanonical.updateMany({
      where: { id: { in: batch } },
      data: { region: null },
    });
    regionsCleared += result.count;
  }
  if (regionClearIds.length > 0) {
    console.log(`[foreign-purge] cleared regions on ${regionsCleared} rows`);
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
