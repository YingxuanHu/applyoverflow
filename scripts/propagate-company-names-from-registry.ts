import "dotenv/config";

process.env.DATABASE_PROCESS_ROLE ??= "company_name_propagation";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";

type Args = {
  apply: boolean;
  batchSize: number;
  maxBatches: number;
  sleepMs: number;
  out: string;
  skipCanonical: boolean;
  skipFeed: boolean;
  skipNormalized: boolean;
};

const DEFAULT_OUT =
  "data/discovery/reports/company-name-registry-propagation.json";

function readIntArg(name: string, fallback: number) {
  const raw = process.argv
    .find((arg) => arg.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readStringArg(name: string, fallback: string) {
  return (
    process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ??
    fallback
  );
}

function parseArgs(): Args {
  return {
    apply: process.argv.includes("--apply"),
    batchSize: Math.max(1, readIntArg("--batch-size", 750)),
    maxBatches: Math.max(1, readIntArg("--max-batches", 100)),
    sleepMs: readIntArg("--sleep-ms", 150),
    out: readStringArg("--out", DEFAULT_OUT),
    skipCanonical: process.argv.includes("--skip-canonical"),
    skipFeed: process.argv.includes("--skip-feed"),
    skipNormalized: process.argv.includes("--skip-normalized"),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toCount(rows: Array<{ count: number | bigint }>) {
  return Number(rows[0]?.count ?? 0);
}

async function countMismatches() {
  const [canonical, feed, normalized] = await Promise.all([
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "JobCanonical" jc
      JOIN "Company" c ON c.id = jc."companyId"
      WHERE c."metadataJson"->'sourceRegistryImport' IS NOT NULL
        AND jc.company IS DISTINCT FROM c.name
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "JobFeedIndex" jfi
      JOIN "JobCanonical" jc ON jc.id = jfi."canonicalJobId"
      JOIN "Company" c ON c.id = jc."companyId"
      WHERE c."metadataJson"->'sourceRegistryImport' IS NOT NULL
        AND jfi.company IS DISTINCT FROM c.name
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "NormalizedJobRecord" njr
      JOIN "Company" c ON c."companyKey" = njr."companyKey"
      WHERE c."metadataJson"->'sourceRegistryImport' IS NOT NULL
        AND njr.company IS DISTINCT FROM c.name
    `,
  ]);

  return {
    canonical: toCount(canonical),
    feed: toCount(feed),
    normalized: toCount(normalized),
  };
}

async function updateCanonicalBatch(batchSize: number) {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    WITH candidate AS MATERIALIZED (
      SELECT id, row_id, company_name
      FROM "_CompanyNamePropagationTarget"
      WHERE table_name = 'canonical'
      ORDER BY row_id
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    ),
    target AS MATERIALIZED (
      SELECT candidate.id, candidate.row_id, candidate.company_name
      FROM candidate
      JOIN "JobCanonical" jc ON jc.id = candidate.row_id
      FOR UPDATE OF jc SKIP LOCKED
    ),
    updated AS (
      UPDATE "JobCanonical" jc
      SET company = target.company_name
      FROM target
      WHERE jc.id = target.row_id
      RETURNING target.id
    ),
    deleted AS (
      DELETE FROM "_CompanyNamePropagationTarget" staged
      USING updated
      WHERE staged.id = updated.id
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM deleted
  `;

  return toCount(rows);
}

async function updateFeedBatch(batchSize: number) {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    WITH candidate AS MATERIALIZED (
      SELECT id, row_id, company_name
      FROM "_CompanyNamePropagationTarget"
      WHERE table_name = 'feed'
      ORDER BY row_id
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    ),
    target AS MATERIALIZED (
      SELECT candidate.id, candidate.row_id, candidate.company_name
      FROM candidate
      JOIN "JobFeedIndex" jfi ON jfi."canonicalJobId" = candidate.row_id
      FOR UPDATE OF jfi SKIP LOCKED
    ),
    updated AS (
      UPDATE "JobFeedIndex" jfi
      SET company = target.company_name,
          "indexedAt" = NOW()
      FROM target
      WHERE jfi."canonicalJobId" = target.row_id
      RETURNING target.id
    ),
    deleted AS (
      DELETE FROM "_CompanyNamePropagationTarget" staged
      USING updated
      WHERE staged.id = updated.id
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM deleted
  `;

  return toCount(rows);
}

async function updateNormalizedBatch(batchSize: number) {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    WITH candidate AS MATERIALIZED (
      SELECT id, row_id, company_name
      FROM "_CompanyNamePropagationTarget"
      WHERE table_name = 'normalized'
      ORDER BY row_id
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    ),
    target AS MATERIALIZED (
      SELECT candidate.id, candidate.row_id, candidate.company_name
      FROM candidate
      JOIN "NormalizedJobRecord" njr ON njr.id = candidate.row_id
      FOR UPDATE OF njr SKIP LOCKED
    ),
    updated AS (
      UPDATE "NormalizedJobRecord" njr
      SET company = target.company_name
      FROM target
      WHERE njr.id = target.row_id
      RETURNING target.id
    ),
    deleted AS (
      DELETE FROM "_CompanyNamePropagationTarget" staged
      USING updated
      WHERE staged.id = updated.id
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM deleted
  `;

  return toCount(rows);
}

async function runBatches(input: {
  label: string;
  batchSize: number;
  maxBatches: number;
  sleepMs: number;
  updateBatch: (batchSize: number) => Promise<number>;
}) {
  let updated = 0;
  let batches = 0;

  for (let index = 0; index < input.maxBatches; index += 1) {
    const count = await input.updateBatch(input.batchSize);
    batches += 1;
    updated += count;
    console.log(
      JSON.stringify({
        table: input.label,
        batch: batches,
        updatedThisBatch: count,
        updated,
      })
    );

    if (count < input.batchSize) break;
    if (input.sleepMs > 0) await sleep(input.sleepMs);
  }

  return { updated, batches };
}

async function prepareStaging() {
  await prisma.$executeRaw`DROP TABLE IF EXISTS "_CompanyNamePropagationTarget"`;
  await prisma.$executeRaw`
    CREATE UNLOGGED TABLE "_CompanyNamePropagationTarget" (
      id text PRIMARY KEY,
      table_name text NOT NULL,
      row_id text NOT NULL,
      company_name text NOT NULL
    )
  `;

  await prisma.$executeRaw`
    INSERT INTO "_CompanyNamePropagationTarget" (id, table_name, row_id, company_name)
    SELECT 'canonical:' || jc.id, 'canonical', jc.id, c.name
    FROM "JobCanonical" jc
    JOIN "Company" c ON c.id = jc."companyId"
    WHERE c."metadataJson"->'sourceRegistryImport' IS NOT NULL
      AND jc.company IS DISTINCT FROM c.name
  `;

  await prisma.$executeRaw`
    INSERT INTO "_CompanyNamePropagationTarget" (id, table_name, row_id, company_name)
    SELECT 'feed:' || jfi."canonicalJobId", 'feed', jfi."canonicalJobId", c.name
    FROM "JobFeedIndex" jfi
    JOIN "JobCanonical" jc ON jc.id = jfi."canonicalJobId"
    JOIN "Company" c ON c.id = jc."companyId"
    WHERE c."metadataJson"->'sourceRegistryImport' IS NOT NULL
      AND jfi.company IS DISTINCT FROM c.name
  `;

  await prisma.$executeRaw`
    INSERT INTO "_CompanyNamePropagationTarget" (id, table_name, row_id, company_name)
    SELECT 'normalized:' || njr.id, 'normalized', njr.id, c.name
    FROM "NormalizedJobRecord" njr
    JOIN "Company" c ON c."companyKey" = njr."companyKey"
    WHERE c."metadataJson"->'sourceRegistryImport' IS NOT NULL
      AND njr.company IS DISTINCT FROM c.name
  `;

  await prisma.$executeRaw`
    CREATE INDEX "_CompanyNamePropagationTarget_table_row_idx"
    ON "_CompanyNamePropagationTarget" (table_name, row_id)
  `;

  const counts = await prisma.$queryRaw<
    Array<{ table_name: string; count: number }>
  >`
    SELECT table_name, COUNT(*)::int AS count
    FROM "_CompanyNamePropagationTarget"
    GROUP BY table_name
    ORDER BY table_name
  `;

  return Object.fromEntries(counts.map((row) => [row.table_name, row.count]));
}

async function cleanupStaging() {
  await prisma.$executeRaw`DROP TABLE IF EXISTS "_CompanyNamePropagationTarget"`;
}

async function writeReport(out: string, report: unknown) {
  const outPath = path.resolve(out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs();
  const startedAt = new Date();
  const before = await countMismatches();

  const report = {
    generatedAt: startedAt.toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    batchSize: args.batchSize,
    maxBatches: args.maxBatches,
    sleepMs: args.sleepMs,
    before,
    staged: {},
    canonical: { updated: 0, batches: 0 },
    feed: { updated: 0, batches: 0 },
    normalized: { updated: 0, batches: 0 },
    after: before,
  };

  if (args.apply) {
    report.staged = await prepareStaging();
    if (!args.skipCanonical) {
      report.canonical = await runBatches({
        label: "JobCanonical",
        batchSize: args.batchSize,
        maxBatches: args.maxBatches,
        sleepMs: args.sleepMs,
        updateBatch: updateCanonicalBatch,
      });
    }

    if (!args.skipFeed) {
      report.feed = await runBatches({
        label: "JobFeedIndex",
        batchSize: args.batchSize,
        maxBatches: args.maxBatches,
        sleepMs: args.sleepMs,
        updateBatch: updateFeedBatch,
      });
    }

    if (!args.skipNormalized) {
      report.normalized = await runBatches({
        label: "NormalizedJobRecord",
        batchSize: args.batchSize,
        maxBatches: args.maxBatches,
        sleepMs: args.sleepMs,
        updateBatch: updateNormalizedBatch,
      });
    }

    report.after = await countMismatches();
    await cleanupStaging();
  }

  await writeReport(args.out, report);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(
      "Company name registry propagation failed:",
      error instanceof Error ? error.stack ?? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
