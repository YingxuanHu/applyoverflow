import {
  EmploymentType,
  ExperienceLevel,
  Industry,
  Prisma,
  Region,
  WorkMode,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { normalizeSourceJob } from "@/lib/ingestion/normalize";
import { parseSourceConnectorJobFromRawPayload } from "@/lib/ingestion/normalized-records";
import { upsertJobFeedIndex } from "@/lib/ingestion/search-index";

type Options = {
  dryRun: boolean;
  limit: number | null;
  batchSize: number;
  onlyLowConfidence: boolean;
  onlyMissing: boolean;
  force: boolean;
  titleContains: string | null;
};

type Distribution = Map<string, number>;

const options = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const startedAt = Date.now();
  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedNoRaw = 0;
  let rejectedByNewExtraction = 0;
  let removedFromFeed = 0;
  let cursor: string | undefined;

  const titleStatusCounts: Distribution = new Map();
  const rejectionReasonCounts: Distribution = new Map();
  const warningCounts: Distribution = new Map();
  const changedExamples: Array<Record<string, unknown>> = [];
  const rejectedExamples: Array<Record<string, unknown>> = [];

  while (options.limit === null || scanned < options.limit) {
    const remaining =
      options.limit === null
        ? options.batchSize
        : Math.min(options.batchSize, options.limit - scanned);
    if (remaining <= 0) break;

    const jobs = await prisma.jobCanonical.findMany({
      where: buildWhere(options),
      orderBy: { id: "asc" },
      take: remaining,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        displayTitle: true,
        titleKey: true,
        titleCoreKey: true,
        titleConfidence: true,
        titleStatus: true,
        titleSource: true,
        titleCandidatesJson: true,
        titleRejectedFragmentsJson: true,
        titleExtractionWarnings: true,
        jobPageType: true,
        description: true,
        shortSummary: true,
        descriptionFingerprint: true,
        location: true,
        locationKey: true,
        locationConfidence: true,
        locationStatus: true,
        locationSource: true,
        locationCandidatesJson: true,
        region: true,
        workMode: true,
        workModeConfidence: true,
        workModeStatus: true,
        workModeSource: true,
        workModeCandidatesJson: true,
        employmentType: true,
        employmentTypeGroup: true,
        employmentTypeConfidence: true,
        employmentTypeStatus: true,
        employmentTypeSource: true,
        employmentTypeCandidatesJson: true,
        experienceLevel: true,
        industry: true,
        roleFamily: true,
        normalizedEmploymentType: true,
        normalizedEmploymentTypeConfidence: true,
        normalizedCareerStage: true,
        normalizedCareerStageConfidence: true,
        normalizedIndustry: true,
        normalizedIndustries: true,
        normalizedIndustryConfidence: true,
        normalizedRoleCategory: true,
        normalizedRoleCategoryConfidence: true,
        classificationStatus: true,
        extractionWarnings: true,
        extractionRejectionReasons: true,
        duplicateClusterId: true,
        sourceMappings: {
          where: { removedAt: null },
          orderBy: [
            { isPrimary: "desc" },
            { sourceQualityRank: "desc" },
            { lastSeenAt: "desc" },
          ],
          take: 1,
          select: {
            sourceName: true,
            sourceUrl: true,
            rawJob: {
              select: {
                sourceId: true,
                sourceName: true,
                rawPayload: true,
                fetchedAt: true,
              },
            },
          },
        },
      },
    });

    if (jobs.length === 0) break;
    cursor = jobs[jobs.length - 1]?.id;

    for (const job of jobs) {
      scanned += 1;
      const rawJob = job.sourceMappings[0]?.rawJob;
      if (!rawJob) {
        skippedNoRaw += 1;
        continue;
      }

      const sourceJob = parseSourceConnectorJobFromRawPayload({
        sourceName: rawJob.sourceName,
        sourceId: rawJob.sourceId,
        rawPayload: rawJob.rawPayload,
      });
      const normalized = normalizeSourceJob({
        job: sourceJob,
        fetchedAt: rawJob.fetchedAt,
        sourceName: rawJob.sourceName,
      });

      if (normalized.kind === "rejected") {
        rejectedByNewExtraction += 1;
        increment(rejectionReasonCounts, normalized.reason);
        if (rejectedExamples.length < 10) {
          rejectedExamples.push({
            id: job.id,
            beforeTitle: job.title,
            reason: normalized.reason,
            sourceName: rawJob.sourceName,
          });
        }
        if (!options.dryRun) {
          const result = await prisma.jobFeedIndex.updateMany({
            where: { canonicalJobId: job.id },
            data: {
              status: "REMOVED",
              extractionWarnings: appendJsonString(job.extractionWarnings, normalized.reason),
              indexedAt: new Date(),
            },
          });
          removedFromFeed += result.count;
        }
        continue;
      }

      const next = normalized.job;
      increment(titleStatusCounts, next.titleStatus ?? "missing");
      for (const warning of readStringArray(next.titleExtractionWarnings)) {
        increment(warningCounts, warning);
      }
      for (const reason of readStringArray(next.extractionRejectionReasons)) {
        increment(rejectionReasonCounts, reason);
      }

      const updateData = buildUpdateData(next);
      if (!options.force && !hasChanged(job, updateData)) {
        unchanged += 1;
        continue;
      }

      updated += 1;
      if (changedExamples.length < 15) {
        changedExamples.push({
          id: job.id,
          beforeTitle: job.title,
          afterTitle: next.title,
          displayTitle: next.displayTitle ?? null,
          titleStatus: `${job.titleStatus ?? "NULL"} -> ${next.titleStatus ?? "NULL"}`,
          titleConfidence: `${job.titleConfidence ?? "NULL"} -> ${next.titleConfidence ?? "NULL"}`,
          titleSource: next.titleSource ?? null,
          location: `${job.location} -> ${next.location}`,
          workMode: `${job.workMode} -> ${next.workMode}`,
          employmentTypeGroup: `${job.employmentTypeGroup ?? "NULL"} -> ${next.employmentTypeGroup ?? "NULL"}`,
          warnings: readStringArray(next.titleExtractionWarnings),
          rejectionReasons: readStringArray(next.extractionRejectionReasons),
        });
      }

      if (!options.dryRun) {
        await prisma.jobCanonical.update({
          where: { id: job.id },
          data: updateData,
        });
        await upsertJobFeedIndex(job.id);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: options.dryRun ? "dry-run" : "write",
        scanned,
        updated,
        unchanged,
        skippedNoRaw,
        rejectedByNewExtraction,
        removedFromFeed,
        elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
        titleStatusDistribution: mapToObject(titleStatusCounts),
        topRejectionReasons: topEntries(rejectionReasonCounts, 20),
        topWarnings: topEntries(warningCounts, 20),
        changedExamples,
        rejectedExamples,
      },
      null,
      2
    )
  );
}

function buildWhere(options: Options): Prisma.JobCanonicalWhereInput {
  const andClauses: Prisma.JobCanonicalWhereInput[] = [];
  if (options.titleContains) {
    andClauses.push({
      title: {
        contains: options.titleContains,
        mode: "insensitive",
      },
    });
  }

  const stateClauses: Prisma.JobCanonicalWhereInput[] = [];
  if (!options.force && options.onlyMissing) {
    stateClauses.push({
      OR: [
        { titleConfidence: null },
        { titleStatus: null },
        { titleSource: null },
        { titleCandidatesJson: { equals: Prisma.JsonNull } },
        { titleRejectedFragmentsJson: { equals: Prisma.JsonNull } },
        { titleExtractionWarnings: { equals: Prisma.JsonNull } },
        { jobPageType: null },
      ],
    });
  }
  if (!options.force && options.onlyLowConfidence) {
    stateClauses.push({
      OR: [
        { titleConfidence: null },
        { titleConfidence: { lt: 0.75 } },
        { titleStatus: { in: ["usable_review", "quarantine", "rejected", "missing"] } },
      ],
    });
  }

  if (stateClauses.length === 1) {
    andClauses.push(stateClauses[0]!);
  } else if (stateClauses.length > 1) {
    andClauses.push({ OR: stateClauses });
  }

  if (andClauses.length === 0) return {};
  if (andClauses.length === 1) return andClauses[0]!;
  return { AND: andClauses };
}

function buildUpdateData(next: {
  title: string;
  displayTitle?: string | null;
  titleKey: string;
  titleCoreKey: string;
  titleConfidence?: number | null;
  titleStatus?: string | null;
  titleSource?: string | null;
  titleCandidatesJson?: Prisma.InputJsonValue;
  titleRejectedFragmentsJson?: Prisma.InputJsonValue;
  titleExtractionWarnings?: Prisma.InputJsonValue;
  jobPageType?: string | null;
  description: string;
  shortSummary: string;
  descriptionFingerprint: string;
  location: string;
  locationKey: string;
  locationConfidence?: number | null;
  locationStatus?: string | null;
  locationSource?: string | null;
  locationCandidatesJson?: Prisma.InputJsonValue;
  region: "US" | "CA" | null;
  workMode: string;
  workModeConfidence?: number | null;
  workModeStatus?: string | null;
  workModeSource?: string | null;
  workModeCandidatesJson?: Prisma.InputJsonValue;
  employmentType: string;
  employmentTypeGroup?: string | null;
  employmentTypeConfidence?: number | null;
  employmentTypeStatus?: string | null;
  employmentTypeSource?: string | null;
  employmentTypeCandidatesJson?: Prisma.InputJsonValue;
  experienceLevel: string;
  industry: string | null;
  roleFamily: string;
  normalizedEmploymentType?: string | null;
  normalizedEmploymentTypeConfidence?: number | null;
  normalizedCareerStage?: string | null;
  normalizedCareerStageConfidence?: number | null;
  normalizedIndustry?: string | null;
  normalizedIndustries?: string[];
  normalizedIndustryConfidence?: number | null;
  normalizedRoleCategory?: string | null;
  normalizedRoleCategoryConfidence?: number | null;
  classificationStatus?: string | null;
  extractionWarnings?: Prisma.InputJsonValue;
  extractionRejectionReasons?: Prisma.InputJsonValue;
  duplicateClusterId: string;
}): Prisma.JobCanonicalUpdateInput {
  return {
    title: next.title,
    displayTitle: next.displayTitle ?? null,
    titleKey: next.titleKey,
    titleCoreKey: next.titleCoreKey,
    titleConfidence: next.titleConfidence ?? null,
    titleStatus: next.titleStatus ?? null,
    titleSource: next.titleSource ?? null,
    titleCandidatesJson: next.titleCandidatesJson ?? Prisma.JsonNull,
    titleRejectedFragmentsJson: next.titleRejectedFragmentsJson ?? Prisma.JsonNull,
    titleExtractionWarnings: next.titleExtractionWarnings ?? Prisma.JsonNull,
    jobPageType: next.jobPageType ?? "unknown",
    description: next.description,
    shortSummary: next.shortSummary,
    descriptionFingerprint: next.descriptionFingerprint,
    location: next.location,
    locationKey: next.locationKey,
    locationConfidence: next.locationConfidence ?? null,
    locationStatus: next.locationStatus ?? null,
    locationSource: next.locationSource ?? null,
    locationCandidatesJson: next.locationCandidatesJson ?? Prisma.JsonNull,
    region: next.region as Region | null,
    workMode: next.workMode as WorkMode,
    workModeConfidence: next.workModeConfidence ?? null,
    workModeStatus: next.workModeStatus ?? null,
    workModeSource: next.workModeSource ?? null,
    workModeCandidatesJson: next.workModeCandidatesJson ?? Prisma.JsonNull,
    employmentType: next.employmentType as EmploymentType,
    employmentTypeGroup: next.employmentTypeGroup,
    employmentTypeConfidence: next.employmentTypeConfidence ?? null,
    employmentTypeStatus: next.employmentTypeStatus ?? null,
    employmentTypeSource: next.employmentTypeSource ?? null,
    employmentTypeCandidatesJson: next.employmentTypeCandidatesJson ?? Prisma.JsonNull,
    experienceLevel: next.experienceLevel as ExperienceLevel,
    industry: next.industry as Industry | null,
    roleFamily: next.roleFamily,
    normalizedEmploymentType: next.normalizedEmploymentType,
    normalizedEmploymentTypeConfidence: next.normalizedEmploymentTypeConfidence ?? null,
    normalizedCareerStage: next.normalizedCareerStage,
    normalizedCareerStageConfidence: next.normalizedCareerStageConfidence ?? null,
    normalizedIndustry: next.normalizedIndustry,
    normalizedIndustries: next.normalizedIndustries ?? [],
    normalizedIndustryConfidence: next.normalizedIndustryConfidence ?? null,
    normalizedRoleCategory: next.normalizedRoleCategory,
    normalizedRoleCategoryConfidence: next.normalizedRoleCategoryConfidence ?? null,
    classificationStatus: next.classificationStatus,
    extractionWarnings: next.extractionWarnings ?? Prisma.JsonNull,
    extractionRejectionReasons: next.extractionRejectionReasons ?? Prisma.JsonNull,
    duplicateClusterId: next.duplicateClusterId,
  };
}

function hasChanged(
  current: Record<string, unknown>,
  next: ReturnType<typeof buildUpdateData>
) {
  const comparableNext = next as Record<string, unknown>;
  return Object.entries(comparableNext).some(([key, nextValue]) => {
    if (key === "titleCandidatesJson") {
      return normalizedJson(current[key]) !== normalizedJson(nextValue);
    }
    if (
      key === "titleRejectedFragmentsJson" ||
      key === "titleExtractionWarnings" ||
      key === "locationCandidatesJson" ||
      key === "workModeCandidatesJson" ||
      key === "employmentTypeCandidatesJson" ||
      key === "normalizedIndustries" ||
      key === "extractionWarnings" ||
      key === "extractionRejectionReasons"
    ) {
      return normalizedJson(current[key]) !== normalizedJson(nextValue);
    }
    return normalizeComparableValue(current[key]) !== normalizeComparableValue(nextValue);
  });
}

function appendJsonString(value: Prisma.JsonValue | null, warning: string) {
  const existing = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
  return [...new Set([...existing, warning])];
}

function readStringArray(value: Prisma.InputJsonValue | undefined | null) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseArgs(args: string[]): Options {
  const parsed: Options = {
    dryRun: args.includes("--dry-run"),
    limit: null,
    batchSize: 500,
    onlyLowConfidence: args.includes("--only-low-confidence"),
    onlyMissing: args.includes("--only-missing"),
    force: args.includes("--force"),
    titleContains: null,
  };

  for (const arg of args) {
    if (arg.startsWith("--limit=")) {
      const limit = Number(arg.slice("--limit=".length));
      parsed.limit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
    } else if (arg.startsWith("--batch-size=")) {
      const batchSize = Number(arg.slice("--batch-size=".length));
      parsed.batchSize =
        Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 500;
    } else if (arg.startsWith("--title-contains=")) {
      const titleContains = arg.slice("--title-contains=".length).trim();
      parsed.titleContains = titleContains || null;
    }
  }

  if (parsed.force) {
    parsed.onlyMissing = false;
    parsed.onlyLowConfidence = false;
  }
  return parsed;
}

function normalizedJson(value: unknown) {
  if (value === Prisma.JsonNull || value === undefined) return "null";
  return JSON.stringify(value ?? null);
}

function normalizeComparableValue(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (value === Prisma.JsonNull || value === undefined) return null;
  return value;
}

function increment(map: Distribution, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function mapToObject(map: Distribution) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}

function topEntries(map: Distribution, limit: number) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}
