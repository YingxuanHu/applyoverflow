/**
 * One-shot backfill: rewrite JobCanonical rows whose `title` is actually a
 * location string (Workday connector bug — see
 * src/lib/ingestion/workday-title-parser.ts for context). For each affected
 * row, derive the real title from the applyUrl and UPDATE in place.
 *
 * Idempotent: re-runs only touch rows that still look broken. Safe to run
 * multiple times.
 *
 * Usage:
 *   tsx -r dotenv/config scripts/backfill-bad-workday-titles.ts [--dry]
 */
import "dotenv/config";

import process from "node:process";
import { prisma } from "@/lib/db";
import {
  extractTitleFromWorkdayUrl,
  isLikelyLocationToken,
} from "@/lib/ingestion/workday-title-parser";

async function main() {
  const dryRun = process.argv.includes("--dry");

  // Pull every row whose stored title looks like a known location. The set
  // of "looks like a location" strings is small (~50 entries), so an
  // IN-list keeps the query cheap even on a 500K-row table.
  const suspects = await prisma.jobCanonical.findMany({
    where: {
      OR: [
        { title: "Montreal" },
        { title: "Toronto" },
        { title: "Vancouver" },
        { title: "Calgary" },
        { title: "Edmonton" },
        { title: "Ottawa" },
        { title: "Quebec" },
        { title: "New York" },
        { title: "San Francisco" },
        { title: "Los Angeles" },
        { title: "Seattle" },
        { title: "Chicago" },
        { title: "Austin" },
        { title: "Boston" },
        { title: "Dallas" },
        { title: "Atlanta" },
        { title: "Denver" },
        { title: "Phoenix" },
        { title: "Washington" },
        { title: "Minneapolis" },
      ],
    },
    select: { id: true, title: true, applyUrl: true },
  });

  console.log(`[backfill] found ${suspects.length} suspect rows`);

  let fixed = 0;
  let skipped = 0;

  for (const row of suspects) {
    // Belt-and-suspenders — confirm the title really is a location before
    // we rewrite. The IN-list above covers known ones; this catches anything
    // weird that slipped in.
    if (!isLikelyLocationToken(row.title)) {
      skipped += 1;
      continue;
    }

    const derivedTitle = extractTitleFromWorkdayUrl(row.applyUrl);
    if (!derivedTitle || isLikelyLocationToken(derivedTitle)) {
      // The URL doesn't give us a usable title — leave the row alone.
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(
        `[backfill] DRY ${row.id}: "${row.title}" → "${derivedTitle}"  (${row.applyUrl})`
      );
      fixed += 1;
      continue;
    }

    await prisma.jobCanonical.update({
      where: { id: row.id },
      data: { title: derivedTitle, updatedAt: new Date() },
    });
    fixed += 1;
  }

  console.log(
    `[backfill] done — fixed=${fixed} skipped=${skipped} (dry=${dryRun})`
  );
}

main()
  .catch((error) => {
    console.error("[backfill] failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
