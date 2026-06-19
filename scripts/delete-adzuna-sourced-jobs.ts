import "dotenv/config";

process.env.DATABASE_PROCESS_ROLE ??= "adzuna_cleanup";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "30000";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  parseSourceConnectorJobFromRawPayload,
} from "@/lib/ingestion/normalized-records";
import { normalizeSourceJob } from "@/lib/ingestion/normalize";
import { computeNormalizedQualityScore } from "@/lib/ingestion/quality";
import { upsertJobFeedIndex } from "@/lib/ingestion/search-index";
import type { NormalizedJobInput } from "@/lib/ingestion/types";

type Args = {
  apply: boolean;
  batchSize: number;
  repairLimit: number;
};

type CanonicalWithMappings = Prisma.JobCanonicalGetPayload<{
  include: {
    sourceMappings: {
      include: {
        rawJob: true;
      };
    };
  };
}>;

type BestSource = {
  mappingId: string;
  sourceName: string;
  score: number;
  normalizedJob: NormalizedJobInput;
};

function readNumberArg(argv: string[], name: string, fallback: number) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const index = argv.findIndex((arg) => arg === name);
  const raw = inline ?? (index >= 0 ? argv[index + 1] : undefined);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv: string[]): Args {
  return {
    apply: argv.includes("--apply"),
    batchSize: readNumberArg(argv, "--batch-size", 500),
    repairLimit: readNumberArg(argv, "--repair-limit", 5000),
  };
}

function toCount(rows: Array<{ count: number | bigint }>) {
  return Number(rows[0]?.count ?? 0);
}

async function countState() {
  const [
    activeMappings,
    rawRows,
    adzunaMappedCanonicals,
    adzunaOnlyCanonicals,
    adzunaApplyUrlCanonicals,
    feedRows,
    sourceRows,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "JobSourceMapping"
      WHERE "sourceName" ILIKE 'Adzuna%'
        AND "removedAt" IS NULL
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "JobRaw"
      WHERE "sourceName" ILIKE 'Adzuna%'
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT "canonicalJobId")::int AS count
      FROM "JobSourceMapping"
      WHERE "sourceName" ILIKE 'Adzuna%'
        AND "removedAt" IS NULL
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      WITH impacted AS (
        SELECT DISTINCT "canonicalJobId"
        FROM "JobSourceMapping"
        WHERE "sourceName" ILIKE 'Adzuna%'
          AND "removedAt" IS NULL
      )
      SELECT COUNT(*)::int AS count
      FROM impacted i
      WHERE NOT EXISTS (
        SELECT 1
        FROM "JobSourceMapping" other
        WHERE other."canonicalJobId" = i."canonicalJobId"
          AND other."removedAt" IS NULL
          AND other."sourceName" NOT ILIKE 'Adzuna%'
      )
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "JobCanonical"
      WHERE "applyUrl" ILIKE '%adzuna%'
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "JobFeedIndex"
      WHERE "canonicalJobId" IN (
        SELECT DISTINCT "canonicalJobId"
        FROM "JobSourceMapping"
        WHERE "sourceName" ILIKE 'Adzuna%'
          AND "removedAt" IS NULL
      )
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "CompanySource"
      WHERE "connectorName" ILIKE 'adzuna'
         OR "sourceName" ILIKE 'Adzuna%'
    `,
  ]);

  return {
    activeMappings: toCount(activeMappings),
    rawRows: toCount(rawRows),
    adzunaMappedCanonicals: toCount(adzunaMappedCanonicals),
    adzunaOnlyCanonicals: toCount(adzunaOnlyCanonicals),
    adzunaApplyUrlCanonicals: toCount(adzunaApplyUrlCanonicals),
    feedRows: toCount(feedRows),
    sourceRows: toCount(sourceRows),
  };
}

async function loadRepairCandidates(limit: number) {
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT jc.id
    FROM "JobCanonical" jc
    WHERE (
        jc."applyUrl" ILIKE '%adzuna%'
        OR EXISTS (
          SELECT 1
          FROM "JobSourceMapping" adzuna
          WHERE adzuna."canonicalJobId" = jc.id
            AND adzuna."removedAt" IS NULL
            AND adzuna."sourceName" ILIKE 'Adzuna%'
        )
      )
      AND EXISTS (
        SELECT 1
        FROM "JobSourceMapping" other
        WHERE other."canonicalJobId" = jc.id
          AND other."removedAt" IS NULL
          AND other."sourceName" NOT ILIKE 'Adzuna%'
      )
    ORDER BY jc."updatedAt" DESC
    LIMIT ${limit}
  `;

  if (ids.length === 0) return [];

  return prisma.jobCanonical.findMany({
    where: { id: { in: ids.map((row) => row.id) } },
    include: {
      sourceMappings: {
        where: {
          removedAt: null,
          sourceName: { not: { startsWith: "Adzuna" } },
        },
        include: { rawJob: true },
      },
    },
  });
}

function findBestNonAdzunaSource(job: CanonicalWithMappings): BestSource | null {
  const best = job.sourceMappings
    .map((mapping) => {
      try {
        if (mapping.rawJob.sourceName.toLowerCase().startsWith("adzuna")) return null;

        const sourceJob = parseSourceConnectorJobFromRawPayload({
          sourceName: mapping.rawJob.sourceName,
          sourceId: mapping.rawJob.sourceId,
          rawPayload: mapping.rawJob.rawPayload,
        });
        const normalized = normalizeSourceJob({
          job: sourceJob,
          fetchedAt: mapping.rawJob.fetchedAt,
        });
        if (normalized.kind === "rejected") return null;

        return {
          mappingId: mapping.id,
          sourceName: mapping.rawJob.sourceName,
          normalizedJob: normalized.job,
          score:
            mapping.sourceQualityRank +
            Math.min(200, normalized.job.description.length / 20) +
            computeNormalizedQualityScore(normalized.job),
        } satisfies BestSource;
      } catch {
        return null;
      }
    })
    .filter((value): value is BestSource => value != null)
    .sort((left, right) => right.score - left.score);

  return best[0] ?? null;
}

async function repairCanonicalFromBestSource(job: CanonicalWithMappings, best: BestSource) {
  const normalizedJob = best.normalizedJob;
  await prisma.jobCanonical.update({
    where: { id: job.id },
    data: {
      title: normalizedJob.title,
      displayTitle: normalizedJob.displayTitle,
      titleConfidence: normalizedJob.titleConfidence,
      titleStatus: normalizedJob.titleStatus,
      titleSource: normalizedJob.titleSource,
      titleCandidatesJson: normalizedJob.titleCandidatesJson,
      titleRejectedFragmentsJson: normalizedJob.titleRejectedFragmentsJson,
      titleExtractionWarnings: normalizedJob.titleExtractionWarnings,
      jobPageType: normalizedJob.jobPageType,
      company: normalizedJob.company,
      companyKey: normalizedJob.companyKey,
      titleKey: normalizedJob.titleKey,
      titleCoreKey: normalizedJob.titleCoreKey,
      descriptionFingerprint: normalizedJob.descriptionFingerprint,
      location: normalizedJob.location,
      locationConfidence: normalizedJob.locationConfidence,
      locationStatus: normalizedJob.locationStatus,
      locationSource: normalizedJob.locationSource,
      locationCandidatesJson: normalizedJob.locationCandidatesJson,
      locationKey: normalizedJob.locationKey,
      region: normalizedJob.region,
      workMode: normalizedJob.workMode,
      workModeConfidence: normalizedJob.workModeConfidence,
      workModeStatus: normalizedJob.workModeStatus,
      workModeSource: normalizedJob.workModeSource,
      workModeCandidatesJson: normalizedJob.workModeCandidatesJson,
      salaryMin: normalizedJob.salaryMin,
      salaryMax: normalizedJob.salaryMax,
      salaryCurrency: normalizedJob.salaryCurrency,
      salaryStatus: normalizedJob.salaryStatus,
      salaryPeriod: normalizedJob.salaryPeriod,
      salaryRawText: normalizedJob.salaryRawText,
      salaryConfidence: normalizedJob.salaryConfidence,
      salarySource: normalizedJob.salarySource,
      employmentType: normalizedJob.employmentType,
      employmentTypeGroup: normalizedJob.employmentTypeGroup,
      employmentTypeConfidence: normalizedJob.employmentTypeConfidence,
      employmentTypeStatus: normalizedJob.employmentTypeStatus,
      employmentTypeSource: normalizedJob.employmentTypeSource,
      employmentTypeCandidatesJson: normalizedJob.employmentTypeCandidatesJson,
      experienceLevel: normalizedJob.experienceLevel,
      experienceLevelGroup: normalizedJob.experienceLevelGroup,
      experienceLevelSource: normalizedJob.experienceLevelSource,
      experienceLevelEvidenceJson: normalizedJob.experienceLevelEvidenceJson,
      experienceLevelWarningsJson: normalizedJob.experienceLevelWarningsJson,
      description: normalizedJob.description,
      descriptionStatus: normalizedJob.descriptionStatus,
      descriptionConfidence: normalizedJob.descriptionConfidence,
      descriptionWordCount: normalizedJob.descriptionWordCount,
      shortSummary: normalizedJob.shortSummary,
      industry: normalizedJob.industry,
      roleFamily: normalizedJob.roleFamily,
      normalizedEmploymentType: normalizedJob.normalizedEmploymentType,
      normalizedEmploymentTypeConfidence:
        normalizedJob.normalizedEmploymentTypeConfidence,
      normalizedCareerStage: normalizedJob.normalizedCareerStage,
      normalizedCareerStageConfidence:
        normalizedJob.normalizedCareerStageConfidence,
      normalizedIndustry: normalizedJob.normalizedIndustry,
      normalizedIndustries: normalizedJob.normalizedIndustries,
      normalizedIndustryConfidence: normalizedJob.normalizedIndustryConfidence,
      normalizedRoleCategory: normalizedJob.normalizedRoleCategory,
      normalizedRoleCategoryConfidence:
        normalizedJob.normalizedRoleCategoryConfidence,
      normalizedRoleCategoryGroup: normalizedJob.normalizedRoleCategoryGroup,
      normalizedRoleCategoryStatus: normalizedJob.normalizedRoleCategoryStatus,
      normalizedRoleCategorySource: normalizedJob.normalizedRoleCategorySource,
      normalizedRoleCategoryCandidatesJson:
        normalizedJob.normalizedRoleCategoryCandidatesJson,
      normalizedRoleCategoryEvidenceJson:
        normalizedJob.normalizedRoleCategoryEvidenceJson,
      normalizedRoleCategoryWarningsJson:
        normalizedJob.normalizedRoleCategoryWarningsJson,
      classificationStatus: normalizedJob.classificationStatus,
      applyUrl: normalizedJob.applyUrl,
      applyUrlKey: normalizedJob.applyUrlKey,
      postedAt: normalizedJob.postedAt,
      datePostedConfidence: normalizedJob.datePostedConfidence,
      datePostedStatus: normalizedJob.datePostedStatus,
      datePostedSource: normalizedJob.datePostedSource,
      datePostedRawText: normalizedJob.datePostedRawText,
      deadline: normalizedJob.deadline,
      applicationDeadlineConfidence:
        normalizedJob.applicationDeadlineConfidence,
      applicationDeadlineStatus: normalizedJob.applicationDeadlineStatus,
      applicationDeadlineSource: normalizedJob.applicationDeadlineSource,
      applicationDeadlineRawText: normalizedJob.applicationDeadlineRawText,
      extractionWarnings: normalizedJob.extractionWarnings,
      extractionRejectionReasons: normalizedJob.extractionRejectionReasons,
      metadataExtractionWarnings: normalizedJob.metadataExtractionWarnings,
      duplicateClusterId: normalizedJob.duplicateClusterId,
      qualityScore: computeNormalizedQualityScore(normalizedJob),
    },
  });

  await prisma.jobSourceMapping.updateMany({
    where: { canonicalJobId: job.id },
    data: { isPrimary: false },
  });
  await prisma.jobSourceMapping.update({
    where: { id: best.mappingId },
    data: { isPrimary: true },
  });
  await upsertJobFeedIndex(job.id);
}

async function repairMultiSourceJobs(args: Args) {
  let scanned = 0;
  let repaired = 0;
  let skipped = 0;
  const candidates = await loadRepairCandidates(args.repairLimit);

  for (const candidate of candidates) {
    scanned += 1;
    const best = findBestNonAdzunaSource(candidate);
    if (!best) {
      skipped += 1;
      continue;
    }

    repaired += 1;
    if (args.apply) {
      await repairCanonicalFromBestSource(candidate, best);
    }

    if (scanned % 50 === 0) {
      console.log(JSON.stringify({ step: "repair-multisource", scanned, repaired, skipped }));
    }
  }

  return { scanned, repaired, skipped };
}

async function deleteAdzunaOnlyCanonicals(batchSize: number, apply: boolean) {
  let deleted = 0;
  let batches = 0;

  for (;;) {
    const rows = apply
      ? await prisma.$queryRaw<Array<{ count: number }>>`
          WITH targets AS (
            SELECT jc.id
            FROM "JobCanonical" jc
            WHERE (
                jc."applyUrl" ILIKE '%adzuna%'
                OR EXISTS (
                  SELECT 1
                  FROM "JobSourceMapping" adzuna
                  WHERE adzuna."canonicalJobId" = jc.id
                    AND adzuna."removedAt" IS NULL
                    AND adzuna."sourceName" ILIKE 'Adzuna%'
                )
              )
              AND (
                jc."applyUrl" ILIKE '%adzuna%'
                OR NOT EXISTS (
                  SELECT 1
                  FROM "JobSourceMapping" other
                  WHERE other."canonicalJobId" = jc.id
                    AND other."removedAt" IS NULL
                    AND other."sourceName" NOT ILIKE 'Adzuna%'
                )
              )
            ORDER BY jc.id
            LIMIT ${batchSize}
          ),
          deleted AS (
            DELETE FROM "JobCanonical" jc
            USING targets
            WHERE jc.id = targets.id
            RETURNING 1
          )
          SELECT COUNT(*)::int AS count FROM deleted
        `
      : await prisma.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*)::int AS count
          FROM "JobCanonical" jc
          WHERE (
              jc."applyUrl" ILIKE '%adzuna%'
              OR EXISTS (
                SELECT 1
                FROM "JobSourceMapping" adzuna
                WHERE adzuna."canonicalJobId" = jc.id
                  AND adzuna."removedAt" IS NULL
                  AND adzuna."sourceName" ILIKE 'Adzuna%'
              )
            )
            AND (
              jc."applyUrl" ILIKE '%adzuna%'
              OR NOT EXISTS (
                SELECT 1
                FROM "JobSourceMapping" other
                WHERE other."canonicalJobId" = jc.id
                  AND other."removedAt" IS NULL
                  AND other."sourceName" NOT ILIKE 'Adzuna%'
              )
            )
        `;

    const count = toCount(rows);
    deleted += count;
    batches += 1;
    console.log(JSON.stringify({ step: "delete-canonicals", batch: batches, count, deleted }));
    if (!apply || count < batchSize) break;
  }

  return { deleted, batches };
}

async function deleteAdzunaRawJobs(batchSize: number, apply: boolean) {
  let deleted = 0;
  let batches = 0;

  for (;;) {
    const rows = apply
      ? await prisma.$queryRaw<Array<{ count: number }>>`
          WITH targets AS (
            SELECT id
            FROM "JobRaw"
            WHERE "sourceName" ILIKE 'Adzuna%'
            ORDER BY id
            LIMIT ${batchSize}
          ),
          deleted AS (
            DELETE FROM "JobRaw" raw
            USING targets
            WHERE raw.id = targets.id
            RETURNING 1
          )
          SELECT COUNT(*)::int AS count FROM deleted
        `
      : await prisma.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*)::int AS count
          FROM "JobRaw"
          WHERE "sourceName" ILIKE 'Adzuna%'
        `;

    const count = toCount(rows);
    deleted += count;
    batches += 1;
    console.log(JSON.stringify({ step: "delete-raw", batch: batches, count, deleted }));
    if (!apply || count < batchSize) break;
  }

  return { deleted, batches };
}

async function disableAdzunaSourceRows(apply: boolean) {
  if (!apply) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "CompanySource"
      WHERE "connectorName" ILIKE 'adzuna'
         OR "sourceName" ILIKE 'Adzuna%'
    `;
    return toCount(rows);
  }

  const result = await prisma.companySource.updateMany({
    where: {
      OR: [
        { connectorName: { equals: "adzuna", mode: "insensitive" } },
        { sourceName: { startsWith: "Adzuna", mode: "insensitive" } },
      ],
    },
    data: {
      status: "DISABLED",
      validationState: "SUSPECT",
      pollState: "DISABLED",
    },
  });

  return result.count;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const before = await countState();
  const disabledSourceRows = await disableAdzunaSourceRows(args.apply);
  const repair = await repairMultiSourceJobs(args);
  const canonicalDeletion = await deleteAdzunaOnlyCanonicals(args.batchSize, args.apply);
  const rawDeletion = await deleteAdzunaRawJobs(args.batchSize, args.apply);
  const after = await countState();

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "apply" : "dry-run",
        before,
        disabledSourceRows,
        repair,
        canonicalDeletion,
        rawDeletion,
        after,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(
      "Failed to delete Adzuna-sourced jobs:",
      error instanceof Error ? error.stack ?? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
