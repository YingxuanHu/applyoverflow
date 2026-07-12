import { prisma } from "@/lib/db";
import {
  buildCanonicalDedupeFields,
} from "@/lib/ingestion/dedupe";
import {
  deriveSourceIdentitySnapshot,
  deriveSourceLifecycleSnapshot,
} from "@/lib/ingestion/source-quality";
import {
  computeNormalizedQualityScore,
  computeTrustScore,
} from "@/lib/ingestion/quality";
import { normalizeSourceJob } from "@/lib/ingestion/normalize";
import { extractNormalizedJobFacts } from "@/lib/ingestion/extraction/quality-gates";
import { mapNormalizedEmploymentTypeToLegacy } from "@/lib/ingestion/extraction/job-metadata-extractor";
import { classifyJobMetadata } from "@/lib/job-metadata";
import { sanitizeCompanyName, sanitizeJobDescriptionText, sanitizeJobTitle } from "@/lib/job-cleanup";
import type { SourceConnectorJob } from "@/lib/ingestion/types";
import { Prisma } from "@/generated/prisma/client";

const INCREMENTAL_SOURCE_PREFIXES = new Set([
  "Adzuna",
  "Himalayas",
  "JobBank",
  "Jobicy",
  "RemoteOK",
  "Remotive",
  "TheMuse",
  "USAJobs",
  "WeWorkRemotely",
]);

function asJsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, Prisma.JsonValue | null>;
}

function parseDate(value: Prisma.JsonValue | null | undefined) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readEnumValue<T extends string>(
  value: Prisma.JsonValue | null | undefined,
  allowed: readonly T[]
) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return allowed.includes(normalized as T) ? (normalized as T) : null;
}

function hasSourceRegistryImport(metadataJson: Prisma.JsonValue | null | undefined) {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) {
    return false;
  }

  return "sourceRegistryImport" in metadataJson;
}

export async function applyVerifiedCompanyDisplayName<T extends { company: string; companyKey: string }>(
  job: T
): Promise<T> {
  if (!job.companyKey) return job;

  const company = await prisma.company.findUnique({
    where: { companyKey: job.companyKey },
    select: {
      name: true,
      metadataJson: true,
      normalizedIndustrySource: true,
    },
  });

  const hasVerifiedRegistryName =
    company != null &&
    company.name.trim().length > 0 &&
    (company.normalizedIndustrySource === "company_verified_csv" ||
      hasSourceRegistryImport(company.metadataJson));

  if (!hasVerifiedRegistryName || company.name === job.company) {
    return job;
  }

  return { ...job, company: company.name };
}

export function inferFreshnessModeFromSourceName(sourceName: string) {
  const prefix = sourceName.split(":")[0] ?? sourceName;
  return INCREMENTAL_SOURCE_PREFIXES.has(prefix) ? "INCREMENTAL" : "FULL_SNAPSHOT";
}

export function parseSourceConnectorJobFromRawPayload(input: {
  sourceName: string;
  sourceId: string;
  rawPayload: Prisma.JsonValue;
}) {
  const payload = asJsonObject(input.rawPayload);
  if (!payload) {
    throw new Error(`Raw job ${input.sourceName}/${input.sourceId} has invalid rawPayload.`);
  }

  return {
    sourceId: input.sourceId,
    sourceUrl: typeof payload.sourceUrl === "string" ? payload.sourceUrl : null,
    title: typeof payload.title === "string" ? payload.title : "",
    company: typeof payload.company === "string" ? payload.company : "",
    location: typeof payload.location === "string" ? payload.location : "",
    description: typeof payload.description === "string" ? payload.description : "",
    applyUrl: typeof payload.applyUrl === "string" ? payload.applyUrl : "",
    postedAt: parseDate(payload.postedAt),
    deadline: parseDate(payload.deadline),
    employmentType: readEnumValue(payload.employmentType, [
      "FULL_TIME",
      "PART_TIME",
      "CONTRACT",
      "INTERNSHIP",
      "UNKNOWN",
    ]),
    workMode: readEnumValue(payload.workMode, [
      "REMOTE",
      "HYBRID",
      "ONSITE",
      "FLEXIBLE",
      "UNKNOWN",
    ]),
    salaryMin: typeof payload.salaryMin === "number" ? payload.salaryMin : null,
    salaryMax: typeof payload.salaryMax === "number" ? payload.salaryMax : null,
    salaryCurrency: typeof payload.salaryCurrency === "string" ? payload.salaryCurrency : null,
    metadata:
      payload.metadata != null
        ? (payload.metadata as Prisma.InputJsonValue)
        : {},
  } satisfies SourceConnectorJob;
}

function buildRejectedNormalizedRecordData(
  sourceJob: SourceConnectorJob,
  fetchedAt: Date,
  sourceName?: string | null
) {
  const company = sanitizeCompanyName(sourceJob.company, {
    urls: [sourceJob.applyUrl, sourceJob.sourceUrl],
  });
  const facts = extractNormalizedJobFacts(sourceJob, {
    company,
    urls: [sourceJob.applyUrl, sourceJob.sourceUrl],
    sourceName,
    metadata: sourceJob.metadata,
    fetchedAt,
  });
  const title = facts.title.value || sanitizeJobTitle(sourceJob.title);
  const location = facts.location?.value || sourceJob.location.trim() || "Unknown";
  const description = facts.description.text ?? sanitizeJobDescriptionText(sourceJob.description, {
    title,
    location,
  });
  const dedupeFields = buildCanonicalDedupeFields({
    company,
    title,
    description,
    location,
    region: null,
    applyUrl: sourceJob.applyUrl,
  });
  const metadata = classifyJobMetadata({
    title,
    rawTitle: sourceJob.title,
    company,
    description,
    location,
    sourceEmploymentType: sourceJob.employmentType,
    inferredEmploymentType: "UNKNOWN",
    legacyIndustry: null,
    roleFamily: "Unknown",
    workMode: facts.metadata.workMode.value,
    sourceMetadata: sourceJob.metadata,
    applyUrl: sourceJob.applyUrl,
    sourceUrl: sourceJob.sourceUrl,
  });

  return {
    title,
    company,
    companyKey: dedupeFields.companyKey,
    titleKey: dedupeFields.titleKey,
    titleCoreKey: dedupeFields.titleCoreKey,
    descriptionFingerprint: dedupeFields.descriptionFingerprint,
    location,
    locationKey: dedupeFields.locationKey,
    region: null,
    workMode: facts.metadata.workMode.value,
    workModeConfidence: facts.metadata.workMode.confidence,
    workModeStatus: facts.metadata.workMode.status,
    workModeSource: facts.metadata.workMode.source,
    workModeCandidatesJson: facts.metadata.workModeCandidates as unknown as Prisma.InputJsonValue,
    salaryMin: sourceJob.salaryMin,
    salaryMax: sourceJob.salaryMax,
    salaryCurrency: sourceJob.salaryCurrency,
    employmentType: mapNormalizedEmploymentTypeToLegacy(facts.metadata.employmentType.value),
    employmentTypeGroup: facts.metadata.employmentTypeGroup,
    employmentTypeConfidence: facts.metadata.employmentType.confidence,
    employmentTypeStatus: facts.metadata.employmentType.status,
    employmentTypeSource: facts.metadata.employmentType.source,
    employmentTypeCandidatesJson:
      facts.metadata.employmentTypeCandidates as unknown as Prisma.InputJsonValue,
    experienceLevel: metadata.experienceLevel,
    experienceLevelGroup: metadata.experienceLevelGroup,
    experienceLevelSource: metadata.experienceLevelSource,
    experienceLevelEvidenceJson:
      metadata.experienceLevelEvidence as unknown as Prisma.InputJsonValue,
    experienceLevelWarningsJson:
      metadata.experienceLevelWarnings as unknown as Prisma.InputJsonValue,
    description,
    shortSummary: description.slice(0, 280),
    industry: null,
    roleFamily: "Unknown",
    normalizedEmploymentType: facts.metadata.employmentType.value,
    normalizedEmploymentTypeConfidence: facts.metadata.employmentType.confidence,
    normalizedCareerStage: metadata.normalizedCareerStage,
    normalizedCareerStageConfidence: metadata.confidence.careerStage,
    normalizedIndustry: metadata.normalizedIndustry,
    normalizedIndustries: metadata.normalizedIndustries,
    normalizedIndustryConfidence: metadata.confidence.industry,
    normalizedRoleCategory: metadata.normalizedRoleCategory,
    normalizedRoleCategoryConfidence: metadata.confidence.roleCategory,
    normalizedRoleCategoryGroup: metadata.normalizedRoleCategoryGroup,
    normalizedRoleCategoryStatus: metadata.normalizedRoleCategoryStatus,
    normalizedRoleCategorySource: metadata.normalizedRoleCategorySource,
    normalizedRoleCategoryCandidatesJson:
      metadata.normalizedRoleCategoryCandidates as unknown as Prisma.InputJsonValue,
    normalizedRoleCategoryEvidenceJson:
      metadata.normalizedRoleCategoryEvidence as unknown as Prisma.InputJsonValue,
    normalizedRoleCategoryWarningsJson:
      metadata.normalizedRoleCategoryWarnings as unknown as Prisma.InputJsonValue,
    classificationStatus: metadata.classificationStatus,
    displayTitle: facts.displayTitle ?? null,
    titleConfidence: facts.title.confidence,
    titleStatus: facts.title.status,
    titleSource: facts.title.source,
    titleCandidatesJson: facts.titleCandidates as unknown as Prisma.InputJsonValue,
    titleRejectedFragmentsJson:
      facts.titleRejectedFragments as unknown as Prisma.InputJsonValue,
    titleExtractionWarnings: facts.titleExtractionWarnings as unknown as Prisma.InputJsonValue,
    jobPageType: facts.jobPageType ?? "unknown",
    locationConfidence: facts.location?.confidence ?? null,
    locationStatus: facts.location?.status ?? "missing",
    locationSource: facts.location?.source ?? null,
    locationCandidatesJson: facts.locationCandidates as unknown as Prisma.InputJsonValue,
    salaryStatus: facts.salary.status,
    salaryPeriod: facts.salary.period,
    salaryRawText: facts.salary.rawText,
    salaryConfidence: facts.salary.confidence,
    salarySource: facts.salary.source,
    descriptionStatus: facts.description.status,
    descriptionConfidence: facts.description.confidence,
    descriptionWordCount: facts.description.wordCount,
    datePostedConfidence: facts.metadata.datePosted.confidence,
    datePostedStatus: facts.metadata.datePosted.status,
    datePostedSource: facts.metadata.datePosted.source,
    datePostedRawText: facts.metadata.datePosted.rawValue ?? null,
    applicationDeadlineConfidence: facts.metadata.applicationDeadline.confidence,
    applicationDeadlineStatus: facts.metadata.applicationDeadline.status,
    applicationDeadlineSource: facts.metadata.applicationDeadline.source,
    applicationDeadlineRawText: facts.metadata.applicationDeadline.rawValue ?? null,
    metadataExtractionWarnings: facts.metadata.warnings as unknown as Prisma.InputJsonValue,
    extractionWarnings: facts.quality.warnings as unknown as Prisma.InputJsonValue,
    extractionRejectionReasons: facts.quality.rejectionReasons as unknown as Prisma.InputJsonValue,
    applyUrl: sourceJob.applyUrl,
    applyUrlKey: dedupeFields.applyUrlKey,
    postedAt: facts.metadata.datePosted.value ?? fetchedAt,
    deadline:
      facts.metadata.applicationDeadline.status === "invalid"
        ? null
        : facts.metadata.applicationDeadline.value,
    duplicateClusterId: dedupeFields.duplicateClusterId,
  };
}

export async function upsertNormalizedJobRecordFromSourceJob(input: {
  rawJobId: string;
  rawSourceName: string;
  rawSourceId: string;
  rawPayload: Prisma.JsonValue;
  fetchedAt: Date;
}) {
  const sourceJob = parseSourceConnectorJobFromRawPayload({
    sourceName: input.rawSourceName,
    sourceId: input.rawSourceId,
    rawPayload: input.rawPayload,
  });
  const normalizationResult = normalizeSourceJob({
    job: sourceJob,
    fetchedAt: input.fetchedAt,
    sourceName: input.rawSourceName,
  });
  const sourceIdentity = deriveSourceIdentitySnapshot({
    sourceName: input.rawSourceName,
    sourceId: input.rawSourceId,
    sourceUrl: sourceJob.sourceUrl,
    applyUrl: sourceJob.applyUrl,
    metadata: sourceJob.metadata,
  });
  const sourceLifecycle = deriveSourceLifecycleSnapshot({
    sourceName: input.rawSourceName,
    sourceUrl: sourceJob.sourceUrl,
    applyUrl: sourceJob.applyUrl,
    freshnessMode: inferFreshnessModeFromSourceName(input.rawSourceName),
  });

  if (normalizationResult.kind === "rejected") {
    const rejected = await applyVerifiedCompanyDisplayName(
      buildRejectedNormalizedRecordData(sourceJob, input.fetchedAt, input.rawSourceName)
    );
    const trustScore = computeTrustScore({
      sourceReliability: sourceLifecycle.sourceReliability,
      sourceType: sourceLifecycle.sourceType,
      sourceQualityKind: sourceIdentity.sourceQualityKind,
      sourceCount: 1,
    });

    return prisma.normalizedJobRecord.upsert({
      where: { rawJobId: input.rawJobId },
      create: {
        rawJobId: input.rawJobId,
        status: "REJECTED",
        normalizationVersion: "v2-staged",
        rejectionReason: normalizationResult.reason,
        integrityReason: normalizationResult.reason,
        qualityScore: 0,
        trustScore,
        freshnessScore: 0,
        ...rejected,
        metadataJson:
          sourceJob.metadata != null
            ? (sourceJob.metadata as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
      update: {
        status: "REJECTED",
        normalizationVersion: "v2-staged",
        rejectionReason: normalizationResult.reason,
        integrityReason: normalizationResult.reason,
        qualityScore: 0,
        trustScore,
        freshnessScore: 0,
        ...rejected,
        metadataJson:
          sourceJob.metadata != null
            ? (sourceJob.metadata as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });
  }

  const trustScore = computeTrustScore({
    sourceReliability: sourceLifecycle.sourceReliability,
    sourceType: sourceLifecycle.sourceType,
    sourceQualityKind: sourceIdentity.sourceQualityKind,
    sourceCount: 1,
  });

  const normalizedJob = await applyVerifiedCompanyDisplayName(normalizationResult.job);

  return prisma.normalizedJobRecord.upsert({
    where: { rawJobId: input.rawJobId },
    create: {
      rawJobId: input.rawJobId,
      status: "VALIDATED",
      normalizationVersion: "v2-staged",
      qualityScore: computeNormalizedQualityScore(normalizedJob),
      trustScore,
      freshnessScore: 100,
      ...normalizedJob,
      metadataJson:
        sourceJob.metadata != null
          ? (sourceJob.metadata as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
    update: {
      status: "VALIDATED",
      normalizationVersion: "v2-staged",
      rejectionReason: null,
      integrityReason: null,
      qualityScore: computeNormalizedQualityScore(normalizedJob),
      trustScore,
      freshnessScore: 100,
      ...normalizedJob,
      metadataJson:
        sourceJob.metadata != null
          ? (sourceJob.metadata as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });
}

export async function upsertNormalizedJobRecordFromRawJob(rawJobId: string) {
  const rawJob = await prisma.jobRaw.findUniqueOrThrow({
    where: { id: rawJobId },
  });

  return upsertNormalizedJobRecordFromSourceJob({
    rawJobId,
    rawSourceName: rawJob.sourceName,
    rawSourceId: rawJob.sourceId,
    rawPayload: rawJob.rawPayload,
    fetchedAt: rawJob.fetchedAt,
  });
}
