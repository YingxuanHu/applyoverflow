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
import {
  inferFreshnessModeFromSourceName,
  parseSourceConnectorJobFromRawPayload,
} from "@/lib/ingestion/normalized-records";
import type { NormalizedJobInput } from "@/lib/ingestion/types";
import {
  classifyJobMetadata,
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
  const missingClassification =
    normalized.normalizedEmploymentTypeConfidence == null ||
    normalized.normalizedCareerStageConfidence == null ||
    normalized.normalizedIndustryConfidence == null ||
    normalized.normalizedRoleCategoryConfidence == null ||
    normalized.classificationStatus == null;
  const fallbackMetadata = missingClassification
    ? classifyJobMetadata({
        title: normalized.title,
        company: normalized.company,
        description: normalized.description,
        location: normalized.location,
        roleFamily: normalized.roleFamily,
        legacyIndustry: normalized.industry,
        inferredEmploymentType: normalized.employmentType,
        sourceEmploymentType: null,
        workMode: normalized.workMode,
      })
    : null;

  const normalizedJob = {
    title: normalized.title,
    company: normalized.company,
    companyKey: normalized.companyKey,
    titleKey: normalized.titleKey,
    titleCoreKey: normalized.titleCoreKey,
    descriptionFingerprint: normalized.descriptionFingerprint,
    location: normalized.location,
    locationKey: normalized.locationKey,
    region: normalized.region,
    workMode: normalized.workMode,
    salaryMin: normalized.salaryMin,
    salaryMax: normalized.salaryMax,
    salaryCurrency: normalized.salaryCurrency,
    employmentType: normalized.employmentType,
    experienceLevel: normalized.experienceLevel ?? "UNKNOWN",
    description: normalized.description,
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
    normalizedIndustryConfidence:
      fallbackMetadata?.confidence.industry ?? normalized.normalizedIndustryConfidence ?? 0.2,
    normalizedRoleCategory:
      fallbackMetadata?.normalizedRoleCategory ??
      coerceNormalizedRoleCategory(normalized.normalizedRoleCategory),
    normalizedRoleCategoryConfidence:
      fallbackMetadata?.confidence.roleCategory ??
      normalized.normalizedRoleCategoryConfidence ??
      0.2,
    classificationStatus:
      fallbackMetadata?.classificationStatus ??
      (normalized.classificationStatus as NormalizedJobInput["classificationStatus"] | null) ??
      "UNKNOWN",
    applyUrl: normalized.applyUrl,
    applyUrlKey: normalized.applyUrlKey,
    postedAt: normalized.postedAt,
    deadline: normalized.deadline,
    duplicateClusterId: normalized.duplicateClusterId,
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
