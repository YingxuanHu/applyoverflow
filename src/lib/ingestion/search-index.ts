import { prisma } from "@/lib/db";
import {
  buildSearchText,
  computeFreshnessScore,
  computeRankingScore,
  computeTrustScore,
} from "@/lib/ingestion/quality";
import { inferGeoScope, isExplicitlyOutOfScopeGeoScope } from "@/lib/geo-scope";
import { hasUnresolvedGenericCompanyName } from "@/lib/job-cleanup";

const RECENT_SOURCE_EVIDENCE_MAX_AGE_MS = 14 * 86_400_000;
const RECENT_ALIVE_EVIDENCE_MAX_AGE_MS = 30 * 86_400_000;
const JOB_BOARD_MIN_AVAILABILITY_SCORE = 60;

function shouldExcludeFromFeedIndex(input: {
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

  const geoScope = inferGeoScope(input.location, input.region);
  if (isExplicitlyOutOfScopeGeoScope(geoScope)) {
    return true;
  }

  if (input.region == null && input.workMode !== "REMOTE") {
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

  await prisma.$transaction([
    prisma.jobCanonical.update({
      where: { id: canonicalJobId },
      data: {
        trustScore,
        freshnessScore,
      },
    }),
    prisma.jobFeedIndex.upsert({
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
        },
        indexedAt: new Date(),
      },
    }),
  ]);
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
