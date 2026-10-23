import "dotenv/config";
import { prisma } from "../src/lib/db";
import { inferGeoScope } from "../src/lib/geo-scope";
import { inferRegion } from "../src/lib/ingestion/normalize";
import { exactLocationRegion } from "../src/lib/location-search";

type CliArgs = {
  apply: boolean;
  limit: number;
  batchSize: number;
  repairExplicit: boolean;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.repairExplicit) {
    await repairExplicitRegions(args);
    return;
  }

  const canonicals = await prisma.jobCanonical.findMany({
    where: {
      status: { in: ["LIVE", "AGING"] },
      region: null,
    },
    select: {
      id: true,
      location: true,
      status: true,
    },
    orderBy: [{ postedAt: "desc" }, { updatedAt: "desc" }],
    take: args.limit,
  });

  const usIds: string[] = [];
  const caIds: string[] = [];
  const unknownByScope = new Map<string, number>();
  const feedRegionOutOfSync = await countFeedIndexRegionMismatches();

  for (const canonical of canonicals) {
    const region = inferRegion(canonical.location);
    if (region === "US") {
      usIds.push(canonical.id);
      continue;
    }
    if (region === "CA") {
      caIds.push(canonical.id);
      continue;
    }

    const scope = inferGeoScope(canonical.location, null);
    unknownByScope.set(scope, (unknownByScope.get(scope) ?? 0) + 1);
  }

  if (args.apply) {
    await updateRegionBatch(usIds, "US", args.batchSize);
    await updateRegionBatch(caIds, "CA", args.batchSize);
    await syncFeedIndexRegions();
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "apply" : "dry-run",
        inspected: canonicals.length,
        updatedUs: usIds.length,
        updatedCa: caIds.length,
        stillUnknown: canonicals.length - usIds.length - caIds.length,
        feedRegionOutOfSync,
        feedRegionSyncApplied: args.apply,
        unknownByScope: Object.fromEntries(
          [...unknownByScope.entries()].sort((left, right) => right[1] - left[1])
        ),
      },
      null,
      2
    )
  );
}

// Repair only single-location rows with an explicit, unambiguous qualifier.
// A compare-and-set prevents overwriting a concurrent ingestion update.
async function repairExplicitRegions(args: CliArgs) {
  let cursor: string | undefined;
  let inspected = 0;
  let updated = 0;
  const changes: Array<{ id: string; location: string; before: string; after: string }> = [];
  while (inspected < args.limit) {
    const rows = await prisma.jobCanonical.findMany({
      where: { status: { in: ["LIVE", "AGING"] }, region: { not: null } },
      select: { id: true, location: true, region: true }, orderBy: { id: "asc" },
      take: Math.min(args.batchSize, args.limit - inspected),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      inspected++;
      if (/[;|/\n]|\s&\s/.test(row.location)) continue;
      const parts = row.location.split(",").map((part) => part.trim());
      if (parts.length < 2 || parts.length > 3) continue;
      const explicit = exactLocationRegion(parts.at(-1)!);
      const inferred = inferRegion(row.location);
      if (!explicit || inferred !== explicit || inferred === row.region) continue;
      changes.push({ id: row.id, location: row.location, before: row.region!, after: inferred });
      if (args.apply) {
        updated += await prisma.$transaction(async (tx) => {
          const result = await tx.jobCanonical.updateMany({
            where: { id: row.id, region: row.region, location: row.location, status: { in: ["LIVE", "AGING"] } },
            data: { region: inferred },
          });
          if (result.count) await tx.jobFeedIndex.updateMany({ where: { canonicalJobId: row.id }, data: { region: inferred } });
          return result.count;
        });
      }
    }
    cursor = rows.at(-1)!.id;
  }
  console.log(JSON.stringify({ mode: args.apply ? "apply-explicit" : "dry-run-explicit", inspected, candidates: changes.length, updated, changes }, null, 2));
}

async function updateRegionBatch(
  ids: string[],
  region: "US" | "CA",
  batchSize: number
) {
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize);
    await prisma.jobCanonical.updateMany({
      where: {
        id: { in: batch },
        region: null,
      },
      data: { region },
    });
  }
}

async function countFeedIndexRegionMismatches() {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "JobFeedIndex" jfi
    JOIN "JobCanonical" jc ON jc.id = jfi."canonicalJobId"
    WHERE jfi.region IS DISTINCT FROM jc.region
  `;

  return Number(rows[0]?.count ?? 0);
}

async function syncFeedIndexRegions() {
  await prisma.$executeRaw`
    UPDATE "JobFeedIndex" jfi
    SET region = jc.region
    FROM "JobCanonical" jc
    WHERE jfi."canonicalJobId" = jc.id
      AND jfi.region IS DISTINCT FROM jc.region
  `;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    apply: false,
    limit: 100_000,
    batchSize: 1_000,
    repairExplicit: false,
  };

  for (const rawArg of argv) {
    if (rawArg === "--repair-explicit") { parsed.repairExplicit = true; continue; }
    if (rawArg === "--apply") {
      parsed.apply = true;
      continue;
    }

    if (rawArg.startsWith("--limit=")) {
      parsed.limit = parsePositiveInt(rawArg.split("=", 2)[1], parsed.limit);
      continue;
    }

    if (rawArg.startsWith("--batch-size=")) {
      parsed.batchSize = parsePositiveInt(rawArg.split("=", 2)[1], parsed.batchSize);
    }
  }

  return parsed;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main()
  .catch((error) => {
    console.error("Failed to backfill canonical regions:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
