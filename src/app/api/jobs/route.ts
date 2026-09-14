import { type NextRequest } from "next/server";
import { getJobs } from "@/lib/queries/jobs";
import {
  handleApiRouteError,
  paginatedResponse,
  rateLimitResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { parseJobFilters } from "@/lib/jobs/search-params";
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
    const filters = parseJobFilters(sp);
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
