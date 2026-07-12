import { type NextRequest } from "next/server";
import { getJobs, normalizeJobSortBy, type JobFilterParams } from "@/lib/queries/jobs";
import {
  handleApiRouteError,
  paginatedResponse,
  parseBoundedIntParam,
  parseIntParam,
  rateLimitResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { normalizeSalaryCurrency } from "@/lib/currency-conversion";
import {
  normalizeUserTimeZone,
  USER_TIME_ZONE_COOKIE,
} from "@/lib/time-zone";

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:list",
      API_RATE_LIMITS.publicRead
    );
    if (rateLimited) return rateLimited;

    const sp = request.nextUrl.searchParams;
    const searchScope = sp.get("searchScope");
    const filters: JobFilterParams = {
      search: sp.get("search") ?? undefined,
      searchScope:
        searchScope === "title" ||
        searchScope === "company" ||
        searchScope === "location" ||
        searchScope === "all"
          ? searchScope
          : undefined,
      titleSearch: sp.get("titleSearch") ?? undefined,
      companySearch: sp.get("companySearch") ?? undefined,
      locationSearch: sp.get("locationSearch") ?? undefined,
      location: sp.get("location") ?? undefined,
      source: sp.get("source") ?? undefined,
      region: sp.get("region") ?? undefined,
      workMode: sp.get("workMode") ?? undefined,
      employmentType: sp.get("employmentType") ?? undefined,
      industry: sp.get("industry") ?? undefined,
      roleCategory: sp.get("roleCategory") ?? undefined,
      roleFamily: sp.get("roleFamily") ?? undefined,
      salaryMin: parseIntParam(sp.get("salaryMin"), 0) || undefined,
      salaryMax: parseIntParam(sp.get("salaryMax"), 0) || undefined,
      salaryCurrency: normalizeSalaryCurrency(sp.get("salaryCurrency")) ?? undefined,
      careerStage: sp.get("careerStage") ?? undefined,
      experienceLevel: sp.get("experienceLevel") ?? undefined,
      expiry: sp.get("expiry") ?? undefined,
      posted: sp.get("posted") ?? undefined,
      submissionCategory: sp.get("submissionCategory") ?? undefined,
      status: sp.get("status") ?? undefined,
      sortBy: normalizeJobSortBy(sp.get("sortBy") ?? undefined),
      page: parseBoundedIntParam(sp.get("page"), 1, { min: 1, max: 1000 }),
    };
    const result = await getJobs(
      {
        ...filters,
      },
      {
        userTimeZone: normalizeUserTimeZone(
          request.cookies.get(USER_TIME_ZONE_COOKIE)?.value
        ),
      }
    );
    logSlowJobsRequest(request, filters, performance.now() - startedAt, result.total);

    return paginatedResponse(
      result.data,
      result.total,
      result.page,
      result.pageSize,
      result.hasNextPage
    );
  } catch (error) {
    return handleApiRouteError(error, "GET /api/jobs", "Failed to fetch jobs");
  }
}

function logSlowJobsRequest(
  request: NextRequest,
  filters: Record<string, unknown>,
  durationMs: number,
  total: number | null
) {
  const thresholdMs = Number(process.env.JOBS_API_SLOW_LOG_MS ?? 2000);
  if (!Number.isFinite(thresholdMs) || durationMs < thresholdMs) {
    return;
  }

  console.warn("[api.jobs] slow request", {
    durationMs: Math.round(durationMs),
    total,
    path: request.nextUrl.pathname,
    filters: {
      searchScope: filters.searchScope,
      hasSearch: Boolean(filters.search),
      hasTitleSearch: Boolean(filters.titleSearch),
      hasCompanySearch: Boolean(filters.companySearch),
      hasLocationSearch: Boolean(filters.locationSearch),
      region: filters.region,
      workMode: filters.workMode,
      employmentType: filters.employmentType,
      industry: filters.industry,
      roleCategory: filters.roleCategory,
      careerStage: filters.careerStage,
      experienceLevel: filters.experienceLevel,
      sortBy: filters.sortBy,
      page: filters.page,
    },
  });
}
