import type { Prisma, WorkMode } from "@/generated/prisma/client";
import { serializeJobCardData } from "@/lib/job-serialization";
import { prisma } from "@/lib/db";
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
  job: TopPickJobRecord;
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
      description: job.description,
      isSaved: savedJobs.length > 0,
      hasApplied: trackedApplications.length > 0,
    }),
  };
}

function buildTopPickWhere(
  userId: string,
  options: TopPicksQueryOptions = {}
) {
  const jobAnd: Prisma.JobCanonicalWhereInput[] = [
    buildDefaultCanonicalVisibilityWhere(),
  ];

  if (options.titleSearch) {
    jobAnd.push({ title: { contains: options.titleSearch, mode: "insensitive" } });
  }
  if (options.companySearch) {
    jobAnd.push({ company: { contains: options.companySearch, mode: "insensitive" } });
  }
  const locationValue = options.locationSearch ?? options.location;
  if (locationValue) {
    const locationTerms = locationValue
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (locationTerms.length > 0) {
      jobAnd.push({
        OR: locationTerms.map((location) => ({
          location: { contains: location, mode: "insensitive" as const },
        })),
      });
    }
  }
  const jobWhere: Prisma.JobCanonicalWhereInput = { AND: jobAnd };

  if (options.workMode) {
    const workModes = options.workMode
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (workModes.length > 0) {
      jobWhere.workMode = { in: workModes as WorkMode[] };
    }
  }
  if (options.experienceLevel) {
    const groups = options.experienceLevel
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (groups.length > 0) {
      jobWhere.experienceLevelGroup = { in: groups };
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
  const where = buildTopPickWhere(userId, options);
  const [rows, total, status] = await Promise.all([
    prisma.userTopPick.findMany({
      where,
      orderBy: [{ score: "desc" }, { rank: "asc" }],
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
          select: TOP_PICK_JOB_SELECT(userId, authUserId),
        },
      },
    }),
    prisma.userTopPick.count({ where }),
    getTopPicksRefreshStatus(userId),
  ]);
  const data = rows.slice(0, pageSize).map(serializePick);

  return {
    data,
    total,
    page,
    pageSize,
    hasNextPage: rows.length > pageSize,
    status,
  };
}
