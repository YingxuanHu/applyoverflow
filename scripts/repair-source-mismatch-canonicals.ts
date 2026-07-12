import "dotenv/config";

import { prisma } from "../src/lib/db";
import { canonicalizeNormalizedJobRecord } from "../src/lib/ingestion/staged-pipeline";
import { upsertJobFeedIndexes } from "../src/lib/ingestion/search-index";

type Args = {
  apply: boolean;
  sourceName: string;
  limit: number;
  concurrency: number;
};

type MismatchRow = {
  normalizedId: string;
  oldCanonicalId: string;
};

const DEFAULT_LIMIT = 1_000;
const DEFAULT_CONCURRENCY = 3;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();

  const before = await readStats(args.sourceName);
  const rows = await findMismatchRows(args.sourceName, args.limit);

  if (!args.apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          sourceName: args.sourceName,
          scanned: rows.length,
          before,
        },
        null,
        2
      )
    );
    return;
  }

  const touched = new Set<string>();
  const errors: Array<{ normalizedId: string; error: string }> = [];
  let nextIndex = 0;
  let moved = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  async function worker() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const row = rows[index];
      if (!row) return;

      try {
        const result = await canonicalizeNormalizedJobRecord(row.normalizedId);
        touched.add(row.oldCanonicalId);
        if (result.canonicalJobId) touched.add(result.canonicalJobId);
        if (result.canonicalJobId && result.canonicalJobId !== row.oldCanonicalId) {
          moved += 1;
        }
        if (result.status === "CREATED") created += 1;
        else if (result.status === "UPDATED") updated += 1;
        else skipped += 1;
      } catch (error) {
        failed += 1;
        if (errors.length < 20) {
          errors.push({
            normalizedId: row.normalizedId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, args.concurrency) }, () => worker())
  );

  const touchedIds = [...touched].filter(Boolean);
  for (const canonicalId of touchedIds) {
    await refreshPrimarySourceMapping(canonicalId);
  }
  const retiredEmpty = await retireEmptyCanonicals(touchedIds, new Date());
  await upsertJobFeedIndexes(touchedIds, { concurrency: 6 });

  const after = await readStats(args.sourceName);

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        sourceName: args.sourceName,
        startedAt,
        finishedAt: new Date(),
        scanned: rows.length,
        moved,
        created,
        updated,
        skipped,
        failed,
        retiredEmpty,
        touched: touchedIds.length,
        before,
        after,
        netVisible: after.feedLive - before.feedLive,
        errors,
      },
      null,
      2
    )
  );
}

async function findMismatchRows(sourceName: string, limit: number) {
  return prisma.$queryRaw<MismatchRow[]>`
    SELECT
      njr.id AS "normalizedId",
      m."canonicalJobId" AS "oldCanonicalId"
    FROM "JobSourceMapping" m
    JOIN "JobRaw" r ON r.id = m."rawJobId"
    JOIN "NormalizedJobRecord" njr ON njr."rawJobId" = r.id
    JOIN "JobCanonical" jc ON jc.id = m."canonicalJobId"
    WHERE m."sourceName" = ${sourceName}
      AND m."removedAt" IS NULL
      AND njr.status <> 'REJECTED'
      AND jc.status <> 'REMOVED'
      AND (
        jc."locationKey" IS DISTINCT FROM njr."locationKey"
        OR jc."titleCoreKey" IS DISTINCT FROM njr."titleCoreKey"
      )
    ORDER BY m."lastSeenAt" DESC
    LIMIT ${limit}
  `;
}

async function readStats(sourceName: string) {
  const [feedLive, canonicalLive, sourceLive, remaining, guardrails] =
    await Promise.all([
      prisma.jobFeedIndex.count({ where: { status: "LIVE" } }),
      prisma.jobCanonical.count({ where: { status: "LIVE" } }),
      prisma.$queryRaw<Array<{ source_live: number }>>`
        SELECT count(DISTINCT m."canonicalJobId")::int AS source_live
        FROM "JobSourceMapping" m
        JOIN "JobFeedIndex" jfi
          ON jfi."canonicalJobId" = m."canonicalJobId"
         AND jfi.status = 'LIVE'
        WHERE m."sourceName" = ${sourceName}
          AND m."removedAt" IS NULL
      `,
      prisma.$queryRaw<Array<{ mismatched: number }>>`
        SELECT count(*)::int AS mismatched
        FROM "JobSourceMapping" m
        JOIN "JobRaw" r ON r.id = m."rawJobId"
        JOIN "NormalizedJobRecord" njr ON njr."rawJobId" = r.id
        JOIN "JobCanonical" jc ON jc.id = m."canonicalJobId"
        WHERE m."sourceName" = ${sourceName}
          AND m."removedAt" IS NULL
          AND njr.status <> 'REJECTED'
          AND jc.status <> 'REMOVED'
          AND (
            jc."locationKey" IS DISTINCT FROM njr."locationKey"
            OR jc."titleCoreKey" IS DISTINCT FROM njr."titleCoreKey"
          )
      `,
      prisma.$queryRaw<
        Array<{ jooblePrimaryLive: number; weakApplyLive: number }>
      >`
        SELECT
          (
            SELECT count(DISTINCT jfi."canonicalJobId")::int
            FROM "JobFeedIndex" jfi
            JOIN "JobSourceMapping" jsm
              ON jsm."canonicalJobId" = jfi."canonicalJobId"
             AND jsm."removedAt" IS NULL
             AND jsm."isPrimary" = true
            WHERE jfi.status = 'LIVE'
              AND split_part(jsm."sourceName", ':', 1) = 'Jooble'
          ) AS "jooblePrimaryLive",
          (
            SELECT count(*) FILTER (WHERE jfi.status = 'LIVE')::int
            FROM "JobCanonical" j
            LEFT JOIN "JobFeedIndex" jfi ON jfi."canonicalJobId" = j.id
            WHERE j."applyUrl" ~* 'https?://([^/]+\\.)?(jooble\\.org|jobgether\\.com|jobillico\\.com)(/|$)'
          ) AS "weakApplyLive"
      `,
    ]);

  return {
    feedLive,
    canonicalLive,
    sourceLive: sourceLive[0]?.source_live ?? 0,
    remainingMismatch: remaining[0]?.mismatched ?? 0,
    guardrails: guardrails[0] ?? { jooblePrimaryLive: 0, weakApplyLive: 0 },
  };
}

async function refreshPrimarySourceMapping(canonicalJobId: string) {
  const primary = await prisma.jobSourceMapping.findFirst({
    where: { canonicalJobId, removedAt: null },
    orderBy: [
      { sourceQualityRank: "desc" },
      { lastSeenAt: "desc" },
      { createdAt: "asc" },
    ],
    select: { id: true },
  });

  await prisma.jobSourceMapping.updateMany({
    where: { canonicalJobId },
    data: { isPrimary: false },
  });

  if (primary) {
    await prisma.jobSourceMapping.update({
      where: { id: primary.id },
      data: { isPrimary: true },
    });
  }
}

async function retireEmptyCanonicals(canonicalJobIds: string[], now: Date) {
  if (canonicalJobIds.length === 0) return 0;

  const rows = await prisma.jobCanonical.findMany({
    where: { id: { in: canonicalJobIds } },
    select: {
      id: true,
      _count: {
        select: {
          sourceMappings: {
            where: { removedAt: null },
          },
        },
      },
    },
  });

  const emptyIds = rows
    .filter((row) => row._count.sourceMappings === 0)
    .map((row) => row.id);
  if (emptyIds.length === 0) return 0;

  await prisma.jobCanonical.updateMany({
    where: { id: { in: emptyIds } },
    data: {
      status: "REMOVED",
      availabilityScore: 0,
      removedAt: now,
      deadSignalAt: now,
      deadSignalReason:
        "Official source mapping was split into a more accurate canonical job.",
    },
  });

  return emptyIds.length;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    sourceName: "",
    limit: DEFAULT_LIMIT,
    concurrency: DEFAULT_CONCURRENCY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--source" && next) {
      args.sourceName = next;
      index += 1;
    } else if (arg.startsWith("--source=")) {
      args.sourceName = arg.slice("--source=".length);
    } else if (arg === "--limit" && next) {
      args.limit = parsePositiveInt(next, "--limit");
      index += 1;
    } else if (arg.startsWith("--limit=")) {
      args.limit = parsePositiveInt(arg.slice("--limit=".length), "--limit");
    } else if (arg === "--concurrency" && next) {
      args.concurrency = parsePositiveInt(next, "--concurrency");
      index += 1;
    } else if (arg.startsWith("--concurrency=")) {
      args.concurrency = parsePositiveInt(
        arg.slice("--concurrency=".length),
        "--concurrency"
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.sourceName) {
    throw new Error("--source is required, for example --source OfficialCompany:Amazon");
  }

  return args;
}

function parsePositiveInt(raw: string, flag: string) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
