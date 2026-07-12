import {
  Prisma,
  type Prisma as PrismaTypes,
  type UserJobPreferenceFeedbackType,
  type WorkMode,
} from "@/generated/prisma/client";
import { normalizeSalaryCurrency } from "@/lib/currency-conversion";
import { prisma } from "@/lib/db";
import { buildDefaultCanonicalVisibilityWhere } from "@/lib/jobs/visibility";
import {
  normalizeEducations,
  normalizeExperiences,
  normalizeProjects,
  normalizeSkills,
} from "@/lib/profile";

import {
  TOP_PICK_MIN_SCORE,
  TOP_PICKS_CANDIDATE_LIMIT,
  TOP_PICKS_RESULT_TTL_MS,
  TOP_PICKS_STORE_LIMIT,
} from "./config";
import {
  assessUserJobIntentSignal,
  buildUserJobIntent,
  getAllowedRoleCategories,
  normalizeIntentText,
  type TopPicksProfileReadiness,
  type UserJobIntent,
} from "./intent";
import {
  scoreJobForUser,
  type TopPickScoreResult,
  type TopPickScoringJob,
  type TopPickUserHistory,
} from "./scoring";
import {
  enqueueDurableTopPicksRefresh,
  getTopPicksRefreshTaskStatus,
} from "./refresh-queue";

const MAX_CHANNEL_LIMIT = 5000;
const MAX_TEXT_SKILL_TERMS = 8;

export const TOP_PICK_JOB_SELECT = (
  viewerProfileId: string,
  authUserId: string | null = null
) =>
  ({
    id: true,
    title: true,
    company: true,
    location: true,
    region: true,
    workMode: true,
    industry: true,
    status: true,
    roleFamily: true,
    normalizedRoleCategory: true,
    normalizedRoleCategoryConfidence: true,
    normalizedIndustry: true,
    normalizedIndustries: true,
    normalizedIndustryConfidence: true,
    classificationStatus: true,
    normalizedCareerStage: true,
    normalizedCareerStageConfidence: true,
    experienceLevel: true,
    experienceLevelGroup: true,
    salaryMin: true,
    salaryMax: true,
    salaryCurrency: true,
    shortSummary: true,
    description: true,
    applyUrl: true,
    postedAt: true,
    deadline: true,
    lastConfirmedAliveAt: true,
    lastSourceSeenAt: true,
    qualityScore: true,
    trustScore: true,
    freshnessScore: true,
    updatedAt: true,
    eligibility: {
      select: {
        submissionCategory: true,
        reasonCode: true,
        reasonDescription: true,
      },
    },
    sourceMappings: {
      where: { removedAt: null },
      orderBy: [{ isPrimary: "desc" }, { sourceQualityRank: "desc" }, { lastSeenAt: "desc" }],
      take: 5,
      select: {
        sourceName: true,
        sourceUrl: true,
        isPrimary: true,
      },
    },
    savedJobs: {
      where: {
        userId: viewerProfileId,
        status: "ACTIVE",
      },
      select: { id: true },
    },
    trackedApplications: {
      where: {
        userId: authUserId ?? "__auth_user_none__",
        status: { notIn: ["WISHLIST", "PREPARING"] },
      },
      select: { id: true },
      take: 1,
    },
  }) satisfies PrismaTypes.JobCanonicalSelect;

export type TopPickJobRecord = PrismaTypes.JobCanonicalGetPayload<{
  select: ReturnType<typeof TOP_PICK_JOB_SELECT>;
}>;

const TOP_PICK_SCORING_JOB_SELECT = {
  id: true,
  title: true,
  company: true,
  location: true,
  workMode: true,
  status: true,
  normalizedRoleCategory: true,
  normalizedRoleCategoryConfidence: true,
  normalizedRoleCategoryStatus: true,
  normalizedCareerStage: true,
  normalizedCareerStageConfidence: true,
  experienceLevelGroup: true,
  experienceLevelEvidenceJson: true,
  employmentTypeGroup: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  shortSummary: true,
  postedAt: true,
  deadline: true,
  applyUrl: true,
  applyUrlValidationStatus: true,
  availabilityScore: true,
  qualityScore: true,
  trustScore: true,
  freshnessScore: true,
  deadSignalAt: true,
  updatedAt: true,
} satisfies PrismaTypes.JobCanonicalSelect;

export type TopPickScoringJobRecord = PrismaTypes.JobCanonicalGetPayload<{
  select: typeof TOP_PICK_SCORING_JOB_SELECT;
}>;

export type RefreshTopPicksResult = {
  userId: string;
  profileVersion: number;
  candidateCount: number;
  candidatesByChannel?: Record<string, number>;
  scoredCount: number;
  storedCount: number;
  excludedCount: number;
  rejectedByEligibilityReason?: Record<string, number>;
  rejectedByRoleReason?: Record<string, number>;
  rejectedBySeniorityReason?: Record<string, number>;
  averageScore: number;
  durationMs: number;
};

type TopPicksStoredProfileSignal = {
  profileHash: string;
  profileVersion: number;
  updatedAt: Date;
  normalizedSkills: string[];
  targetRoleCategories: string[];
  targetCareerStage: string | null;
  preferredLocationCity: string | null;
  preferredLocationRegion: string | null;
  preferredLocationCountry: string | null;
  preferredWorkModes: string[];
  targetSalaryMin: number | null;
  targetSalaryMax: number | null;
  targetSalaryCurrency: string | null;
  experienceSummary: string | null;
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function buildAndStoreUserMatchProfile(userId: string) {
  const profile = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: {
      id: true,
      authUserId: true,
      location: true,
      headline: true,
      summary: true,
      skillsText: true,
      experienceText: true,
      educationText: true,
      projectsText: true,
      skillsJson: true,
      experiencesJson: true,
      educationsJson: true,
      projectsJson: true,
      preferredWorkMode: true,
      experienceLevel: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      savedJobs: {
        where: { status: "ACTIVE" },
        take: 30,
        orderBy: { updatedAt: "desc" },
        select: {
          canonicalJob: {
            select: {
              id: true,
              title: true,
              company: true,
              location: true,
              workMode: true,
              normalizedRoleCategory: true,
            },
          },
        },
      },
    },
  });
  if (!profile) return null;

  const [existing, applications, feedback] = await Promise.all([
    prisma.userMatchProfile.findUnique({
      where: { userId },
      select: { profileHash: true, profileVersion: true },
    }),
    profile.authUserId
      ? prisma.trackedApplication.findMany({
          where: {
            userId: profile.authUserId,
            canonicalJobId: { not: null },
            status: { notIn: ["WISHLIST", "PREPARING"] },
          },
          orderBy: { updatedAt: "desc" },
          take: 50,
          select: {
            canonicalJob: {
              select: {
                id: true,
                title: true,
                company: true,
                location: true,
                workMode: true,
                normalizedRoleCategory: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.userJobPreferenceFeedback.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        jobId: true,
        feedbackType: true,
        job: {
          select: {
            id: true,
            title: true,
            company: true,
            location: true,
            workMode: true,
            normalizedRoleCategory: true,
          },
        },
      },
    }),
  ]);
  const skills = normalizeSkills(profile.skillsJson);
  const experiences = normalizeExperiences(profile.experiencesJson);
  const educations = normalizeEducations(profile.educationsJson);
  const projects = normalizeProjects(profile.projectsJson);

  const preliminaryIntent = buildUserJobIntent({
    userId: profile.id,
    profileVersion: existing?.profileVersion ?? 1,
    headline: profile.headline,
    summary: profile.summary,
    location: profile.location,
    skillsText: profile.skillsText,
    experienceText: profile.experienceText,
    educationText: profile.educationText,
    projectsText: profile.projectsText,
    skills,
    experiences,
    educations,
    projects,
    preferredWorkMode: profile.preferredWorkMode,
    experienceLevel: profile.experienceLevel,
    salaryMin: profile.salaryMin,
    salaryMax: profile.salaryMax,
    salaryCurrency: normalizeSalaryCurrency(profile.salaryCurrency) ?? null,
    savedJobs: profile.savedJobs.map((saved) => saved.canonicalJob),
    appliedJobs: applications
      .map((application) => application.canonicalJob)
      .filter((job): job is NonNullable<typeof job> => Boolean(job)),
    feedback,
  });
  const nextVersion =
    existing && existing.profileHash !== preliminaryIntent.profileHash
      ? existing.profileVersion + 1
      : existing?.profileVersion ?? 1;
  const intent: UserJobIntent = {
    ...preliminaryIntent,
    profileVersion: nextVersion,
  };
  const snapshot = {
    userId: profile.id,
    normalizedSkills: [
      ...intent.mustHaveSkills,
      ...intent.strongSkills,
      ...intent.niceToHaveSkills,
    ].slice(0, 60),
    targetRoleCategories: getAllowedRoleCategories(intent),
    targetCareerStage: intent.targetCareerStages[0] ?? null,
    preferredLocationCity: intent.preferredLocationCity ?? null,
    preferredLocationRegion: intent.preferredLocationRegion ?? null,
    preferredLocationCountry: intent.preferredLocationCountry ?? null,
    preferredWorkModes: intent.preferredWorkModes,
    targetSalaryMin: intent.targetSalaryMin ?? null,
    targetSalaryMax: intent.targetSalaryMax ?? null,
    targetSalaryCurrency: intent.targetSalaryCurrency ?? null,
    experienceSummary: intent.experienceSummary,
  };

  await prisma.userMatchProfile.upsert({
    where: { userId },
    create: {
      ...snapshot,
      profileHash: intent.profileHash,
      profileVersion: nextVersion,
    },
    update: {
      ...snapshot,
      profileHash: intent.profileHash,
      profileVersion: nextVersion,
    },
  });

  return intent;
}

export function hasEnoughProfileSignal(intent: UserJobIntent | null) {
  return assessUserJobIntentSignal(intent).canGenerate;
}

function buildStoredProfileSignalFromIntent(
  intent: UserJobIntent
): TopPicksStoredProfileSignal {
  return {
    profileHash: intent.profileHash,
    profileVersion: intent.profileVersion,
    updatedAt: new Date(),
    normalizedSkills: [
      ...intent.mustHaveSkills,
      ...intent.strongSkills,
      ...intent.niceToHaveSkills,
    ].slice(0, 60),
    targetRoleCategories: getAllowedRoleCategories(intent),
    targetCareerStage: intent.targetCareerStages[0] ?? null,
    preferredLocationCity: intent.preferredLocationCity ?? null,
    preferredLocationRegion: intent.preferredLocationRegion ?? null,
    preferredLocationCountry: intent.preferredLocationCountry ?? null,
    preferredWorkModes: intent.preferredWorkModes,
    targetSalaryMin: intent.targetSalaryMin ?? null,
    targetSalaryMax: intent.targetSalaryMax ?? null,
    targetSalaryCurrency: intent.targetSalaryCurrency ?? null,
    experienceSummary: intent.experienceSummary,
  };
}

function assessStoredProfileSignal(
  profile: TopPicksStoredProfileSignal | null,
  intent: UserJobIntent | null
): TopPicksProfileReadiness {
  if (intent) return assessUserJobIntentSignal(intent);
  if (!profile) return assessUserJobIntentSignal(null);

  const hasRoleSignal =
    profile.targetRoleCategories.length > 0 ||
    normalizeIntentText(profile.experienceSummary).length >= 40;
  const hasSkillOrExperienceSignal =
    profile.normalizedSkills.length > 0 ||
    normalizeIntentText(profile.experienceSummary).length >= 40;
  const missingSignals: string[] = [];

  if (!hasRoleSignal) {
    missingSignals.push("target roles or recent job titles");
  }
  if (!hasSkillOrExperienceSignal) {
    missingSignals.push("skills, experience, or saved jobs");
  }

  return {
    canGenerate: hasRoleSignal && hasSkillOrExperienceSignal,
    missingSignals,
    message:
      missingSignals.length > 0
        ? `Add ${missingSignals.join(" and ")} to generate better Top Picks.`
        : "Your profile has enough signal to generate Top Picks.",
  };
}

function buildBaseFeedWhere(history?: TopPickUserHistory): PrismaTypes.JobFeedIndexWhereInput {
  const excluded = history ? [...history.excludedJobIds] : [];
  return {
    status: "LIVE",
    ...(excluded.length > 0 ? { canonicalJobId: { notIn: excluded } } : {}),
    canonicalJob: {
      is: buildDefaultCanonicalVisibilityWhere(),
    },
    OR: [{ deadline: null }, { deadline: { gte: new Date() } }],
    AND: [
      {
        OR: [
          { applyUrl: { startsWith: "http://" } },
          { applyUrl: { startsWith: "https://" } },
        ],
      },
    ],
  };
}

function andFeedWhere(
  base: PrismaTypes.JobFeedIndexWhereInput,
  extra: PrismaTypes.JobFeedIndexWhereInput
): PrismaTypes.JobFeedIndexWhereInput {
  return { AND: [base, extra] };
}

async function fetchCandidateIds(
  channel: string,
  where: PrismaTypes.JobFeedIndexWhereInput,
  limit: number
) {
  const rows = await prisma.jobFeedIndex.findMany({
    where,
    select: { canonicalJobId: true },
    orderBy: [{ rankingScore: "desc" }, { postedAt: "desc" }],
    take: Math.min(limit, MAX_CHANNEL_LIMIT),
  });
  return { channel, ids: rows.map((row) => row.canonicalJobId) };
}

export type TopPickCandidate = {
  job: TopPickScoringJobRecord;
  channels: string[];
};

function mergeCandidateChannels(
  batches: Array<{ channel: string; ids: string[] }>,
  limit: number
) {
  const channelsById = new Map<string, Set<string>>();
  const output: string[] = [];
  const candidatesByChannel: Record<string, number> = {};
  for (const batch of batches) {
    candidatesByChannel[batch.channel] = batch.ids.length;
    for (const id of batch.ids) {
      let channels = channelsById.get(id);
      if (!channels) {
        if (output.length >= limit) continue;
        channels = new Set<string>();
        channelsById.set(id, channels);
        output.push(id);
      }
      channels.add(batch.channel);
    }
  }
  return { ids: output, channelsById, candidatesByChannel };
}

export async function retrieveTopPickCandidates(
  intent: UserJobIntent,
  options: { limit?: number; history?: TopPickUserHistory } = {}
): Promise<{ candidates: TopPickCandidate[]; candidatesByChannel: Record<string, number> }> {
  const limit = options.limit ?? TOP_PICKS_CANDIDATE_LIMIT;
  const baseWhere = buildBaseFeedWhere(options.history);
  const allowedRoles = getAllowedRoleCategories(intent);
  const roleCompatibleWhere: PrismaTypes.JobFeedIndexWhereInput =
    allowedRoles.length > 0
      ? {
          normalizedRoleCategory: { in: allowedRoles },
          normalizedRoleCategoryConfidence: { gte: 0.62 },
        }
      : {};
  const seniorityWhere: PrismaTypes.JobFeedIndexWhereInput =
    intent.targetCareerStages.length > 0
      ? {
          OR: [
            { experienceLevelGroup: { in: intent.targetCareerStages } },
            { normalizedCareerStage: null },
            { experienceLevelGroup: null },
          ],
        }
      : {};
  const largestChannelLimit = Math.max(1200, Math.ceil(limit / 2));
  const smallChannelLimit = Math.max(500, Math.ceil(limit / 5));
  const candidateBatchPromises: Array<Promise<{ channel: string; ids: string[] }>> = [];

  if (intent.explicitTargetRoleCategories.length > 0) {
    candidateBatchPromises.push(
      fetchCandidateIds(
        "explicit_role",
        andFeedWhere(baseWhere, {
          normalizedRoleCategory: { in: intent.explicitTargetRoleCategories },
          normalizedRoleCategoryConfidence: { gte: 0.7 },
          ...seniorityWhere,
        }),
        largestChannelLimit
      )
    );
  }

  if (intent.inferredTargetRoleCategories.length > 0) {
    candidateBatchPromises.push(
      fetchCandidateIds(
        "inferred_role",
        andFeedWhere(baseWhere, {
          normalizedRoleCategory: { in: intent.inferredTargetRoleCategories },
          normalizedRoleCategoryConfidence: { gte: 0.7 },
          ...seniorityWhere,
        }),
        largestChannelLimit
      )
    );
  }

  const titleTerms = [...intent.explicitTargetTitles, ...intent.inferredTargetTitles]
    .map((title) => normalizeIntentText(title))
    .filter((title) => title.length >= 4)
    .slice(0, 4);
  if (titleTerms.length > 0) {
    candidateBatchPromises.push(
      fetchCandidateIds(
        "target_title",
        andFeedWhere(baseWhere, {
          ...seniorityWhere,
          OR: titleTerms.map((term) => ({
            title: { contains: term, mode: "insensitive" as const },
          })),
        }),
        smallChannelLimit
      )
    );
  }

  const skills = [...intent.mustHaveSkills, ...intent.strongSkills]
    .filter((skill) => normalizeText(skill).length >= 3)
    .slice(0, MAX_TEXT_SKILL_TERMS);
  if (skills.length > 0 && allowedRoles.length > 0) {
    candidateBatchPromises.push(
      fetchCandidateIds(
        "skill_inside_compatible_role",
        andFeedWhere(baseWhere, {
          ...roleCompatibleWhere,
          ...seniorityWhere,
          OR: skills.map((skill) => ({
            searchText: { contains: skill, mode: "insensitive" as const },
          })),
        }),
        smallChannelLimit
      )
    );
  } else if (skills.length > 0) {
    candidateBatchPromises.push(
      fetchCandidateIds(
        "skill_text_fallback",
        andFeedWhere(baseWhere, {
          AND: [
            {
              OR: skills.map((skill) => ({
                searchText: { contains: skill, mode: "insensitive" as const },
              })),
            },
          ],
        }),
        smallChannelLimit
      )
    );
  }

  if (intent.positiveSignals.likedRoleCategories.length > 0) {
    candidateBatchPromises.push(
      fetchCandidateIds(
        "positive_feedback_role",
        andFeedWhere(baseWhere, {
          normalizedRoleCategory: { in: intent.positiveSignals.likedRoleCategories },
          normalizedRoleCategoryConfidence: { gte: 0.66 },
          ...seniorityWhere,
        }),
        smallChannelLimit
      )
    );
  }

  const likedTitleTerms = intent.positiveSignals.likedTitles
    .map((title) => normalizeIntentText(title))
    .filter((title) => title.length >= 4)
    .slice(0, 4);
  if (likedTitleTerms.length > 0) {
    candidateBatchPromises.push(
      fetchCandidateIds(
        "positive_feedback_title",
        andFeedWhere(baseWhere, {
          ...seniorityWhere,
          OR: likedTitleTerms.map((title) => ({
            title: { contains: title, mode: "insensitive" as const },
          })),
        }),
        smallChannelLimit
      )
    );
  }

  const locationTerms = [
    intent.preferredLocationCity,
    intent.preferredLocationRegion,
    intent.preferredLocationCountry,
  ].filter((value): value is string => Boolean(value));
  if (allowedRoles.length > 0 && (locationTerms.length > 0 || intent.preferredWorkModes.length > 0)) {
    candidateBatchPromises.push(
      fetchCandidateIds(
        "location_work_mode_inside_role",
        andFeedWhere(baseWhere, {
          ...roleCompatibleWhere,
          ...seniorityWhere,
          OR: [
            ...locationTerms.map((location) => ({
              location: { contains: location, mode: "insensitive" as const },
            })),
            ...(intent.preferredWorkModes.length > 0
              ? [{ workMode: { in: intent.preferredWorkModes as WorkMode[] } }]
              : []),
          ],
        }),
        smallChannelLimit
      )
    );
  }

  if (allowedRoles.length > 0) {
    candidateBatchPromises.push(
      fetchCandidateIds(
        "top_applicant_proxy",
        andFeedWhere(baseWhere, {
          ...roleCompatibleWhere,
          ...seniorityWhere,
          qualityScore: { gte: 55 },
          trustScore: { gte: 50 },
        }),
        largestChannelLimit
      )
    );
    candidateBatchPromises.push(
      fetchCandidateIds(
        "fresh_quality_inside_role",
        andFeedWhere(baseWhere, {
          ...roleCompatibleWhere,
          ...seniorityWhere,
        }),
        smallChannelLimit
      )
    );
  }

  const candidateBatches = await Promise.all(candidateBatchPromises);
  const { ids: candidateIds, channelsById, candidatesByChannel } =
    mergeCandidateChannels(candidateBatches, limit);
  if (candidateIds.length === 0) return { candidates: [], candidatesByChannel };

  const jobs = await prisma.jobCanonical.findMany({
    where: { id: { in: candidateIds } },
    select: TOP_PICK_SCORING_JOB_SELECT,
  });
  const order = new Map(candidateIds.map((id, index) => [id, index]));
  const sorted = jobs.sort(
    (left, right) =>
      (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
  return {
    candidates: sorted.map((job) => ({
      job,
      channels: [...(channelsById.get(job.id) ?? new Set<string>())],
    })),
    candidatesByChannel,
  };
}

export async function loadUserTopPickHistory(userId: string): Promise<TopPickUserHistory> {
  const profile = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: { authUserId: true },
  });
  const authUserId = profile?.authUserId ?? null;
  const [savedJobs, applications, feedback] = await Promise.all([
    prisma.savedJob.findMany({
      where: { userId },
      select: { canonicalJobId: true },
    }),
    authUserId
      ? prisma.trackedApplication.findMany({
          where: {
            userId: authUserId,
            canonicalJobId: { not: null },
            status: { notIn: ["WISHLIST", "PREPARING"] },
          },
          select: { canonicalJobId: true },
        })
      : Promise.resolve([]),
    prisma.userJobPreferenceFeedback.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        jobId: true,
        feedbackType: true,
        job: {
          select: {
            normalizedRoleCategory: true,
            location: true,
            workMode: true,
          },
        },
      },
    }),
  ]);

  const excludedJobIds = new Set<string>();
  const suppressedRoleCategories = new Set<string>();
  const suppressedLocations = new Set<string>();
  const suppressedWorkModes = new Set<string>();
  const tooSeniorRoleCategories = new Set<string>();
  const tooJuniorRoleCategories = new Set<string>();

  for (const item of feedback) {
    if (
      item.feedbackType === "NOT_INTERESTED" ||
      item.feedbackType === "LOW_QUALITY" ||
      item.feedbackType === "ALREADY_SEEN"
    ) {
      excludedJobIds.add(item.jobId);
    }
    if (item.feedbackType === "WRONG_ROLE" && item.job.normalizedRoleCategory) {
      suppressedRoleCategories.add(item.job.normalizedRoleCategory);
    }
    if (item.feedbackType === "WRONG_LOCATION") {
      const location = normalizeText(item.job.location);
      if (location) suppressedLocations.add(location);
    }
    if (item.feedbackType === "WRONG_WORK_MODE" && item.job.workMode) {
      suppressedWorkModes.add(item.job.workMode);
    }
    if (item.feedbackType === "TOO_SENIOR" && item.job.normalizedRoleCategory) {
      tooSeniorRoleCategories.add(item.job.normalizedRoleCategory);
    }
    if (item.feedbackType === "TOO_JUNIOR" && item.job.normalizedRoleCategory) {
      tooJuniorRoleCategories.add(item.job.normalizedRoleCategory);
    }
  }

  return {
    savedJobIds: new Set(savedJobs.map((job) => job.canonicalJobId)),
    appliedJobIds: new Set(
      applications.map((application) => application.canonicalJobId).filter((id): id is string => Boolean(id))
    ),
    excludedJobIds,
    suppressedRoleCategories,
    suppressedLocations,
    suppressedWorkModes,
    tooSeniorRoleCategories,
    tooJuniorRoleCategories,
  };
}

function toScoringJob(job: TopPickScoringJobRecord): TopPickScoringJob {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    workMode: job.workMode,
    status: job.status,
    normalizedRoleCategory: job.normalizedRoleCategory,
    normalizedRoleCategoryConfidence: job.normalizedRoleCategoryConfidence,
    normalizedRoleCategoryStatus: job.normalizedRoleCategoryStatus,
    normalizedCareerStage: job.normalizedCareerStage,
    normalizedCareerStageConfidence: job.normalizedCareerStageConfidence,
    experienceLevelGroup: job.experienceLevelGroup,
    experienceLevelEvidenceJson: job.experienceLevelEvidenceJson,
    employmentTypeGroup: job.employmentTypeGroup,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    shortSummary: job.shortSummary,
    description: null,
    postedAt: job.postedAt,
    deadline: job.deadline,
    applyUrl: job.applyUrl,
    applyUrlValidationStatus: job.applyUrlValidationStatus,
    availabilityScore: job.availabilityScore,
    qualityScore: job.qualityScore,
    trustScore: job.trustScore,
    freshnessScore: job.freshnessScore,
    deadSignalAt: job.deadSignalAt,
  };
}

function dedupeTopPickResults(
  scored: Array<TopPickScoreResult & { job: TopPickScoringJobRecord }>
) {
  const seen = new Set<string>();
  const output: Array<TopPickScoreResult & { job: TopPickScoringJobRecord }> = [];
  const companyCounts = new Map<string, number>();

  for (const item of scored) {
    const companyKey = normalizeText(item.job.company);
    const count = companyCounts.get(companyKey) ?? 0;
    if (count >= 8 && output.length >= 20) continue;
    const key = [
      normalizeText(item.job.company),
      normalizeText(item.job.title).replace(/\([^)]*\)/g, "").trim(),
      normalizeText(item.job.location),
    ].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    companyCounts.set(companyKey, count + 1);
    output.push(item);
  }

  return output;
}

function incrementCounter(record: Record<string, number>, key?: string) {
  const normalized = key || "unknown";
  record[normalized] = (record[normalized] ?? 0) + 1;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function replaceUserTopPicks(input: {
  userId: string;
  profileVersion: number;
  picks: Array<TopPickScoreResult & { job: TopPickScoringJobRecord }>;
}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOP_PICKS_RESULT_TTL_MS);
  const jobIds = input.picks.map((pick) => pick.job.id);

  await prisma.$transaction(async (tx) => {
    if (jobIds.length > 0) {
      await tx.userTopPick.updateMany({
        where: {
          userId: input.userId,
          isValid: true,
          jobId: { notIn: jobIds },
        },
        data: { isValid: false, invalidatedAt: now },
      });
    } else {
      await tx.userTopPick.updateMany({
        where: { userId: input.userId, isValid: true },
        data: { isValid: false, invalidatedAt: now },
      });
    }

    for (const [index, pick] of input.picks.entries()) {
      await tx.userTopPick.upsert({
        where: {
          userId_jobId: {
            userId: input.userId,
            jobId: pick.job.id,
          },
        },
        create: {
          userId: input.userId,
          jobId: pick.job.id,
          score: pick.score,
          rank: index + 1,
          scoreBreakdown: toJsonValue(pick.scoreBreakdown),
          matchReasons: toJsonValue(pick.matchReasons),
          concerns: toJsonValue(pick.concerns),
          profileVersion: input.profileVersion,
          jobVersion: pick.job.updatedAt,
          computedAt: now,
          expiresAt,
          isValid: true,
          invalidatedAt: null,
        },
        update: {
          score: pick.score,
          rank: index + 1,
          scoreBreakdown: toJsonValue(pick.scoreBreakdown),
          matchReasons: toJsonValue(pick.matchReasons),
          concerns: toJsonValue(pick.concerns),
          profileVersion: input.profileVersion,
          jobVersion: pick.job.updatedAt,
          computedAt: now,
          expiresAt,
          isValid: true,
          invalidatedAt: null,
        },
      });
    }
  });
}

export async function refreshTopPicksForUser(
  userId: string,
  options: { reason?: string; candidateLimit?: number; storeLimit?: number } = {}
): Promise<RefreshTopPicksResult> {
  const startedAt = Date.now();
  const profile = await buildAndStoreUserMatchProfile(userId);
  if (!profile || !hasEnoughProfileSignal(profile)) {
    await replaceUserTopPicks({
      userId,
      profileVersion: profile?.profileVersion ?? 1,
      picks: [],
    });
    return {
      userId,
      profileVersion: profile?.profileVersion ?? 1,
      candidateCount: 0,
      scoredCount: 0,
      storedCount: 0,
      excludedCount: 0,
      averageScore: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const history = await loadUserTopPickHistory(userId);
  const { candidates, candidatesByChannel } = await retrieveTopPickCandidates(profile, {
    limit: options.candidateLimit ?? TOP_PICKS_CANDIDATE_LIMIT,
    history,
  });
  const scored = candidates.map((candidate) => ({
    ...scoreJobForUser(profile, toScoringJob(candidate.job), history, {
      candidateChannels: candidate.channels,
    }),
    job: candidate.job,
  }));
  const rejectedByEligibilityReason: Record<string, number> = {};
  const rejectedByRoleReason: Record<string, number> = {};
  const rejectedBySeniorityReason: Record<string, number> = {};
  const finalRoleDistribution: Record<string, number> = {};
  const finalSeniorityDistribution: Record<string, number> = {};
  const finalLocationDistribution: Record<string, number> = {};
  const finalWorkModeDistribution: Record<string, number> = {};

  for (const item of scored) {
    if (!item.excluded) continue;
    if (item.eligibilityGate && !item.eligibilityGate.passed) {
      incrementCounter(rejectedByEligibilityReason, item.eligibilityGate.reason);
    } else if (item.roleGate && !item.roleGate.passed) {
      incrementCounter(rejectedByRoleReason, item.roleGate.reason);
    } else if (item.seniorityGate && !item.seniorityGate.passed) {
      incrementCounter(rejectedBySeniorityReason, item.seniorityGate.reason);
    } else {
      incrementCounter(rejectedByEligibilityReason, item.exclusionReason);
    }
  }
  const filtered = scored
    .filter((item) => !item.excluded && item.score >= TOP_PICK_MIN_SCORE)
    .sort((left, right) => right.score - left.score);
  const top = dedupeTopPickResults(filtered).slice(
    0,
    options.storeLimit ?? TOP_PICKS_STORE_LIMIT
  );

  for (const item of top) {
    incrementCounter(finalRoleDistribution, item.job.normalizedRoleCategory ?? "unknown");
    incrementCounter(finalSeniorityDistribution, item.job.experienceLevelGroup ?? item.job.normalizedCareerStage ?? "unknown");
    incrementCounter(finalLocationDistribution, item.job.location.split(",").at(-1)?.trim() || item.job.location);
    incrementCounter(finalWorkModeDistribution, item.job.workMode ?? "unknown");
  }

  await replaceUserTopPicks({
    userId,
    profileVersion: profile.profileVersion,
    picks: top,
  });

  const averageScore =
    top.length > 0
      ? Math.round(top.reduce((sum, pick) => sum + pick.score, 0) / top.length)
      : 0;
  const result = {
    userId,
    profileVersion: profile.profileVersion,
    candidateCount: candidates.length,
    candidatesByChannel,
    scoredCount: scored.length,
    storedCount: top.length,
    excludedCount: scored.filter((item) => item.excluded).length,
    rejectedByEligibilityReason,
    rejectedByRoleReason,
    rejectedBySeniorityReason,
    averageScore,
    durationMs: Date.now() - startedAt,
  };
  console.info("top-picks refresh", {
    ...result,
    reason: options.reason ?? "manual",
    topScore: top[0]?.score ?? 0,
    lowestStoredScore: top.at(-1)?.score ?? 0,
    finalRoleDistribution,
    finalSeniorityDistribution,
    finalLocationDistribution,
    finalWorkModeDistribution,
  });
  return result;
}

export async function enqueueTopPicksRefresh(
  userId: string,
  options: { reason?: string; candidateLimit?: number; storeLimit?: number } = {}
) {
  return enqueueDurableTopPicksRefresh({
    userId,
    reason: options.reason ?? "manual",
    candidateLimit: options.candidateLimit,
    storeLimit: options.storeLimit,
    priorityScore: options.reason === "manual_api" ? 100 : 50,
  });
}

export async function getTopPicksRefreshStatus(userId: string) {
  const [storedProfile, refreshTask] = await Promise.all([
    prisma.userMatchProfile.findUnique({
      where: { userId },
      select: {
        profileHash: true,
        profileVersion: true,
        updatedAt: true,
        normalizedSkills: true,
        targetRoleCategories: true,
        targetCareerStage: true,
        preferredLocationCity: true,
        preferredLocationRegion: true,
        preferredLocationCountry: true,
        preferredWorkModes: true,
        targetSalaryMin: true,
        targetSalaryMax: true,
        targetSalaryCurrency: true,
        experienceSummary: true,
      },
    }),
    getTopPicksRefreshTaskStatus(userId),
  ]);
  let profile = storedProfile;
  let builtIntentForReadiness: UserJobIntent | null = null;
  if (!profile) {
    builtIntentForReadiness = await buildAndStoreUserMatchProfile(userId);
    profile = builtIntentForReadiness
      ? buildStoredProfileSignalFromIntent(builtIntentForReadiness)
      : null;
  }
  const profileReadiness = assessStoredProfileSignal(
    profile,
    builtIntentForReadiness
  );
  const visibleTopPickWhere = {
    userId,
    isValid: true,
    expiresAt: { gt: new Date() },
    job: {
      is: buildDefaultCanonicalVisibilityWhere(),
    },
  } satisfies PrismaTypes.UserTopPickWhereInput;
  const [latestPick, validCount] = await Promise.all([
    prisma.userTopPick.findFirst({
      where: visibleTopPickWhere,
      orderBy: { computedAt: "desc" },
      select: { computedAt: true, expiresAt: true, profileVersion: true },
    }),
    prisma.userTopPick.count({ where: visibleTopPickWhere }),
  ]);
  const now = new Date();
  const stale =
    !latestPick ||
    latestPick.expiresAt <= now ||
    (profile ? latestPick.profileVersion !== profile.profileVersion : false);
  return {
    hasProfileSnapshot: Boolean(profile),
    profileReady: profileReadiness.canGenerate,
    canRefresh: profileReadiness.canGenerate,
    missingProfileSignals: profileReadiness.missingSignals,
    profileReadinessMessage: profileReadiness.message,
    profileVersion: profile?.profileVersion ?? null,
    lastComputedAt: latestPick?.computedAt.toISOString() ?? null,
    expiresAt: latestPick?.expiresAt.toISOString() ?? null,
    validCount,
    refreshing: Boolean(refreshTask?.active),
    refreshTask: refreshTask
      ? {
          status: refreshTask.status,
          reason: refreshTask.reason,
          queued: refreshTask.queued,
          running: refreshTask.running,
          attemptCount: refreshTask.attemptCount,
          maxAttempts: refreshTask.maxAttempts,
          notBeforeAt: refreshTask.notBeforeAt?.toISOString() ?? null,
          startedAt: refreshTask.startedAt?.toISOString() ?? null,
          finishedAt: refreshTask.finishedAt?.toISOString() ?? null,
          lastError: refreshTask.lastError,
        }
      : null,
    stale,
  };
}

export async function invalidateTopPicksForUser(userId: string) {
  const now = new Date();
  await prisma.userTopPick.updateMany({
    where: {
      userId,
      isValid: true,
    },
    data: {
      isValid: false,
      invalidatedAt: now,
    },
  });
  await enqueueDurableTopPicksRefresh({
    userId,
    reason: "profile_changed",
    priorityScore: 75,
  });
}

export async function saveTopPickFeedback(input: {
  userId: string;
  jobId: string;
  feedbackType: UserJobPreferenceFeedbackType;
}) {
  const now = new Date();
  const [feedback] = await prisma.$transaction([
    prisma.userJobPreferenceFeedback.create({
      data: {
        userId: input.userId,
        jobId: input.jobId,
        feedbackType: input.feedbackType,
      },
    }),
    prisma.userTopPick.updateMany({
      where: {
        userId: input.userId,
        jobId: input.jobId,
        isValid: true,
      },
      data: {
        isValid: false,
        invalidatedAt: now,
      },
    }),
  ]);
  await enqueueDurableTopPicksRefresh({
    userId: input.userId,
    reason: "feedback_changed",
    priorityScore: 60,
  });
  return feedback;
}
