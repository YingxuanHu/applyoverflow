import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
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
    isClearlyNonJobPosting({
      title: input.title,
      description: input.description || input.shortSummary,
      applyUrl: input.applyUrl,
    })
  ) {
    return true;
  }

  if (input.deadSignalAt) {
    return true;
  }

  if (input.availabilityScore < JOB_BOARD_MIN_AVAILABILITY_SCORE) {
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
      company: canonical.company,
      location: canonical.location,
      region: canonical.region,
      workMode: canonical.workMode,
      employmentType: canonical.employmentType,
      experienceLevel: canonical.experienceLevel,
      industry: canonical.industry,
      roleFamily: canonical.roleFamily,
      normalizedEmploymentType: canonical.normalizedEmploymentType ?? "UNKNOWN",
      normalizedEmploymentTypeConfidence: canonical.normalizedEmploymentTypeConfidence,
      normalizedCareerStage: canonical.normalizedCareerStage ?? "UNKNOWN",
      normalizedCareerStageConfidence: canonical.normalizedCareerStageConfidence,
      normalizedIndustry: canonical.normalizedIndustry ?? "OTHER_UNKNOWN",
      normalizedIndustryConfidence: canonical.normalizedIndustryConfidence,
      normalizedRoleCategory: canonical.normalizedRoleCategory ?? "OTHER_UNKNOWN",
      normalizedRoleCategoryConfidence: canonical.normalizedRoleCategoryConfidence,
      classificationStatus: canonical.classificationStatus ?? "UNKNOWN",
      salaryMin: canonical.salaryMin,
      salaryMax: canonical.salaryMax,
      salaryCurrency: canonical.salaryCurrency,
      postedAt: canonical.postedAt,
      deadline: canonical.deadline,
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
        normalizedMetadata: {
          employmentType: canonical.normalizedEmploymentType ?? "UNKNOWN",
          employmentTypeConfidence: canonical.normalizedEmploymentTypeConfidence,
          careerStage: canonical.normalizedCareerStage ?? "UNKNOWN",
          careerStageConfidence: canonical.normalizedCareerStageConfidence,
          industry: canonical.normalizedIndustry ?? "OTHER_UNKNOWN",
          industryConfidence: canonical.normalizedIndustryConfidence,
          roleCategory: canonical.normalizedRoleCategory ?? "OTHER_UNKNOWN",
          roleCategoryConfidence: canonical.normalizedRoleCategoryConfidence,
          classificationStatus: canonical.classificationStatus ?? "UNKNOWN",
        },
      },
      indexedAt: new Date(),
    },
    update: {
      status: indexStatus,
      submissionCategory: canonical.eligibility?.submissionCategory ?? null,
      title: canonical.title,
      company: canonical.company,
      location: canonical.location,
      region: canonical.region,
      workMode: canonical.workMode,
      employmentType: canonical.employmentType,
      experienceLevel: canonical.experienceLevel,
      industry: canonical.industry,
      roleFamily: canonical.roleFamily,
      normalizedEmploymentType: canonical.normalizedEmploymentType ?? "UNKNOWN",
      normalizedEmploymentTypeConfidence: canonical.normalizedEmploymentTypeConfidence,
      normalizedCareerStage: canonical.normalizedCareerStage ?? "UNKNOWN",
      normalizedCareerStageConfidence: canonical.normalizedCareerStageConfidence,
      normalizedIndustry: canonical.normalizedIndustry ?? "OTHER_UNKNOWN",
      normalizedIndustryConfidence: canonical.normalizedIndustryConfidence,
      normalizedRoleCategory: canonical.normalizedRoleCategory ?? "OTHER_UNKNOWN",
      normalizedRoleCategoryConfidence: canonical.normalizedRoleCategoryConfidence,
      classificationStatus: canonical.classificationStatus ?? "UNKNOWN",
      salaryMin: canonical.salaryMin,
      salaryMax: canonical.salaryMax,
      salaryCurrency: canonical.salaryCurrency,
      postedAt: canonical.postedAt,
      deadline: canonical.deadline,
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
        normalizedMetadata: {
          employmentType: canonical.normalizedEmploymentType ?? "UNKNOWN",
          employmentTypeConfidence: canonical.normalizedEmploymentTypeConfidence,
          careerStage: canonical.normalizedCareerStage ?? "UNKNOWN",
          careerStageConfidence: canonical.normalizedCareerStageConfidence,
          industry: canonical.normalizedIndustry ?? "OTHER_UNKNOWN",
          industryConfidence: canonical.normalizedIndustryConfidence,
          roleCategory: canonical.normalizedRoleCategory ?? "OTHER_UNKNOWN",
          roleCategoryConfidence: canonical.normalizedRoleCategoryConfidence,
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
    AND (jc.deadline IS NULL OR jc.deadline >= NOW())
    AND jc."applyUrl" ~* '^https?://'
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
