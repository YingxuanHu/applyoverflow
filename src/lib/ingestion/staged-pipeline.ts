import { prisma } from "@/lib/db";
import {
  findCrossSourceCanonicalMatch,
  isCanonicalMatchCompatibleForSource,
} from "@/lib/ingestion/dedupe";
import {
  deriveSourceIdentitySnapshot,
  deriveSourceLifecycleSnapshot,
} from "@/lib/ingestion/source-quality";
import { upsertJobFeedIndex } from "@/lib/ingestion/search-index";
import {
  findMappedCanonical,
  upsertCanonicalJob,
  upsertEligibility,
  upsertSourceMapping,
} from "@/lib/ingestion/pipeline";
import { Prisma } from "@/generated/prisma/client";
import {
  applyVerifiedCompanyDisplayName,
  inferFreshnessModeFromSourceName,
  parseSourceConnectorJobFromRawPayload,
} from "@/lib/ingestion/normalized-records";
import type { NormalizedJobInput } from "@/lib/ingestion/types";
import {
  classifyJobMetadata,
  coerceExperienceLevelGroup,
  coerceNormalizedCareerStage,
  coerceNormalizedEmploymentType,
  coerceNormalizedIndustry,
  coerceNormalizedRoleCategory,
} from "@/lib/job-metadata";

export async function canonicalizeNormalizedJobRecord(normalizedJobRecordId: string) {
  const normalized = await prisma.normalizedJobRecord.findUniqueOrThrow({
    where: { id: normalizedJobRecordId },
    include: {
      rawJob: true,
    },
  });

  if (normalized.status === "REJECTED") {
    return {
      normalizedId: normalized.id,
      canonicalJobId: null,
      status: "SKIPPED" as const,
    };
  }

  const sourceJob = parseSourceConnectorJobFromRawPayload({
    sourceName: normalized.rawJob.sourceName,
    sourceId: normalized.rawJob.sourceId,
    rawPayload: normalized.rawJob.rawPayload,
  });
  const connector = {
    key: `${normalized.rawJob.sourceName}:${normalized.rawJob.sourceId}`,
    sourceName: normalized.rawJob.sourceName,
    sourceTier: normalized.rawJob.sourceTier,
    freshnessMode: inferFreshnessModeFromSourceName(normalized.rawJob.sourceName),
  } as const;
  const sourceIdentity = deriveSourceIdentitySnapshot({
    sourceName: normalized.rawJob.sourceName,
    sourceId: normalized.rawJob.sourceId,
    sourceUrl: sourceJob.sourceUrl,
    applyUrl: sourceJob.applyUrl,
    metadata: sourceJob.metadata,
  });
  const sourceLifecycle = deriveSourceLifecycleSnapshot({
    sourceName: normalized.rawJob.sourceName,
    sourceUrl: sourceJob.sourceUrl,
    applyUrl: sourceJob.applyUrl,
    freshnessMode: connector.freshnessMode,
  });
  const verifiedCompany = await applyVerifiedCompanyDisplayName({
    company: normalized.company,
    companyKey: normalized.companyKey,
  });
  const missingClassification =
    normalized.normalizedEmploymentTypeConfidence == null ||
    normalized.normalizedCareerStageConfidence == null ||
    normalized.experienceLevelGroup == null ||
    normalized.normalizedIndustryConfidence == null ||
    normalized.normalizedRoleCategoryConfidence == null ||
    normalized.normalizedRoleCategoryGroup == null ||
    normalized.normalizedRoleCategoryStatus == null ||
    normalized.normalizedRoleCategorySource == null ||
    normalized.classificationStatus == null;
  const fallbackMetadata = missingClassification
    ? classifyJobMetadata({
        title: normalized.title,
        rawTitle: sourceJob.title,
        company: verifiedCompany.company,
        description: normalized.description,
        location: normalized.location,
        roleFamily: normalized.roleFamily,
        legacyIndustry: normalized.industry,
        inferredEmploymentType: normalized.employmentType,
        sourceEmploymentType: null,
        workMode: normalized.workMode,
        sourceMetadata: normalized.metadataJson,
        applyUrl: normalized.applyUrl,
        sourceUrl: sourceJob.sourceUrl,
      })
    : null;

  const normalizedJob = {
    title: normalized.title,
    titleConfidence: normalized.titleConfidence,
    titleStatus: normalized.titleStatus,
    titleSource: normalized.titleSource,
    titleCandidatesJson: asInputJson(normalized.titleCandidatesJson, []),
    displayTitle: normalized.displayTitle,
    titleRejectedFragmentsJson: asInputJson(normalized.titleRejectedFragmentsJson, []),
    titleExtractionWarnings: asInputJson(normalized.titleExtractionWarnings, []),
    jobPageType: normalized.jobPageType,
    company: verifiedCompany.company,
    companyKey: normalized.companyKey,
    titleKey: normalized.titleKey,
    titleCoreKey: normalized.titleCoreKey,
    descriptionFingerprint: normalized.descriptionFingerprint,
    location: normalized.location,
    locationConfidence: normalized.locationConfidence,
    locationStatus: normalized.locationStatus,
    locationSource: normalized.locationSource,
    locationCandidatesJson: asInputJson(normalized.locationCandidatesJson, []),
    locationKey: normalized.locationKey,
    region: normalized.region,
    workMode: normalized.workMode,
    workModeConfidence: normalized.workModeConfidence,
    workModeStatus: normalized.workModeStatus,
    workModeSource: normalized.workModeSource,
    workModeCandidatesJson: asInputJson(normalized.workModeCandidatesJson, []),
    salaryMin: normalized.salaryMin,
    salaryMax: normalized.salaryMax,
    salaryCurrency: normalized.salaryCurrency,
    salaryStatus: normalized.salaryStatus,
    salaryPeriod: normalized.salaryPeriod,
    salaryRawText: normalized.salaryRawText,
    salaryConfidence: normalized.salaryConfidence,
    salarySource: normalized.salarySource,
    employmentType: normalized.employmentType,
    employmentTypeGroup: normalized.employmentTypeGroup,
    employmentTypeConfidence: normalized.employmentTypeConfidence,
    employmentTypeStatus: normalized.employmentTypeStatus,
    employmentTypeSource: normalized.employmentTypeSource,
    employmentTypeCandidatesJson: asInputJson(normalized.employmentTypeCandidatesJson, []),
    experienceLevel: fallbackMetadata?.experienceLevel ?? normalized.experienceLevel ?? "UNKNOWN",
    experienceLevelGroup:
      fallbackMetadata?.experienceLevelGroup ??
      coerceExperienceLevelGroup(normalized.experienceLevelGroup),
    experienceLevelSource:
      fallbackMetadata?.experienceLevelSource ?? normalized.experienceLevelSource,
    experienceLevelEvidenceJson: fallbackMetadata
      ? (fallbackMetadata.experienceLevelEvidence as unknown as Prisma.InputJsonValue)
      : asInputJson(normalized.experienceLevelEvidenceJson, []),
    experienceLevelWarningsJson: fallbackMetadata
      ? (fallbackMetadata.experienceLevelWarnings as unknown as Prisma.InputJsonValue)
      : asInputJson(normalized.experienceLevelWarningsJson, []),
    description: normalized.description,
    descriptionStatus: normalized.descriptionStatus,
    descriptionConfidence: normalized.descriptionConfidence,
    descriptionWordCount: normalized.descriptionWordCount,
    datePostedConfidence: normalized.datePostedConfidence,
    datePostedStatus: normalized.datePostedStatus,
    datePostedSource: normalized.datePostedSource,
    datePostedRawText: normalized.datePostedRawText,
    applicationDeadlineConfidence: normalized.applicationDeadlineConfidence,
    applicationDeadlineStatus: normalized.applicationDeadlineStatus,
    applicationDeadlineSource: normalized.applicationDeadlineSource,
    applicationDeadlineRawText: normalized.applicationDeadlineRawText,
    metadataExtractionWarnings: asInputJson(normalized.metadataExtractionWarnings, []),
    shortSummary: normalized.shortSummary,
    industry: normalized.industry,
    roleFamily: normalized.roleFamily,
    normalizedEmploymentType:
      fallbackMetadata?.normalizedEmploymentType ??
      coerceNormalizedEmploymentType(normalized.normalizedEmploymentType),
    normalizedEmploymentTypeConfidence:
      fallbackMetadata?.confidence.employmentType ??
      normalized.normalizedEmploymentTypeConfidence ??
      0.2,
    normalizedCareerStage:
      fallbackMetadata?.normalizedCareerStage ??
      coerceNormalizedCareerStage(normalized.normalizedCareerStage),
    normalizedCareerStageConfidence:
      fallbackMetadata?.confidence.careerStage ??
      normalized.normalizedCareerStageConfidence ??
      0.2,
    normalizedIndustry:
      fallbackMetadata?.normalizedIndustry ?? coerceNormalizedIndustry(normalized.normalizedIndustry),
    normalizedIndustries:
      fallbackMetadata?.normalizedIndustries ??
      normalizeNormalizedIndustries(normalized.normalizedIndustries, normalized.normalizedIndustry),
    normalizedIndustryConfidence:
      fallbackMetadata?.confidence.industry ?? normalized.normalizedIndustryConfidence ?? 0.2,
    normalizedRoleCategory:
      fallbackMetadata?.normalizedRoleCategory ??
      coerceNormalizedRoleCategory(normalized.normalizedRoleCategory),
    normalizedRoleCategoryConfidence:
      fallbackMetadata?.confidence.roleCategory ??
      normalized.normalizedRoleCategoryConfidence ??
      0.2,
    normalizedRoleCategoryGroup:
      fallbackMetadata?.normalizedRoleCategoryGroup ??
      normalized.normalizedRoleCategoryGroup ??
      null,
    normalizedRoleCategoryStatus:
      fallbackMetadata?.normalizedRoleCategoryStatus ??
      normalized.normalizedRoleCategoryStatus ??
      null,
    normalizedRoleCategorySource:
      fallbackMetadata?.normalizedRoleCategorySource ??
      normalized.normalizedRoleCategorySource ??
      null,
    normalizedRoleCategoryCandidatesJson: fallbackMetadata
      ? (fallbackMetadata.normalizedRoleCategoryCandidates as unknown as Prisma.InputJsonValue)
      : asInputJson(normalized.normalizedRoleCategoryCandidatesJson, []),
    normalizedRoleCategoryEvidenceJson: fallbackMetadata
      ? (fallbackMetadata.normalizedRoleCategoryEvidence as unknown as Prisma.InputJsonValue)
      : asInputJson(normalized.normalizedRoleCategoryEvidenceJson, []),
    normalizedRoleCategoryWarningsJson: fallbackMetadata
      ? (fallbackMetadata.normalizedRoleCategoryWarnings as unknown as Prisma.InputJsonValue)
      : asInputJson(normalized.normalizedRoleCategoryWarningsJson, []),
    classificationStatus:
      fallbackMetadata?.classificationStatus ??
      (normalized.classificationStatus as NormalizedJobInput["classificationStatus"] | null) ??
      "UNKNOWN",
    applyUrl: normalized.applyUrl,
    applyUrlKey: normalized.applyUrlKey,
    postedAt: normalized.postedAt,
    deadline: normalized.deadline,
    duplicateClusterId: normalized.duplicateClusterId,
    extractionWarnings: asInputJson(normalized.extractionWarnings, []),
    extractionRejectionReasons: asInputJson(normalized.extractionRejectionReasons, []),
  } satisfies NormalizedJobInput;

  const mappedCanonical = await findMappedCanonical(normalized.rawJob.id);
  const compatibleMappedCanonical =
    mappedCanonical &&
    isCanonicalMatchCompatibleForSource(
      normalizedJob,
      mappedCanonical.canonical,
      sourceIdentity
    )
      ? mappedCanonical
      : null;
  const incompatibleMappedCanonicalId =
    mappedCanonical && !compatibleMappedCanonical ? mappedCanonical.canonical.id : null;
  const crossSourceMatch = compatibleMappedCanonical
    ? null
    : await findCrossSourceCanonicalMatch(normalizedJob, sourceIdentity, {
        excludeCanonicalIds: incompatibleMappedCanonicalId
          ? [incompatibleMappedCanonicalId]
          : [],
      });
  const canonicalMatch = compatibleMappedCanonical ?? crossSourceMatch;

  const canonicalResult = await upsertCanonicalJob({
    currentCanonicalId: canonicalMatch?.canonical.id ?? null,
    normalizedJob,
    sourceIdentity,
    sourceUrl: sourceJob.sourceUrl,
    rawApplyUrl: sourceJob.applyUrl,
    now: normalized.rawJob.fetchedAt,
  });

  await upsertSourceMapping({
    canonicalId: canonicalResult.id,
    connector,
    rawJobId: normalized.rawJob.id,
    sourceUrl: sourceJob.sourceUrl,
    sourceIdentity,
    sourceLifecycle,
    canonicalMatch,
    now: normalized.rawJob.fetchedAt,
  });
  await upsertEligibility(canonicalResult.id, normalizedJob, normalized.rawJob.sourceName);

  await prisma.$transaction([
    prisma.normalizedJobRecord.update({
      where: { id: normalized.id },
      data: {
        canonicalJobId: canonicalResult.id,
        status: "CANONICALIZED",
      },
    }),
    prisma.jobCanonical.update({
      where: { id: canonicalResult.id },
      data: {
        qualityScore: Math.max(normalized.qualityScore, 0),
      },
    }),
  ]);

  await upsertJobFeedIndex(canonicalResult.id);

  return {
    normalizedId: normalized.id,
    canonicalJobId: canonicalResult.id,
    status: canonicalResult.created ? ("CREATED" as const) : ("UPDATED" as const),
  };
}

function normalizeNormalizedIndustries(values: string[], primary: string | null) {
  const seen = new Set<string>();
  const industries: NormalizedJobInput["normalizedIndustries"] = [];
  for (const value of [...values, primary ?? ""]) {
    const industry = coerceNormalizedIndustry(value);
    if (industry === "UNKNOWN" || seen.has(industry)) continue;
    seen.add(industry);
    industries.push(industry);
  }
  return industries;
}

function asInputJson(
  value: Prisma.JsonValue | null | undefined,
  fallback: Prisma.InputJsonValue
) {
  return value == null ? fallback : (value as Prisma.InputJsonValue);
}
