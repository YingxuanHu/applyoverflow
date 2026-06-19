import "dotenv/config";

import { prisma } from "@/lib/db";
import { normalizeApplyUrlKey } from "@/lib/ingestion/dedupe";

type Args = {
  apply: boolean;
  limit: number;
  batchSize: number;
};

const GENERIC_APPLY_PATH_PATTERNS = [
  /\/talentcommunity\/apply\//i,
] satisfies RegExp[];

const GENERIC_ROOT_PATH_RE = /^\/(?:jobs?|careers?)\/?$/i;
const GENERIC_SEARCH_PATH_RE = /^\/(?:jobs?|careers?)\/search\/?$/i;
const JOB_DETAIL_MARKER_RE =
  /\/(?:job|jobs|career|careers|position|positions|opening|openings|job-detail|job_detail|requisition|requisitions)\//i;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let scanned = 0;
  let repaired = 0;
  let skippedNoSource = 0;
  let cursor: string | undefined;

  console.log("[repair-generic-apply-urls] starting", args);

  while (scanned < args.limit) {
    const jobs = await fetchRepairCandidates({
      cursor,
      limit: Math.min(args.batchSize, args.limit - scanned),
    });

    if (jobs.length === 0) break;

    const repairRows: Array<{ id: string; sourceUrl: string; applyUrlKey: string | null }> = [];
    for (const job of jobs) {
      scanned += 1;
      cursor = job.id;
      if (!job.sourceUrl || !isUsefulDetailUrl(job.sourceUrl)) {
        skippedNoSource += 1;
        continue;
      }

      if (!args.apply) {
        repaired += 1;
        repairRows.push({
          id: job.id,
          sourceUrl: job.sourceUrl,
          applyUrlKey: normalizeApplyUrlKey(job.sourceUrl),
        });
        continue;
      }

      repairRows.push({
        id: job.id,
        sourceUrl: job.sourceUrl,
        applyUrlKey: normalizeApplyUrlKey(job.sourceUrl),
      });
      repaired += 1;
    }

    if (args.apply && repairRows.length > 0) {
      await applyRepairRows(repairRows);
    }

    console.log("[repair-generic-apply-urls] batch", {
      scanned,
      repaired,
      skippedNoSource,
      updatedInBatch: repairRows.length,
      cursor,
    });
  }

  console.log("[repair-generic-apply-urls] done", {
    scanned,
    repaired,
    skippedNoSource,
    mode: args.apply ? "applied" : "dry-run",
  });
}

async function applyRepairRows(
  rows: Array<{ id: string; sourceUrl: string; applyUrlKey: string | null }>
) {
  const payload = JSON.stringify(rows);
  await prisma.$executeRaw`
    WITH input AS (
      SELECT *
      FROM jsonb_to_recordset(CAST(${payload} AS jsonb))
        AS x(id text, "sourceUrl" text, "applyUrlKey" text)
    ),
    canonical_updates AS (
      UPDATE "JobCanonical" j
      SET
        "applyUrl" = input."sourceUrl",
        "applyUrlKey" = input."applyUrlKey",
        "applyUrlValidationStatus" = NULL,
        "applyUrlValidationReason" = 'Generic apply URL replaced with source detail URL.',
        "applyUrlValidatedAt" = NULL,
        "finalResolvedApplyUrl" = NULL,
        "applyUrlRedirectDepth" = NULL,
        "deadSignalAt" = NULL,
        "deadSignalReason" = NULL,
        "updatedAt" = NOW()
      FROM input
      WHERE j.id = input.id
      RETURNING j.id
    )
    UPDATE "JobFeedIndex" f
    SET
      "applyUrl" = input."sourceUrl",
      "updatedAt" = NOW()
    FROM input
    WHERE f."canonicalJobId" = input.id
  `;
}

async function fetchRepairCandidates(input: { cursor?: string; limit: number }) {
  return prisma.$queryRaw<Array<{ id: string; sourceUrl: string | null }>>`
    SELECT
      f."canonicalJobId" AS id,
      (
        SELECT m."sourceUrl"
        FROM "JobSourceMapping" m
        WHERE m."canonicalJobId" = f."canonicalJobId"
          AND m."removedAt" IS NULL
          AND m."sourceUrl" IS NOT NULL
          AND m."sourceUrl" !~* '/talentcommunity/apply/'
          AND m."sourceUrl" ~* '/(job|jobs|career|careers|position|positions|opening|openings|job-detail|job_detail|requisition|requisitions)/'
          AND m."sourceUrl" !~* '/(jobs|careers)/?$'
          AND m."sourceUrl" !~* '/(jobs|careers)/search/?$'
        ORDER BY m."isPrimary" DESC, m."sourceQualityRank" DESC, m."lastSeenAt" DESC
        LIMIT 1
      ) AS "sourceUrl"
    FROM "JobFeedIndex" f
    WHERE f.status = 'LIVE'
      AND (${input.cursor ?? ""} = '' OR f."canonicalJobId" > ${input.cursor ?? ""})
      AND f."applyUrl" ILIKE '%/talentcommunity/apply/%'
    ORDER BY f."canonicalJobId" ASC
    LIMIT ${input.limit}
  `;
}

function isUsefulDetailUrl(url: string) {
  if (isGenericApplyUrl(url)) return false;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    if (GENERIC_ROOT_PATH_RE.test(parsed.pathname)) return false;
    if (GENERIC_SEARCH_PATH_RE.test(parsed.pathname)) return false;
    if (parsed.searchParams.has("job_id") || parsed.searchParams.has("jobId")) return true;
    if (parsed.searchParams.has("gh_jid") || parsed.searchParams.has("jobReqId")) return true;
    return JOB_DETAIL_MARKER_RE.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isGenericApplyUrl(url: string) {
  return GENERIC_APPLY_PATH_PATTERNS.some((pattern) => pattern.test(url));
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    limit: 50_000,
    batchSize: 1_000,
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg.startsWith("--limit=")) {
      args.limit = parsePositiveInt(arg.slice("--limit=".length), args.limit);
    } else if (arg.startsWith("--batch-size=")) {
      args.batchSize = parsePositiveInt(arg.slice("--batch-size=".length), args.batchSize);
    }
  }

  return args;
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main()
  .catch((error) => {
    console.error("[repair-generic-apply-urls] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
