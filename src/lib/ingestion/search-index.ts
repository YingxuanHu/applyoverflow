import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { hasBadApplyLinkValidationStatus } from "@/lib/ingestion/apply-link-quality";
import { assessJobDataQuality } from "@/lib/ingestion/job-data-quality";
import {
  buildSearchText,
  computeFreshnessScore,
  computeRankingScore,
  computeTrustScore,
} from "@/lib/ingestion/quality";
import { hasUnresolvedGenericCompanyName } from "@/lib/job-cleanup";
import { isClearlyNonJobPosting } from "@/lib/job-integrity";

const RECENT_SOURCE_EVIDENCE_MAX_AGE_MS = 14 * 86_400_000;
const RECENT_ALIVE_EVIDENCE_MAX_AGE_MS = 30 * 86_400_000;
const JOB_BOARD_MIN_AVAILABILITY_SCORE = 60;

export type JobFeedIndexRepairMode = "missing" | "stale" | "all";

function shouldExcludeFromFeedIndex(input: {
  title: string;
  description: string;
  shortSummary: string;
  location: string;
  region: "US" | "CA" | null;
  workMode: string;
  status: string;
  availabilityScore: number;
  applyUrl: string;
  company: string;
  sourceCount: number;
  titleConfidence: number | null;
  titleStatus: string | null;
  applyUrlValidationStatus: string | null;
  deadline: Date | null;
  deadSignalAt: Date | null;
  lastSourceSeenAt: Date | null;
  lastConfirmedAliveAt: Date | null;
  now: Date;
}) {
  if (input.status !== "LIVE") {
    return true;
  }

  if (
    input.titleStatus != null &&
    !["verified", "confident"].includes(input.titleStatus)
  ) {
    return true;
  }

  if (input.titleConfidence != null && input.titleConfidence < 0.6) {
    return true;
  }

  if (
    isClearlyNonJobPosting({
      title: input.title,
      description: input.description || input.shortSummary,
      applyUrl: input.applyUrl,
    })
  ) {
    return true;
  }

  if (
    assessJobDataQuality({
      title: input.title,
      company: input.company,
      description: input.description || input.shortSummary,
      applyUrl: input.applyUrl,
    }).severity === "reject"
  ) {
    return true;
  }

  if (input.deadSignalAt) {
    return true;
  }

  if (input.availabilityScore < JOB_BOARD_MIN_AVAILABILITY_SCORE) {
    return true;
  }

  if (input.sourceCount <= 0) {
    return true;
  }

  if (hasBadApplyLinkValidationStatus(input.applyUrlValidationStatus)) {
    return true;
  }

  if (input.deadline && input.deadline.getTime() < input.now.getTime()) {
    return true;
  }

  if (!/^https?:\/\//i.test(input.applyUrl)) {
    return true;
  }

  if (hasUnresolvedGenericCompanyName(input.company, input.applyUrl)) {
    return true;
  }

  const normalizedCompany = input.company.trim().toLowerCase();
  if (
    (normalizedCompany === "jooble" || normalizedCompany === "jooble.org") &&
    /jooble\.org/i.test(input.applyUrl)
  ) {
    return true;
  }

  const recentSourceCutoff = new Date(input.now.getTime() - RECENT_SOURCE_EVIDENCE_MAX_AGE_MS);
  const recentAliveCutoff = new Date(input.now.getTime() - RECENT_ALIVE_EVIDENCE_MAX_AGE_MS);

  return !(
    (input.lastSourceSeenAt && input.lastSourceSeenAt >= recentSourceCutoff) ||
    (input.lastConfirmedAliveAt && input.lastConfirmedAliveAt >= recentAliveCutoff)
  );
}

export async function upsertJobFeedIndex(canonicalJobId: string) {
  const now = new Date();
  const canonical = await prisma.jobCanonical.findUniqueOrThrow({
    where: { id: canonicalJobId },
    include: {
      sourceMappings: {
        where: { removedAt: null },
        orderBy: [{ sourceQualityRank: "desc" }, { lastSeenAt: "desc" }],
      },
      eligibility: true,
    },
  });

  const primarySource = canonical.sourceMappings[0] ?? null;
  const sourceCount = canonical.sourceMappings.length;
  const trustScore = computeTrustScore({
    sourceReliability: primarySource?.sourceReliability ?? null,
    sourceType: primarySource?.sourceType ?? null,
    sourceQualityKind: primarySource?.sourceQualityKind ?? null,
    sourceCount,
  });
  const freshnessScore = computeFreshnessScore({
    postedAt: canonical.postedAt,
    lastSeenAt: canonical.lastSeenAt,
    lastConfirmedAliveAt: canonical.lastConfirmedAliveAt,
    status: canonical.status,
    deadline: canonical.deadline,
  });
  const indexStatus = shouldExcludeFromFeedIndex({
    title: canonical.title,
    description: canonical.description,
    shortSummary: canonical.shortSummary,
    location: canonical.location,
    region: canonical.region,
    workMode: canonical.workMode,
    status: canonical.status,
    availabilityScore: canonical.availabilityScore,
    applyUrl: canonical.applyUrl,
    company: canonical.company,
    sourceCount,
    titleConfidence: canonical.titleConfidence,
    titleStatus: canonical.titleStatus,
    applyUrlValidationStatus: canonical.applyUrlValidationStatus,
    deadline: canonical.deadline,
    deadSignalAt: canonical.deadSignalAt,
    lastSourceSeenAt: canonical.lastSourceSeenAt,
    lastConfirmedAliveAt: canonical.lastConfirmedAliveAt,
    now,
  })
    ? "REMOVED"
    : canonical.status;
  const qualityScore = canonical.qualityScore;
  const rankingScore = computeRankingScore({
    qualityScore,
    trustScore,
    freshnessScore,
    availabilityScore: canonical.availabilityScore,
    sourceCount,
    submissionCategory: canonical.eligibility?.submissionCategory ?? null,
  });

  await prisma.$executeRaw`
    UPDATE "JobCanonical"
    SET
      "trustScore" = ${trustScore},
      "freshnessScore" = ${freshnessScore}
    WHERE
      id = ${canonicalJobId}
      AND (
        "trustScore" IS DISTINCT FROM ${trustScore}
        OR "freshnessScore" IS DISTINCT FROM ${freshnessScore}
      )
  `;
  await prisma.jobFeedIndex.upsert({
    where: { canonicalJobId },
    create: {
      canonicalJobId,
      status: indexStatus,
      submissionCategory: canonical.eligibility?.submissionCategory ?? null,
      title: canonical.title,
      displayTitle: canonical.displayTitle,
      titleConfidence: canonical.titleConfidence,
      titleStatus: canonical.titleStatus,
      titleSource: canonical.titleSource,
      titleExtractionWarnings: canonical.titleExtractionWarnings ?? [],
      jobPageType: canonical.jobPageType,
      company: canonical.company,
      location: canonical.location,
      locationConfidence: canonical.locationConfidence,
      locationStatus: canonical.locationStatus,
      locationSource: canonical.locationSource,
      region: canonical.region,
      workMode: canonical.workMode,
      workModeConfidence: canonical.workModeConfidence,
      workModeStatus: canonical.workModeStatus,
      workModeSource: canonical.workModeSource,
      employmentType: canonical.employmentType,
      employmentTypeGroup: canonical.employmentTypeGroup ?? "UNKNOWN",
      employmentTypeConfidence: canonical.employmentTypeConfidence,
      employmentTypeStatus: canonical.employmentTypeStatus,
      employmentTypeSource: canonical.employmentTypeSource,
      experienceLevel: canonical.experienceLevel,
      experienceLevelGroup: canonical.experienceLevelGroup ?? "UNKNOWN",
      experienceLevelSource: canonical.experienceLevelSource,
      experienceLevelEvidenceJson: canonical.experienceLevelEvidenceJson ?? [],
      experienceLevelWarningsJson: canonical.experienceLevelWarningsJson ?? [],
      industry: canonical.industry,
      roleFamily: canonical.roleFamily,
      normalizedEmploymentType: canonical.normalizedEmploymentType ?? "UNKNOWN",
      normalizedEmploymentTypeConfidence: canonical.normalizedEmploymentTypeConfidence,
      normalizedCareerStage: canonical.normalizedCareerStage ?? "UNKNOWN",
      normalizedCareerStageConfidence: canonical.normalizedCareerStageConfidence,
      normalizedIndustry: canonical.normalizedIndustry ?? "UNKNOWN",
      normalizedIndustries: canonical.normalizedIndustries,
      normalizedIndustryConfidence: canonical.normalizedIndustryConfidence,
      normalizedRoleCategory: canonical.normalizedRoleCategory ?? "OTHER_UNKNOWN",
      normalizedRoleCategoryConfidence: canonical.normalizedRoleCategoryConfidence,
      normalizedRoleCategoryGroup: canonical.normalizedRoleCategoryGroup ?? null,
      normalizedRoleCategoryStatus: canonical.normalizedRoleCategoryStatus ?? null,
      normalizedRoleCategorySource: canonical.normalizedRoleCategorySource ?? null,
      classificationStatus: canonical.classificationStatus ?? "UNKNOWN",
      salaryMin: canonical.salaryMin,
      salaryMax: canonical.salaryMax,
      salaryCurrency: canonical.salaryCurrency,
      salaryStatus: canonical.salaryStatus,
      salaryPeriod: canonical.salaryPeriod,
      salaryRawText: canonical.salaryRawText,
      salaryConfidence: canonical.salaryConfidence,
      salarySource: canonical.salarySource,
      descriptionStatus: canonical.descriptionStatus,
      descriptionConfidence: canonical.descriptionConfidence,
      descriptionWordCount: canonical.descriptionWordCount,
      extractionWarnings: canonical.extractionWarnings ?? [],
      metadataExtractionWarnings: canonical.metadataExtractionWarnings ?? [],
      postedAt: canonical.postedAt,
      datePostedConfidence: canonical.datePostedConfidence,
      datePostedStatus: canonical.datePostedStatus,
      datePostedSource: canonical.datePostedSource,
      datePostedRawText: canonical.datePostedRawText,
      deadline: canonical.deadline,
      applicationDeadlineConfidence: canonical.applicationDeadlineConfidence,
      applicationDeadlineStatus: canonical.applicationDeadlineStatus,
      applicationDeadlineSource: canonical.applicationDeadlineSource,
      applicationDeadlineRawText: canonical.applicationDeadlineRawText,
      qualityScore,
      trustScore,
      freshnessScore,
      rankingScore,
      sourceCount,
      applyUrl: canonical.applyUrl,
      searchText: buildSearchText({
        title: canonical.title,
        company: canonical.company,
        location: canonical.location,
        roleFamily: canonical.roleFamily,
        shortSummary: canonical.shortSummary,
        description: canonical.description,
      }),
      metadataJson: {
        availabilityScore: canonical.availabilityScore,
        lastConfirmedAliveAt: canonical.lastConfirmedAliveAt?.toISOString() ?? null,
        sourceQualityKind: primarySource?.sourceQualityKind ?? null,
        applyUrlValidationStatus: canonical.applyUrlValidationStatus ?? null,
        applyUrlValidationReason: canonical.applyUrlValidationReason ?? null,
        finalResolvedApplyUrl: canonical.finalResolvedApplyUrl ?? null,
        applyUrlRedirectDepth: canonical.applyUrlRedirectDepth ?? null,
        extraction: {
          titleStatus: canonical.titleStatus ?? null,
          titleConfidence: canonical.titleConfidence ?? null,
          titleSource: canonical.titleSource ?? null,
          titleExtractionWarnings: canonical.titleExtractionWarnings ?? [],
          jobPageType: canonical.jobPageType ?? null,
          locationStatus: canonical.locationStatus ?? null,
          locationConfidence: canonical.locationConfidence ?? null,
          locationSource: canonical.locationSource ?? null,
          workModeStatus: canonical.workModeStatus ?? null,
          workModeConfidence: canonical.workModeConfidence ?? null,
          workModeSource: canonical.workModeSource ?? null,
          employmentTypeStatus: canonical.employmentTypeStatus ?? null,
          employmentTypeConfidence: canonical.employmentTypeConfidence ?? null,
          employmentTypeSource: canonical.employmentTypeSource ?? null,
          experienceLevelGroup: canonical.experienceLevelGroup ?? "UNKNOWN",
          experienceLevelSource: canonical.experienceLevelSource ?? null,
          experienceLevelEvidence: canonical.experienceLevelEvidenceJson ?? [],
          experienceLevelWarnings: canonical.experienceLevelWarningsJson ?? [],
          salaryStatus: canonical.salaryStatus ?? null,
          salaryConfidence: canonical.salaryConfidence ?? null,
          salarySource: canonical.salarySource ?? null,
          descriptionStatus: canonical.descriptionStatus ?? null,
          descriptionConfidence: canonical.descriptionConfidence ?? null,
          descriptionWordCount: canonical.descriptionWordCount ?? null,
          datePostedStatus: canonical.datePostedStatus ?? null,
          datePostedConfidence: canonical.datePostedConfidence ?? null,
          datePostedSource: canonical.datePostedSource ?? null,
          applicationDeadlineStatus: canonical.applicationDeadlineStatus ?? null,
          applicationDeadlineConfidence: canonical.applicationDeadlineConfidence ?? null,
          applicationDeadlineSource: canonical.applicationDeadlineSource ?? null,
          warnings: canonical.extractionWarnings ?? [],
          metadataWarnings: canonical.metadataExtractionWarnings ?? [],
        },
        normalizedMetadata: {
          employmentType: canonical.normalizedEmploymentType ?? "UNKNOWN",
          employmentTypeGroup: canonical.employmentTypeGroup ?? "UNKNOWN",
          employmentTypeConfidence: canonical.normalizedEmploymentTypeConfidence,
          careerStage: canonical.normalizedCareerStage ?? "UNKNOWN",
          careerStageGroup: canonical.experienceLevelGroup ?? "UNKNOWN",
          careerStageConfidence: canonical.normalizedCareerStageConfidence,
          industry: canonical.normalizedIndustry ?? "UNKNOWN",
          industries: canonical.normalizedIndustries,
          industryConfidence: canonical.normalizedIndustryConfidence,
          roleCategory: canonical.normalizedRoleCategory ?? "OTHER_UNKNOWN",
          roleCategoryConfidence: canonical.normalizedRoleCategoryConfidence,
          roleCategoryGroup: canonical.normalizedRoleCategoryGroup ?? null,
          roleCategoryStatus: canonical.normalizedRoleCategoryStatus ?? null,
          roleCategorySource: canonical.normalizedRoleCategorySource ?? null,
          roleCategoryEvidence: canonical.normalizedRoleCategoryEvidenceJson ?? [],
          roleCategoryWarnings: canonical.normalizedRoleCategoryWarningsJson ?? [],
          classificationStatus: canonical.classificationStatus ?? "UNKNOWN",
        },
      },
      indexedAt: new Date(),
    },
    update: {
      status: indexStatus,
      submissionCategory: canonical.eligibility?.submissionCategory ?? null,
      title: canonical.title,
      displayTitle: canonical.displayTitle,
      titleConfidence: canonical.titleConfidence,
      titleStatus: canonical.titleStatus,
      titleSource: canonical.titleSource,
      titleExtractionWarnings: canonical.titleExtractionWarnings ?? [],
      jobPageType: canonical.jobPageType,
      company: canonical.company,
      location: canonical.location,
      locationConfidence: canonical.locationConfidence,
      locationStatus: canonical.locationStatus,
      locationSource: canonical.locationSource,
      region: canonical.region,
      workMode: canonical.workMode,
      workModeConfidence: canonical.workModeConfidence,
      workModeStatus: canonical.workModeStatus,
      workModeSource: canonical.workModeSource,
      employmentType: canonical.employmentType,
      employmentTypeGroup: canonical.employmentTypeGroup ?? "UNKNOWN",
      employmentTypeConfidence: canonical.employmentTypeConfidence,
      employmentTypeStatus: canonical.employmentTypeStatus,
      employmentTypeSource: canonical.employmentTypeSource,
      experienceLevel: canonical.experienceLevel,
      experienceLevelGroup: canonical.experienceLevelGroup ?? "UNKNOWN",
      experienceLevelSource: canonical.experienceLevelSource,
      experienceLevelEvidenceJson: canonical.experienceLevelEvidenceJson ?? [],
      experienceLevelWarningsJson: canonical.experienceLevelWarningsJson ?? [],
      industry: canonical.industry,
      roleFamily: canonical.roleFamily,
      normalizedEmploymentType: canonical.normalizedEmploymentType ?? "UNKNOWN",
      normalizedEmploymentTypeConfidence: canonical.normalizedEmploymentTypeConfidence,
      normalizedCareerStage: canonical.normalizedCareerStage ?? "UNKNOWN",
      normalizedCareerStageConfidence: canonical.normalizedCareerStageConfidence,
      normalizedIndustry: canonical.normalizedIndustry ?? "UNKNOWN",
      normalizedIndustries: canonical.normalizedIndustries,
      normalizedIndustryConfidence: canonical.normalizedIndustryConfidence,
      normalizedRoleCategory: canonical.normalizedRoleCategory ?? "OTHER_UNKNOWN",
      normalizedRoleCategoryConfidence: canonical.normalizedRoleCategoryConfidence,
      normalizedRoleCategoryGroup: canonical.normalizedRoleCategoryGroup ?? null,
      normalizedRoleCategoryStatus: canonical.normalizedRoleCategoryStatus ?? null,
      normalizedRoleCategorySource: canonical.normalizedRoleCategorySource ?? null,
      classificationStatus: canonical.classificationStatus ?? "UNKNOWN",
      salaryMin: canonical.salaryMin,
      salaryMax: canonical.salaryMax,
      salaryCurrency: canonical.salaryCurrency,
      salaryStatus: canonical.salaryStatus,
      salaryPeriod: canonical.salaryPeriod,
      salaryRawText: canonical.salaryRawText,
      salaryConfidence: canonical.salaryConfidence,
      salarySource: canonical.salarySource,
      descriptionStatus: canonical.descriptionStatus,
      descriptionConfidence: canonical.descriptionConfidence,
      descriptionWordCount: canonical.descriptionWordCount,
      extractionWarnings: canonical.extractionWarnings ?? [],
      metadataExtractionWarnings: canonical.metadataExtractionWarnings ?? [],
      postedAt: canonical.postedAt,
      datePostedConfidence: canonical.datePostedConfidence,
      datePostedStatus: canonical.datePostedStatus,
      datePostedSource: canonical.datePostedSource,
      datePostedRawText: canonical.datePostedRawText,
      deadline: canonical.deadline,
      applicationDeadlineConfidence: canonical.applicationDeadlineConfidence,
      applicationDeadlineStatus: canonical.applicationDeadlineStatus,
      applicationDeadlineSource: canonical.applicationDeadlineSource,
      applicationDeadlineRawText: canonical.applicationDeadlineRawText,
      qualityScore,
      trustScore,
      freshnessScore,
      rankingScore,
      sourceCount,
      applyUrl: canonical.applyUrl,
      searchText: buildSearchText({
        title: canonical.title,
        company: canonical.company,
        location: canonical.location,
        roleFamily: canonical.roleFamily,
        shortSummary: canonical.shortSummary,
        description: canonical.description,
      }),
      metadataJson: {
        availabilityScore: canonical.availabilityScore,
        lastConfirmedAliveAt: canonical.lastConfirmedAliveAt?.toISOString() ?? null,
        sourceQualityKind: primarySource?.sourceQualityKind ?? null,
        applyUrlValidationStatus: canonical.applyUrlValidationStatus ?? null,
        applyUrlValidationReason: canonical.applyUrlValidationReason ?? null,
        finalResolvedApplyUrl: canonical.finalResolvedApplyUrl ?? null,
        applyUrlRedirectDepth: canonical.applyUrlRedirectDepth ?? null,
        extraction: {
          titleStatus: canonical.titleStatus ?? null,
          titleConfidence: canonical.titleConfidence ?? null,
          titleSource: canonical.titleSource ?? null,
          titleExtractionWarnings: canonical.titleExtractionWarnings ?? [],
          jobPageType: canonical.jobPageType ?? null,
          locationStatus: canonical.locationStatus ?? null,
          locationConfidence: canonical.locationConfidence ?? null,
          locationSource: canonical.locationSource ?? null,
          workModeStatus: canonical.workModeStatus ?? null,
          workModeConfidence: canonical.workModeConfidence ?? null,
          workModeSource: canonical.workModeSource ?? null,
          employmentTypeStatus: canonical.employmentTypeStatus ?? null,
          employmentTypeConfidence: canonical.employmentTypeConfidence ?? null,
          employmentTypeSource: canonical.employmentTypeSource ?? null,
          experienceLevelGroup: canonical.experienceLevelGroup ?? "UNKNOWN",
          experienceLevelSource: canonical.experienceLevelSource ?? null,
          experienceLevelEvidence: canonical.experienceLevelEvidenceJson ?? [],
          experienceLevelWarnings: canonical.experienceLevelWarningsJson ?? [],
          salaryStatus: canonical.salaryStatus ?? null,
          salaryConfidence: canonical.salaryConfidence ?? null,
          salarySource: canonical.salarySource ?? null,
          descriptionStatus: canonical.descriptionStatus ?? null,
          descriptionConfidence: canonical.descriptionConfidence ?? null,
          descriptionWordCount: canonical.descriptionWordCount ?? null,
          datePostedStatus: canonical.datePostedStatus ?? null,
          datePostedConfidence: canonical.datePostedConfidence ?? null,
          datePostedSource: canonical.datePostedSource ?? null,
          applicationDeadlineStatus: canonical.applicationDeadlineStatus ?? null,
          applicationDeadlineConfidence: canonical.applicationDeadlineConfidence ?? null,
          applicationDeadlineSource: canonical.applicationDeadlineSource ?? null,
          warnings: canonical.extractionWarnings ?? [],
          metadataWarnings: canonical.metadataExtractionWarnings ?? [],
        },
        normalizedMetadata: {
          employmentType: canonical.normalizedEmploymentType ?? "UNKNOWN",
          employmentTypeGroup: canonical.employmentTypeGroup ?? "UNKNOWN",
          employmentTypeConfidence: canonical.normalizedEmploymentTypeConfidence,
          careerStage: canonical.normalizedCareerStage ?? "UNKNOWN",
          careerStageGroup: canonical.experienceLevelGroup ?? "UNKNOWN",
          careerStageConfidence: canonical.normalizedCareerStageConfidence,
          industry: canonical.normalizedIndustry ?? "UNKNOWN",
          industries: canonical.normalizedIndustries,
          industryConfidence: canonical.normalizedIndustryConfidence,
          roleCategory: canonical.normalizedRoleCategory ?? "OTHER_UNKNOWN",
          roleCategoryConfidence: canonical.normalizedRoleCategoryConfidence,
          roleCategoryGroup: canonical.normalizedRoleCategoryGroup ?? null,
          roleCategoryStatus: canonical.normalizedRoleCategoryStatus ?? null,
          roleCategorySource: canonical.normalizedRoleCategorySource ?? null,
          roleCategoryEvidence: canonical.normalizedRoleCategoryEvidenceJson ?? [],
          roleCategoryWarnings: canonical.normalizedRoleCategoryWarningsJson ?? [],
          classificationStatus: canonical.classificationStatus ?? "UNKNOWN",
        },
      },
      indexedAt: new Date(),
    },
  });
}

export async function upsertJobFeedIndexes(
  canonicalJobIds: string[],
  options: { concurrency?: number } = {}
) {
  const uniqueIds = [...new Set(canonicalJobIds)].filter(Boolean);
  const concurrency = Math.max(1, options.concurrency ?? 8);

  for (let start = 0; start < uniqueIds.length; start += concurrency) {
    const chunk = uniqueIds.slice(start, start + concurrency);
    await Promise.all(chunk.map((id) => upsertJobFeedIndex(id)));
  }
}

function buildJobFeedIndexRepairQuery(mode: JobFeedIndexRepairMode, limit: number) {
  const missingClause = Prisma.sql`jfi."canonicalJobId" IS NULL`;
  const staleClause = Prisma.sql`jfi."canonicalJobId" IS NOT NULL AND jfi."indexedAt" < jc."updatedAt"`;
  const hiddenButVisibleClause = Prisma.sql`
    jfi."canonicalJobId" IS NOT NULL
    AND jc.status = 'LIVE'
    AND jfi.status <> 'LIVE'
    AND jc."deadSignalAt" IS NULL
    AND jc."availabilityScore" >= ${JOB_BOARD_MIN_AVAILABILITY_SCORE}
    AND (jc."titleStatus" IS NULL OR jc."titleStatus" IN ('verified', 'confident'))
    AND (jc."titleConfidence" IS NULL OR jc."titleConfidence" >= 0.6)
    AND (jc.deadline IS NULL OR jc.deadline >= NOW())
    AND jc."applyUrl" ~* '^https?://'
    AND COALESCE(jc."applyUrlValidationStatus", 'ACTIVE') NOT IN (
      'EXPIRED',
      'BROKEN_APPLY_LINK',
      'GENERIC_APPLY_PAGE',
      'SOURCE_STALE',
      'HIDDEN_LOW_QUALITY'
    )
    AND EXISTS (
      SELECT 1
      FROM "JobSourceMapping" jsm
      WHERE jsm."canonicalJobId" = jc.id
        AND jsm."removedAt" IS NULL
    )
    AND (
      (
        jc."lastSourceSeenAt" IS NOT NULL
        AND jc."lastSourceSeenAt" >= NOW() - INTERVAL '14 days'
      )
      OR (
        jc."lastConfirmedAliveAt" IS NOT NULL
        AND jc."lastConfirmedAliveAt" >= NOW() - INTERVAL '30 days'
      )
    )
  `;
  const whereClause =
    mode === "missing"
      ? missingClause
      : mode === "stale"
        ? staleClause
        : Prisma.sql`(${missingClause} OR ${staleClause} OR (${hiddenButVisibleClause}))`;

  return Prisma.sql`
    SELECT jc.id
    FROM "JobCanonical" jc
    LEFT JOIN "JobFeedIndex" jfi
      ON jfi."canonicalJobId" = jc.id
    WHERE
      jc.status IN ('LIVE', 'AGING', 'STALE')
      AND ${whereClause}
    ORDER BY
      CASE WHEN jfi."canonicalJobId" IS NULL THEN 0 ELSE 1 END ASC,
      CASE WHEN ${hiddenButVisibleClause} THEN 0 ELSE 1 END ASC,
      jc."updatedAt" DESC
    LIMIT ${limit}
  `;
}

export async function repairJobFeedIndexBatch(options: {
  mode?: JobFeedIndexRepairMode;
  limit?: number;
  concurrency?: number;
} = {}) {
  const mode = options.mode ?? "all";
  const limit = Math.max(1, options.limit ?? 250);
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(
    buildJobFeedIndexRepairQuery(mode, limit)
  );
  const summary = {
    mode,
    scanned: rows.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    samples: [] as Array<{ canonicalJobId: string; error: string }>,
  };

  for (let start = 0; start < rows.length; start += concurrency) {
    const chunk = rows.slice(start, start + concurrency);
    const results = await Promise.all(
      chunk.map(async (row) => {
        try {
          await upsertJobFeedIndex(row.id);
          return { success: true } as const;
        } catch (error) {
          return {
            success: false,
            canonicalJobId: row.id,
            error: error instanceof Error ? error.message : String(error),
          } as const;
        }
      })
    );

    for (const result of results) {
      summary.processed += 1;
      if (result.success) {
        summary.succeeded += 1;
      } else {
        summary.failed += 1;
        if (summary.samples.length < 10) {
          summary.samples.push({
            canonicalJobId: result.canonicalJobId,
            error: result.error,
          });
        }
      }
    }
  }

  return summary;
}
