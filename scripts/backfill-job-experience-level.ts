import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { extractExperienceLevel } from "@/lib/experience-level";
import { parseSourceConnectorJobFromRawPayload } from "@/lib/ingestion/normalized-records";
import { upsertJobFeedIndex } from "@/lib/ingestion/search-index";

type Options = {
  dryRun: boolean;
  limit: number | null;
  batchSize: number;
  onlyMissing: boolean;
  force: boolean;
  refreshIndex: boolean;
  skipFeedIndex: boolean;
  syncFeedOnly: boolean;
  skipRaw: boolean;
};

type Distribution = Map<string, number>;

type ExperienceUpdate = {
  id: string;
  experienceLevel: string;
  experienceLevelGroup: string;
  experienceLevelSource: string;
  experienceLevelEvidenceJson: string[];
  experienceLevelWarningsJson: string[];
  normalizedCareerStage: string;
  normalizedCareerStageConfidence: number;
};

const options = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  if (options.syncFeedOnly) {
    await syncFeedIndexFromCanonical();
    return;
  }

  const startedAt = Date.now();
  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedNoInput = 0;
  let cursor: string | undefined;
  let batch = 0;

  const stageCounts: Distribution = new Map();
  const groupCounts: Distribution = new Map();
  const sourceCounts: Distribution = new Map();
  const warningCounts: Distribution = new Map();
  const examples: Array<Record<string, unknown>> = [];

  while (options.limit === null || scanned < options.limit) {
    const remaining =
      options.limit === null
        ? options.batchSize
        : Math.min(options.batchSize, options.limit - scanned);
    if (remaining <= 0) break;

    const jobs = await prisma.jobCanonical.findMany({
      where: buildWhere(options, cursor),
      orderBy: { id: "asc" },
      take: remaining,
      select: {
        id: true,
        title: true,
        displayTitle: true,
        company: true,
        description: true,
        shortSummary: true,
        employmentType: true,
        normalizedEmploymentType: true,
        experienceLevel: true,
        experienceLevelGroup: true,
        experienceLevelSource: true,
        experienceLevelEvidenceJson: true,
        experienceLevelWarningsJson: true,
        normalizedCareerStage: true,
        normalizedCareerStageConfidence: true,
        industry: true,
        roleFamily: true,
        sourceMappings: options.skipRaw
          ? false
          : {
              where: { removedAt: null },
              orderBy: [
                { isPrimary: "desc" },
                { sourceQualityRank: "desc" },
                { lastSeenAt: "desc" },
              ],
              take: 1,
              select: {
                rawJob: {
                  select: {
                    sourceName: true,
                    sourceId: true,
                    rawPayload: true,
                  },
                },
              },
            },
      },
    });

    if (jobs.length === 0) break;
    batch += 1;
    cursor = jobs[jobs.length - 1]?.id;
    const batchUpdates: ExperienceUpdate[] = [];

    for (const job of jobs) {
      scanned += 1;
      const sourceMappings = (job as unknown as {
        sourceMappings?: Array<{
          rawJob: {
            sourceName: string;
            sourceId: string;
            rawPayload: Prisma.JsonValue;
          } | null;
        }>;
      }).sourceMappings;
      const rawSourceJob = options.skipRaw ? null : safeParseRawSourceJob(sourceMappings?.[0]?.rawJob);
      const sourceMetadata = rawSourceJob?.metadata ?? null;
      const rawTitle = rawSourceJob?.title ?? job.displayTitle ?? null;
      const description = job.description || job.shortSummary;

      if (!job.title && !rawTitle && !description) {
        skippedNoInput += 1;
        continue;
      }

      const result = extractExperienceLevel({
        title: job.title,
        rawTitle,
        description,
        employmentType: job.employmentType,
        normalizedEmploymentType: job.normalizedEmploymentType,
        roleFamily: job.roleFamily,
        industry: job.industry,
        sourceMetadata,
      });

      increment(stageCounts, result.normalizedCareerStage);
      increment(groupCounts, result.experienceLevelGroup);
      increment(sourceCounts, result.source);
      for (const warning of result.warnings) increment(warningCounts, warning);

      const changed =
        options.force ||
        job.experienceLevel !== result.experienceLevel ||
        job.experienceLevelGroup !== result.experienceLevelGroup ||
        job.experienceLevelSource !== result.source ||
        job.normalizedCareerStage !== result.normalizedCareerStage ||
        job.normalizedCareerStageConfidence !== result.confidence ||
        jsonChanged(job.experienceLevelEvidenceJson, result.evidence) ||
        jsonChanged(job.experienceLevelWarningsJson, result.warnings);

      if (!changed) {
        unchanged += 1;
        continue;
      }

      if (examples.length < 20) {
        examples.push({
          id: job.id,
          title: job.title,
          oldExperienceLevel: job.experienceLevel,
          oldStage: job.normalizedCareerStage,
          oldGroup: job.experienceLevelGroup,
          newExperienceLevel: result.experienceLevel,
          newStage: result.normalizedCareerStage,
          newGroup: result.experienceLevelGroup,
          confidence: result.confidence,
          evidence: result.evidence.slice(0, 3),
          warnings: result.warnings,
        });
      }

      batchUpdates.push({
        id: job.id,
        experienceLevel: result.experienceLevel,
        experienceLevelGroup: result.experienceLevelGroup,
        experienceLevelSource: result.source,
        experienceLevelEvidenceJson: safeStringArray(result.evidence),
        experienceLevelWarningsJson: safeStringArray(result.warnings),
        normalizedCareerStage: result.normalizedCareerStage,
        normalizedCareerStageConfidence: result.confidence,
      });

      updated += 1;
    }

    if (!options.dryRun && batchUpdates.length > 0) {
      await writeExperienceUpdates(batchUpdates, { updateFeedIndex: !options.skipFeedIndex });
      if (options.refreshIndex) {
        for (const row of batchUpdates) {
          await upsertJobFeedIndex(row.id);
        }
      }
    }

    if (!options.dryRun) {
      console.log(
        `[experience-backfill] batch ${batch} scanned=${scanned} updated=${updated} unchanged=${unchanged} skipped=${skippedNoInput}`
      );
    }
  }

  console.log(JSON.stringify(
    {
      dryRun: options.dryRun,
      scanned,
      updated,
      unchanged,
      skippedNoInput,
      stageDistribution: Object.fromEntries(stageCounts),
      groupDistribution: Object.fromEntries(groupCounts),
      sourceDistribution: Object.fromEntries(sourceCounts),
      warningDistribution: Object.fromEntries(warningCounts),
      examples,
      elapsedMs: Date.now() - startedAt,
    },
    null,
    2
  ));
}

function buildWhere(options: Options, afterId?: string): Prisma.JobCanonicalWhereInput {
  const clauses: Prisma.JobCanonicalWhereInput[] = [];

  if (afterId) {
    clauses.push({ id: { gt: afterId } });
  }

  if (options.force) {
    return clauses.length > 0 ? { AND: clauses } : {};
  }

  if (options.onlyMissing) {
    clauses.push({
      OR: [
        { normalizedCareerStage: null },
        { normalizedCareerStageConfidence: null },
        { experienceLevelGroup: null },
        { experienceLevelSource: null },
      ],
    });
  }

  return clauses.length > 0 ? { AND: clauses } : {};
}

async function writeExperienceUpdates(
  rows: ExperienceUpdate[],
  options: { updateFeedIndex: boolean }
) {
  if (rows.length === 0) return;

  const payload = JSON.stringify(rows);

  await prisma.$executeRaw`
        WITH updates (
          id,
          "experienceLevel",
          "experienceLevelGroup",
          "experienceLevelSource",
          "experienceLevelEvidenceJson",
          "experienceLevelWarningsJson",
          "normalizedCareerStage",
          "normalizedCareerStageConfidence"
        ) AS (
          SELECT *
          FROM jsonb_to_recordset(${payload}::jsonb) AS row (
            id text,
            "experienceLevel" text,
            "experienceLevelGroup" text,
            "experienceLevelSource" text,
            "experienceLevelEvidenceJson" jsonb,
            "experienceLevelWarningsJson" jsonb,
            "normalizedCareerStage" text,
            "normalizedCareerStageConfidence" double precision
          )
        )
        UPDATE "JobCanonical" AS job
        SET
          "experienceLevel" = updates."experienceLevel"::"ExperienceLevel",
          "experienceLevelGroup" = updates."experienceLevelGroup",
          "experienceLevelSource" = updates."experienceLevelSource",
          "experienceLevelEvidenceJson" = updates."experienceLevelEvidenceJson",
          "experienceLevelWarningsJson" = updates."experienceLevelWarningsJson",
          "normalizedCareerStage" = updates."normalizedCareerStage",
          "normalizedCareerStageConfidence" = updates."normalizedCareerStageConfidence"::double precision,
          "updatedAt" = NOW()
        FROM updates
        WHERE job.id = updates.id
      `;

  if (!options.updateFeedIndex) return;

  await prisma.$executeRaw`
        WITH updates (
          id,
          "experienceLevel",
          "experienceLevelGroup",
          "experienceLevelSource",
          "experienceLevelEvidenceJson",
          "experienceLevelWarningsJson",
          "normalizedCareerStage",
          "normalizedCareerStageConfidence"
        ) AS (
          SELECT *
          FROM jsonb_to_recordset(${payload}::jsonb) AS row (
            id text,
            "experienceLevel" text,
            "experienceLevelGroup" text,
            "experienceLevelSource" text,
            "experienceLevelEvidenceJson" jsonb,
            "experienceLevelWarningsJson" jsonb,
            "normalizedCareerStage" text,
            "normalizedCareerStageConfidence" double precision
          )
        )
        UPDATE "JobFeedIndex" AS feed
        SET
          "experienceLevel" = updates."experienceLevel"::"ExperienceLevel",
          "experienceLevelGroup" = updates."experienceLevelGroup",
          "experienceLevelSource" = updates."experienceLevelSource",
          "experienceLevelEvidenceJson" = updates."experienceLevelEvidenceJson",
          "experienceLevelWarningsJson" = updates."experienceLevelWarningsJson",
          "normalizedCareerStage" = updates."normalizedCareerStage",
          "normalizedCareerStageConfidence" = updates."normalizedCareerStageConfidence"::double precision,
          "indexedAt" = NOW()
        FROM updates
        WHERE feed."canonicalJobId" = updates.id
      `;
}

async function syncFeedIndexFromCanonical() {
  const startedAt = Date.now();
  let totalUpdated = 0;
  let batch = 0;

  while (options.limit === null || totalUpdated < options.limit) {
    const batchSize =
      options.limit === null
        ? options.batchSize
        : Math.min(options.batchSize, options.limit - totalUpdated);
    if (batchSize <= 0) break;

    const rows = await prisma.$queryRaw<Array<{ updated: number }>>`
      WITH batch AS (
        SELECT feed."canonicalJobId"
        FROM "JobFeedIndex" AS feed
        JOIN "JobCanonical" AS job ON job.id = feed."canonicalJobId"
        WHERE
          job."experienceLevelGroup" IS NOT NULL
          AND job."experienceLevelSource" IS NOT NULL
          AND (
            feed."experienceLevel" IS DISTINCT FROM job."experienceLevel"
            OR feed."experienceLevelGroup" IS DISTINCT FROM job."experienceLevelGroup"
            OR feed."experienceLevelSource" IS DISTINCT FROM job."experienceLevelSource"
            OR feed."experienceLevelEvidenceJson" IS DISTINCT FROM job."experienceLevelEvidenceJson"
            OR feed."experienceLevelWarningsJson" IS DISTINCT FROM job."experienceLevelWarningsJson"
            OR feed."normalizedCareerStage" IS DISTINCT FROM job."normalizedCareerStage"
            OR feed."normalizedCareerStageConfidence" IS DISTINCT FROM job."normalizedCareerStageConfidence"
          )
        ORDER BY feed."canonicalJobId"
        LIMIT ${batchSize}
      ),
      updated AS (
        UPDATE "JobFeedIndex" AS feed
        SET
          "experienceLevel" = job."experienceLevel",
          "experienceLevelGroup" = job."experienceLevelGroup",
          "experienceLevelSource" = job."experienceLevelSource",
          "experienceLevelEvidenceJson" = job."experienceLevelEvidenceJson",
          "experienceLevelWarningsJson" = job."experienceLevelWarningsJson",
          "normalizedCareerStage" = job."normalizedCareerStage",
          "normalizedCareerStageConfidence" = job."normalizedCareerStageConfidence",
          "indexedAt" = NOW()
        FROM "JobCanonical" AS job, batch
        WHERE feed."canonicalJobId" = batch."canonicalJobId"
          AND job.id = batch."canonicalJobId"
        RETURNING 1
      )
      SELECT COUNT(*)::int AS updated FROM updated
    `;

    const updated = Number(rows[0]?.updated ?? 0);
    if (updated === 0) break;

    batch += 1;
    totalUpdated += updated;
    console.log(`[experience-feed-sync] batch ${batch} updated=${updated} total=${totalUpdated}`);
  }

  console.log(JSON.stringify(
    {
      syncFeedOnly: true,
      updated: totalUpdated,
      elapsedMs: Date.now() - startedAt,
    },
    null,
    2
  ));
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    dryRun: false,
    limit: null,
    batchSize: 500,
    onlyMissing: false,
    force: false,
    refreshIndex: false,
    skipFeedIndex: false,
    syncFeedOnly: false,
    skipRaw: false,
  };

  for (const arg of args) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--only-missing") options.onlyMissing = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--refresh-index") options.refreshIndex = true;
    else if (arg === "--skip-feed-index") options.skipFeedIndex = true;
    else if (arg === "--sync-feed-only") options.syncFeedOnly = true;
    else if (arg === "--skip-raw") options.skipRaw = true;
    else if (arg.startsWith("--limit=")) {
      options.limit = parsePositiveInteger(arg.slice("--limit=".length), "limit");
    } else if (arg.startsWith("--batch-size=")) {
      options.batchSize = parsePositiveInteger(arg.slice("--batch-size=".length), "batch-size");
    }
  }

  return options;
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function increment(map: Distribution, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function jsonChanged(current: unknown, next: unknown) {
  return JSON.stringify(current ?? null) !== JSON.stringify(next ?? null);
}

function sanitizeJsonText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/g, "")
    .trim();
}

function safeStringArray(values: string[]) {
  return values.map(sanitizeJsonText).filter(Boolean);
}

function safeParseRawSourceJob(
  rawJob:
    | {
        sourceName: string;
        sourceId: string;
        rawPayload: Prisma.JsonValue;
      }
    | null
    | undefined
) {
  if (!rawJob) return null;
  try {
    return parseSourceConnectorJobFromRawPayload({
      sourceName: rawJob.sourceName,
      sourceId: rawJob.sourceId,
      rawPayload: rawJob.rawPayload,
    });
  } catch {
    return null;
  }
}
