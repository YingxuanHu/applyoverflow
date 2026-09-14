import { buildScopedTextSearchWhere } from "./jobs";
import type { Prisma, WorkMode } from "@/generated/prisma/client";
import { serializeJobCardData } from "@/lib/job-serialization";
import { buildLocationSearchPredicate } from "@/lib/location-search";
import { normalizeExperienceLevelGroupFilterValue, CAREER_STAGE_FILTER_CONFIDENCE_THRESHOLD, METADATA_FIELD_FILTER_CONFIDENCE_THRESHOLD } from "@/lib/job-metadata";
import { parseTopPicksFilters } from "@/lib/jobs/search-params";
import { prisma } from "@/lib/db";
import { normalizeSkills } from "@/lib/profile";
import { buildDefaultCanonicalVisibilityWhere } from "@/lib/jobs/visibility";
import { TOP_PICKS_PAGE_LIMIT } from "@/lib/top-picks/config";
import {
  getTopPicksRefreshStatus,
  TOP_PICK_JOB_SELECT,
  type TopPickJobRecord,
} from "@/lib/top-picks/service";
import type { JobCardData } from "@/types";

export type TopPickCardData = {
  id: string;
  score: number;
  rank: number;
  matchReasons: string[];
  concerns: string[];
  computedAt: string;
  job: JobCardData;
};

export type TopPicksQueryOptions = {
  page?: number;
  pageSize?: number;
  minScore?: number;
  titleSearch?: string | null;
  companySearch?: string | null;
  location?: string | null;
  locationSearch?: string | null;
  workMode?: string | null;
  experienceLevel?: string | null;
};

function jsonStringArray(value: Prisma.JsonValue) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

async function getAuthUserIdForProfile(profileId: string) {
  const profile = await prisma.userProfile.findUnique({
    where: { id: profileId },
    select: { authUserId: true },
  });

  return profile?.authUserId ?? null;
}

function serializePick(input: {
  id: string;
  score: number;
  rank: number;
  matchReasons: Prisma.JsonValue;
  concerns: Prisma.JsonValue;
  computedAt: Date;
  job: Omit<TopPickJobRecord, "description">;
}): TopPickCardData {
  const { savedJobs, trackedApplications, ...job } = input.job;
  return {
    id: input.id,
    score: Math.round(input.score),
    rank: input.rank,
    matchReasons: jsonStringArray(input.matchReasons).slice(0, 3),
    concerns: jsonStringArray(input.concerns).slice(0, 3),
    computedAt: input.computedAt.toISOString(),
    job: serializeJobCardData({
      ...job,
      eligibility: job.eligibility
        ? {
            submissionCategory: job.eligibility.submissionCategory,
            reasonCode: job.eligibility.reasonCode,
            reasonDescription: job.eligibility.reasonDescription,
          }
        : null,
      description: "",
      isSaved: savedJobs.length > 0,
      hasApplied: trackedApplications.length > 0,
    }),
  };
}

function buildTopPickWhere(
  userId: string,
  options: TopPicksQueryOptions = {}
) {
  options = { ...options, ...parseTopPicksFilters(Object.fromEntries(Object.entries(options).filter((entry) => typeof entry[1] === "string")) as Record<string, string>) };
  const jobAnd: Prisma.JobCanonicalWhereInput[] = [
    buildDefaultCanonicalVisibilityWhere(),
  ];

  for (const [field, query] of [["title", options.titleSearch], ["company", options.companySearch]] as const) {
    const condition = buildScopedTextSearchWhere(field, query ?? undefined);
    if (condition) jobAnd.push(condition);
  }
  const locationValue = options.locationSearch ?? options.location;
  const locationWhere = buildLocationSearchPredicate(locationValue);
  if (locationWhere) jobAnd.push(locationWhere);
  const jobWhere: Prisma.JobCanonicalWhereInput = { AND: jobAnd };

  if (options.workMode) {
    const workModes = options.workMode
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (workModes.length > 0) {
      jobWhere.workMode = { in: workModes as WorkMode[] };
      jobWhere.workModeConfidence = { gte: METADATA_FIELD_FILTER_CONFIDENCE_THRESHOLD };
    }
  }
  if (options.experienceLevel) {
    const groups = (normalizeExperienceLevelGroupFilterValue(options.experienceLevel) ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (groups.length > 0) {
      jobWhere.experienceLevelGroup = { in: groups };
      jobWhere.normalizedCareerStageConfidence = { gte: CAREER_STAGE_FILTER_CONFIDENCE_THRESHOLD };
    }
  }

  return {
    userId,
    isValid: true,
    expiresAt: { gt: new Date() },
    score: options.minScore ? { gte: options.minScore } : undefined,
    job: { is: jobWhere },
  } satisfies Prisma.UserTopPickWhereInput;
}

export async function getTopPicksForUser(
  userId: string,
  options: TopPicksQueryOptions = {}
) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(
    Math.max(1, options.pageSize ?? TOP_PICKS_PAGE_LIMIT),
    TOP_PICKS_PAGE_LIMIT
  );
  const authUserId = await getAuthUserIdForProfile(userId);
  const viewer = await prisma.userProfile.findUnique({ where: { id: userId }, select: { skillsJson: true } });
  const profile = await prisma.userMatchProfile.findUnique({ where: { userId }, select: { profileVersion: true } });
  const baseWhere = buildTopPickWhere(userId, options);
  const where = {
    ...baseWhere,
    profileVersion: profile?.profileVersion ?? -1,
    job: { is: { AND: [baseWhere.job.is, { preferenceFeedback: { none: { userId } } }] } },
  };
  const [rows, total, status] = await Promise.all([
    prisma.userTopPick.findMany({
      where,
      orderBy: [{ rank: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
      select: {
        id: true,
        score: true,
        rank: true,
        matchReasons: true,
        concerns: true,
        computedAt: true,
        job: {
          select: { ...TOP_PICK_JOB_SELECT(userId, authUserId), description: false },
        },
      },
    }),
    prisma.userTopPick.count({ where }),
    getTopPicksRefreshStatus(userId),
  ]);
  const data = rows.slice(0, pageSize).map(serializePick);
  if (data[0]) {
    const first = await prisma.jobCanonical.findUnique({ where: { id: data[0].job.id }, select: { description: true } });
    data[0].job.description = first?.description ?? "";
  }

  return {
    profileSkills: normalizeSkills(viewer?.skillsJson).map((skill) => skill.name),
    data,
    total,
    page,
    pageSize,
    hasNextPage: rows.length > pageSize,
    status,
  };
}
