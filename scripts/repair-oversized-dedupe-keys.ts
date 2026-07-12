import "dotenv/config";

import { prisma } from "@/lib/db";
import { buildCanonicalDedupeFields } from "@/lib/ingestion/dedupe";

process.env.DATABASE_PROCESS_ROLE ??= "maintenance";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "30000";

const MAX_INDEX_KEY_LENGTH = 512;
const MAX_DESCRIPTION_FINGERPRINT_LENGTH = 960;

type Args = {
  apply: boolean;
  scanLimit: number;
  canonicalCursor: string | null;
  normalizedCursor: string | null;
};

type DedupeKeyRow = {
  id: string;
  company: string;
  title: string;
  description: string;
  location: string;
  region: "US" | "CA" | null;
  applyUrl: string;
  companyKey: string;
  titleKey: string;
  titleCoreKey: string;
  locationKey: string;
  descriptionFingerprint: string;
  applyUrlKey: string | null;
  duplicateClusterId: string | null;
};

const dedupeKeySelect = {
  id: true,
  company: true,
  title: true,
  description: true,
  location: true,
  region: true,
  applyUrl: true,
  companyKey: true,
  titleKey: true,
  titleCoreKey: true,
  locationKey: true,
  descriptionFingerprint: true,
  applyUrlKey: true,
  duplicateClusterId: true,
} as const;

function parseArgs(argv: string[]): Args {
  const rawLimit = argv.find(
    (arg) => arg.startsWith("--scan-limit=") || arg.startsWith("--limit=")
  );
  const rawValue = rawLimit?.startsWith("--scan-limit=")
    ? rawLimit.slice("--scan-limit=".length)
    : rawLimit?.slice("--limit=".length);
  const parsedLimit = rawValue ? Number.parseInt(rawValue, 10) : 500;
  const canonicalCursor = argv
    .find((arg) => arg.startsWith("--canonical-cursor="))
    ?.slice("--canonical-cursor=".length) ?? null;
  const normalizedCursor = argv
    .find((arg) => arg.startsWith("--normalized-cursor="))
    ?.slice("--normalized-cursor=".length) ?? null;

  return {
    apply: argv.includes("--apply"),
    scanLimit: Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 2_000)
      : 500,
    canonicalCursor,
    normalizedCursor,
  };
}

function isOversizedDedupeKey(row: DedupeKeyRow) {
  return (
    row.companyKey.length > MAX_INDEX_KEY_LENGTH ||
    row.titleKey.length > MAX_INDEX_KEY_LENGTH ||
    row.titleCoreKey.length > MAX_INDEX_KEY_LENGTH ||
    row.locationKey.length > MAX_INDEX_KEY_LENGTH ||
    row.descriptionFingerprint.length > MAX_DESCRIPTION_FINGERPRINT_LENGTH
  );
}

function nextDedupeFields(row: Pick<
  DedupeKeyRow,
  "company" | "title" | "description" | "location" | "region" | "applyUrl"
>) {
  return buildCanonicalDedupeFields(row);
}

async function scanCanonicals(cursor: string | null, scanLimit: number) {
  return prisma.jobCanonical.findMany({
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { id: "asc" },
    take: scanLimit,
    select: dedupeKeySelect,
  });
}

async function scanNormalizedRecords(cursor: string | null, scanLimit: number) {
  return prisma.normalizedJobRecord.findMany({
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { id: "asc" },
    take: scanLimit,
    select: dedupeKeySelect,
  });
}

async function repairRows(
  rows: DedupeKeyRow[],
  apply: boolean,
  update: (id: string, data: ReturnType<typeof nextDedupeFields>) => Promise<unknown>
) {
  let changed = 0;
  for (const row of rows) {
    if (!isOversizedDedupeKey(row)) continue;

    const next = nextDedupeFields(row);
    const hasChanged =
      row.companyKey !== next.companyKey ||
      row.titleKey !== next.titleKey ||
      row.titleCoreKey !== next.titleCoreKey ||
      row.locationKey !== next.locationKey ||
      row.descriptionFingerprint !== next.descriptionFingerprint ||
      row.applyUrlKey !== next.applyUrlKey ||
      row.duplicateClusterId !== next.duplicateClusterId;
    if (!hasChanged) continue;
    changed += 1;

    if (apply) await update(row.id, next);
  }

  return { scanned: rows.length, changed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [canonicalRows, normalizedRows] = await Promise.all([
    scanCanonicals(args.canonicalCursor, args.scanLimit),
    scanNormalizedRecords(args.normalizedCursor, args.scanLimit),
  ]);
  const [canonical, normalized] = await Promise.all([
    repairRows(canonicalRows, args.apply, (id, data) =>
      prisma.jobCanonical.update({ where: { id }, data })
    ),
    repairRows(normalizedRows, args.apply, (id, data) =>
      prisma.normalizedJobRecord.update({ where: { id }, data })
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "apply" : "dry-run",
        canonical,
        normalized,
        nextCanonicalCursor: canonicalRows.at(-1)?.id ?? null,
        nextNormalizedCursor: normalizedRows.at(-1)?.id ?? null,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("[jobs:repair-oversized-dedupe-keys] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
